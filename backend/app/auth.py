"""Simple password login for FaceWatch (one admin password, saved hashed in data/auth.json)."""
import hashlib
import hmac
import json
import secrets
import time
from pathlib import Path

from starlette.requests import Request
from starlette.responses import JSONResponse

DATA = Path(__file__).resolve().parent.parent / "data"
FILE = DATA / "auth.json"
COOKIE = "fw_session"
DAYS = 30
MIN_LEN = 8
LOCAL = ("127.0.0.1", "::1")
_fails = {}  # ip -> [failed count, locked until]


def _load():
    try:
        return json.loads(FILE.read_text("utf-8"))
    except Exception:
        return None


def _save(cfg):
    DATA.mkdir(parents=True, exist_ok=True)
    FILE.write_text(json.dumps(cfg), "utf-8")


def _hash(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200_000).hex()


def _sign(secret, exp):
    return hmac.new(bytes.fromhex(secret), str(exp).encode(), hashlib.sha256).hexdigest()


def _valid(request, cfg):
    try:
        exp, sig = request.cookies.get(COOKIE, "").split(".", 1)
        return int(exp) > time.time() and hmac.compare_digest(sig, _sign(cfg["secret"], int(exp)))
    except Exception:
        return False


def _with_cookie(resp, cfg):
    exp = int(time.time()) + DAYS * 86400
    resp.set_cookie(COOKIE, f"{exp}.{_sign(cfg['secret'], exp)}",
                    max_age=DAYS * 86400, httponly=True, samesite="lax")
    return resp


def _err(msg, code):
    return JSONResponse({"detail": msg}, status_code=code)


async def _password(request):
    try:
        return str((await request.json()).get("password", ""))
    except Exception:
        return ""


async def _auth_route(request, path):
    cfg = _load()
    ip = request.client.host if request.client else ""
    post = request.method == "POST"

    if path == "/api/auth/state":
        return JSONResponse({"setup_needed": cfg is None,
                             "logged_in": bool(cfg) and _valid(request, cfg)})

    if path == "/api/auth/setup" and post:
        if cfg is not None:
            return _err("A password is already set.", 403)
        if ip not in LOCAL:
            return _err("Set the password on the laptop itself: open http://localhost:8000", 403)
        pw = await _password(request)
        if len(pw) < MIN_LEN:
            return _err(f"Use at least {MIN_LEN} characters.", 400)
        salt = secrets.token_hex(16)
        cfg = {"salt": salt, "hash": _hash(pw, salt), "secret": secrets.token_hex(32)}
        _save(cfg)
        return _with_cookie(JSONResponse({"ok": True}), cfg)

    if path == "/api/auth/login" and post:
        if cfg is None:
            return _err("No password is set yet. Open http://localhost:8000 on the laptop.", 400)
        fail = _fails.setdefault(ip, [0, 0.0])
        if fail[1] > time.time():
            return _err("Too many wrong attempts. Wait a minute.", 429)
        pw = await _password(request)
        if hmac.compare_digest(_hash(pw, cfg["salt"]), cfg["hash"]):
            _fails.pop(ip, None)
            return _with_cookie(JSONResponse({"ok": True}), cfg)
        fail[0] += 1
        if fail[0] >= 5:
            fail[0], fail[1] = 0, time.time() + 60
        return _err("Wrong password.", 401)

    if path == "/api/auth/logout" and post:
        resp = JSONResponse({"ok": True})
        resp.delete_cookie(COOKIE)
        return resp

    return _err("Not found", 404)


class AuthMiddleware:
    """Blocks /api/* and /snapshots/* until the person has logged in."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        path = scope["path"]
        protected = path.startswith("/api/") or path.startswith("/snapshots/")
        if not protected:
            return await self.app(scope, receive, send)

        if scope["type"] == "http" and path.startswith("/api/auth/"):
            resp = await _auth_route(Request(scope, receive), path)
            return await resp(scope, receive, send)

        cfg = _load()
        if cfg is None or not _valid(Request(scope), cfg):
            if scope["type"] == "websocket":
                return await send({"type": "websocket.close", "code": 1008})
            return await _err("Login required", 401)(scope, receive, send)
        await self.app(scope, receive, send)