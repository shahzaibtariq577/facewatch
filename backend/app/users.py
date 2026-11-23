"""Phase 3C: named users with two roles (admin, viewer), saved hashed in data/users.json.
The first time this runs on a v17 install, the old single password becomes the user 'admin'.
auth.json is only read, never changed."""
import copy
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
from pathlib import Path

ROLES = ("admin", "viewer")
NAME_RE = re.compile(r"[a-z0-9_-]{2,30}")
MIN_LEN = 8
DATA = Path(__file__).resolve().parent.parent / "data"
FILE = DATA / "users.json"
OLD = DATA / "auth.json"
_lock = threading.RLock()
_cache = {"mt": None, "data": None}


class NotFound(ValueError):
    pass


class Conflict(ValueError):
    pass


def hash_pw(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200_000).hex()


def _save(d):
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = FILE.with_name(FILE.name + ".tmp")
    tmp.write_text(json.dumps(d, indent=2), "utf-8")
    os.replace(tmp, FILE)
    _cache["mt"] = None


def _migrate():
    try:
        old = json.loads(OLD.read_text("utf-8"))
        return {"secret": str(old["secret"]),
                "users": {"admin": {"role": "admin", "salt": str(old["salt"]), "hash": str(old["hash"])}}}
    except Exception:
        return None


def load():
    """The user data, or None when nothing is set up (or the file is unreadable)."""
    with _lock:
        try:
            mt = FILE.stat().st_mtime_ns
        except OSError:
            mt = None
        if mt is None:
            d = _migrate()
            if d is None:
                return None
            _save(d)
            return d
        if _cache["mt"] == mt:
            return _cache["data"]
        try:
            d = json.loads(FILE.read_text("utf-8"))
            ok = isinstance(d, dict) and isinstance(d.get("secret"), str) \
                and isinstance(d.get("users"), dict) and d["users"]
        except Exception:
            ok = False
        _cache["mt"] = mt
        _cache["data"] = d if ok else None
        return _cache["data"]


def setup_needed():
    return not FILE.exists() and not OLD.exists()


def verify(name, pw):
    d = load()
    rec = d["users"].get(name) if d else None
    h = hash_pw(pw, rec["salt"] if rec else "00" * 16)       # same work for unknown names
    return bool(rec) and hmac.compare_digest(h, rec["hash"])


def _check_name(name):
    if not NAME_RE.fullmatch(name or ""):
        raise ValueError("Username: 2 to 30 letters, numbers, - or _ (no spaces).")


def _check_pw(pw):
    if len(pw or "") < MIN_LEN:
        raise ValueError(f"Use at least {MIN_LEN} characters for the password.")


def _record(role, pw):
    salt = secrets.token_hex(16)
    return {"role": role, "salt": salt, "hash": hash_pw(pw, salt)}


def _admins(d):
    return sum(1 for u in d["users"].values() if u["role"] == "admin")


def create_first_admin(name, pw):
    with _lock:
        if not setup_needed():
            raise ValueError("Already set up.")
        _check_name(name)
        _check_pw(pw)
        _save({"secret": secrets.token_hex(32), "users": {name: _record("admin", pw)}})


def list_users(me=""):
    d = load() or {"users": {}}
    return [{"username": n, "role": u["role"], "you": n == me} for n, u in sorted(d["users"].items())]


def add_user(name, pw, role):
    with _lock:
        d = copy.deepcopy(load())
        _check_name(name)
        _check_pw(pw)
        if role not in ROLES:
            raise ValueError("Role must be admin or viewer.")
        if name in d["users"]:
            raise Conflict("That username is already taken.")
        d["users"][name] = _record(role, pw)
        _save(d)


def update_user(name, role=None, password=None):
    with _lock:
        d = copy.deepcopy(load())
        rec = d["users"].get(name)
        if not rec:
            raise NotFound("User not found.")
        if role is not None:
            if role not in ROLES:
                raise ValueError("Role must be admin or viewer.")
            if rec["role"] == "admin" and role != "admin" and _admins(d) <= 1:
                raise ValueError("There must be at least one admin.")
            rec["role"] = role
        if password:
            _check_pw(password)
            rec.update(_record(rec["role"], password))
        _save(d)


def delete_user(name, acting):
    with _lock:
        d = copy.deepcopy(load())
        rec = d["users"].get(name)
        if not rec:
            raise NotFound("User not found.")
        if name == acting:
            raise ValueError("You cannot delete your own account.")
        if rec["role"] == "admin" and _admins(d) <= 1:
            raise ValueError("There must be at least one admin.")
        del d["users"][name]
        _save(d)


def change_own_password(name, current, new):
    with _lock:
        if not verify(name, current):
            raise ValueError("The current password is not right.")
        update_user(name, password=new)


# --------------------------------------------------------------------- API
def make_router():
    from fastapi import APIRouter, Body, HTTPException, Request
    from fastapi.responses import Response

    r = APIRouter()

    def admin(request: Request):
        u = request.scope.get("fw_user")
        if not u or u.get("role") != "admin":
            raise HTTPException(403, "Only an admin can manage users.")
        return u["name"]

    def call(fn, *a, **k):
        try:
            return fn(*a, **k)
        except NotFound as e:
            raise HTTPException(404, str(e))
        except Conflict as e:
            raise HTTPException(409, str(e))
        except ValueError as e:
            raise HTTPException(400, str(e))

    @r.get("/api/users")
    def users_get(request: Request):
        me = admin(request)
        return {"items": list_users(me)}

    @r.post("/api/users", status_code=201)
    def users_add(request: Request, payload: dict = Body(...)):
        admin(request)
        name = str(payload.get("username", "")).strip().lower()
        call(add_user, name, str(payload.get("password", "")), str(payload.get("role", "viewer")))
        return {"username": name}

    @r.put("/api/users/{username}")
    def users_put(username: str, request: Request, payload: dict = Body(...)):
        admin(request)
        role = payload.get("role")
        pw = payload.get("password")
        call(update_user, username.lower(), None if role is None else str(role),
             None if not pw else str(pw))
        return {"username": username.lower()}

    @r.delete("/api/users/{username}", status_code=204)
    def users_delete(username: str, request: Request):
        me = admin(request)
        call(delete_user, username.lower(), me)
        return Response(status_code=204)

    return r