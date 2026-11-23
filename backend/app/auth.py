"""Login for FaceWatch with named users and two roles (admin, viewer). Users are in data/users.json (users.py).
The server refuses every change (POST / PUT / DELETE) from a viewer, and the admin-only pages."""
import hashlib
import hmac
import time

from starlette.requests import HTTPConnection, Request
from starlette.responses import JSONResponse

from . import users

COOKIE = "fw_session"
DAYS = 30
LOCAL = ("127.0.0.1", "::1")
MUTATING = ("POST", "PUT", "DELETE", "PATCH")
ADMIN_ONLY = ("/api/users", "/api/audit")       # viewers cannot even read these
_fails = {}  # ip -> [failed count, locked until]


def _sign(secret, exp, name, pwhash):
    # The password hash is part of the signature, so a changed password ends old sessions.
    return hmac.new(bytes.fromhex(secret), f"{exp}|{name}|{pwhash[:16]}".encode(), hashlib.sha256).hexdigest()


def _current(conn):
    """(username, record) of the logged-in user, or None. The role is read fresh on every request."""
    try:
        name, exp, sig = conn.cookies.get(COOKIE, "").split(".")
        data = users.load()
        rec = data["users"].get(name) if data else None
        if rec and int(exp) > time.time() and hmac.compare_digest(sig, _sign(data["secret"], int(exp), name, rec["hash"])):
            return name, rec
    except Exception:
        pass
    return None


def _with_cookie(resp, name):
    data = users.load()
    exp = int(time.time()) + DAYS * 86400
    resp.set_cookie(COOKIE, f"{name}.{exp}.{_sign(data['secret'], exp, name, data['users'][name]['hash'])}",
                    max_age=DAYS * 86400, httponly=True, samesite="lax")
    return resp


def _err(msg, code):
    return JSONResponse({"detail": msg}, status_code=code)


async def _body(request):
    try:
        d = await request.json()
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


async def _auth_route(request, scope, path):
    ip = request.client.host if request.client else ""
    post = request.method == "POST"
    cur = _current(request)
    if cur:
        scope["fw_who"] = cur[0]          # read by the audit log

    if path == "/api/auth/state":
        return JSONResponse({"setup_needed": users.setup_needed(), "logged_in": bool(cur),
                             "user": cur[0] if cur else "", "role": cur[1]["role"] if cur else ""})

    if path == "/api/auth/setup" and post:
        if not users.setup_needed():
            return _err("An account is already set up.", 403)
        if ip not in LOCAL:
            return _err("Set up the first account on the laptop itself: open http://localhost:8000", 403)
        b = await _body(request)
        name = str(b.get("username", "")).strip().lower()
        try:
            users.create_first_admin(name, str(b.get("password", "")))
        except ValueError as e:
            return _err(str(e), 400)
        scope["fw_who"] = name
        return _with_cookie(JSONResponse({"ok": True}), name)

    if path == "/api/auth/login" and post:
        if users.load() is None:
            return _err("No account is set up yet, or users.json cannot be read. Open http://localhost:8000 on the laptop.", 400)
        b = await _body(request)
        name = str(b.get("username", "")).strip().lower()
        scope["fw_who"] = name if users.NAME_RE.fullmatch(name) else "?"
        fail = _fails.setdefault(ip, [0, 0.0])
        if fail[1] > time.time():
            return _err("Too many wrong attempts. Wait a minute.", 429)
        if users.verify(name, str(b.get("password", ""))):
            _fails.pop(ip, None)
            return _with_cookie(JSONResponse({"ok": True}), name)
        fail[0] += 1
        if fail[0] >= 5:
            fail[0], fail[1] = 0, time.time() + 60
        return _err("Wrong username or password.", 401)

    if path == "/api/auth/logout" and post:
        resp = JSONResponse({"ok": True})
        resp.delete_cookie(COOKIE)
        return resp

    if path == "/api/auth/password" and post:
        if not cur:
            return _err("Login required", 401)
        b = await _body(request)
        try:
            users.change_own_password(cur[0], str(b.get("current_password", "")), str(b.get("new_password", "")))
        except ValueError as e:
            return _err(str(e), 400)           # 400, not 401, so the page does not log out
        return _with_cookie(JSONResponse({"ok": True}), cur[0])

    return _err("Not found", 404)


class AuthMiddleware:
    """Blocks /api/* and /snapshots/* until the person has logged in, and enforces the roles."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        path = scope["path"]
        if not (path.startswith("/api/") or path.startswith("/snapshots/")):
            return await self.app(scope, receive, send)

        if scope["type"] == "http" and path.startswith("/api/auth/"):
            resp = await _auth_route(Request(scope, receive), scope, path)
            return await resp(scope, receive, send)

        cur = _current(HTTPConnection(scope))
        if cur is None:
            if scope["type"] == "websocket":
                return await send({"type": "websocket.close", "code": 1008})
            return await _err("Login required", 401)(scope, receive, send)

        name, rec = cur
        scope["fw_who"] = name
        scope["fw_user"] = {"name": name, "role": rec["role"]}
        if scope["type"] == "http" and rec["role"] != "admin":
            if scope["method"] in MUTATING or path.startswith(ADMIN_ONLY):
                return await _err("This account can only look. Ask an admin to make the change.", 403)(scope, receive, send)
        await self.app(scope, receive, send)