"""Phase 3B: audit log. Records who changed what (never passwords or setting values).
AuditMiddleware watches every change request (POST / PUT / DELETE) and logins."""
import json
import os
import re
import threading
from datetime import datetime
from urllib.parse import parse_qs

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from . import storage as st

FILE = os.path.join(st.DATA_DIR, "audit.log")       # one JSON line per event
MAX_LINES = 6000                                    # the oldest lines are dropped after this many
CATEGORIES = ("login", "people", "data", "settings", "control", "users", "other")
MUTATING = ("POST", "PUT", "DELETE", "PATCH")
_lock = threading.Lock()


# ----------------------------------------------------------------- storage
def add(category, text, ip="", ok=True, status=0, user=""):
    entry = {"time": datetime.now().strftime(st.TIME_FMT), "category": category, "text": text,
             "ip": ip, "ok": bool(ok), "status": status, "user": user}
    with _lock:
        st.init_dirs()
        with open(FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        try:
            if os.path.getsize(FILE) > 2_000_000:
                with open(FILE, encoding="utf-8") as f:
                    lines = f.readlines()[-MAX_LINES:]
                tmp = FILE + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    f.writelines(lines)
                os.replace(tmp, FILE)
        except OSError:
            pass


def read_all():
    """All events, newest first. 'id' is the line number."""
    out = []
    try:
        with _lock, open(FILE, encoding="utf-8") as f:
            for i, line in enumerate(f):
                try:
                    x = json.loads(line)
                except ValueError:
                    continue
                x["id"] = i
                out.append(x)
    except OSError:
        pass
    out.reverse()
    return out


# --------------------------------------------------------- what happened
def _j(raw):
    try:
        d = json.loads(bytes(raw) or b"{}")
        return d if isinstance(d, dict) else {}
    except ValueError:
        return {}


def describe(method, path, query, status, body, rbody):
    """Returns (category, text) or None when the request is not worth logging."""
    p = path.rstrip("/")
    ok = status < 400
    if p == "/api/auth/password":
        return "users", "Password changed" if ok else "Password change failed"
    if status == 403 and "/auth/" not in p:
        return "other", f"Refused (no permission): {method} {p}"
    if "/auth/" in p or p.endswith("/login") or p.endswith("/logout"):
        seg = p.rsplit("/", 1)[-1]
        if seg == "login":
            return "login", "Login succeeded" if ok else "Login failed"
        if seg == "logout":
            return "login", "Logged out"
        return "login", f"Account action: {seg}" + ("" if ok else " (failed)")
    if not ok:
        return None
    m = re.fullmatch(r"/api/people/([^/]+)(?:/(photos|rename|consent|data))?", p)
    if p == "/api/people" and method == "POST":
        n = rbody.get("added")
        return "people", f"Person added: {rbody.get('name', '?')}" + (f" ({n} photos)" if n else "")
    if m:
        who, sub = m.group(1), m.group(2)
        if sub == "photos":
            return "people", f"Photos added: {who}"
        if sub == "rename":
            return "people", f"Person renamed: {who} to {body.get('new_name', '?')}"
        if sub == "consent":
            v = body.get("consent")
            return "people", (f"Consent recorded: {who}" if v is True else
                              f"Marked as no consent: {who}" if v is False else f"Consent record cleared: {who}")
        if sub == "data":
            return "data", f"All data deleted: {who}"
        if method == "DELETE":
            return "people", f"Person removed (photos only): {who}"
    m = re.fullmatch(r"/api/users(?:/([^/]+))?", p)
    if m:
        who = m.group(1)
        if method == "POST":
            return "users", f"User added: {str(body.get('username', '?'))[:30]} ({str(body.get('role', '?'))[:10]})"
        if method == "PUT":
            bits = []
            if "role" in body:
                bits.append("role set to " + str(body.get("role"))[:10])
            if body.get("password"):
                bits.append("password reset")
            return "users", f"User changed: {who} ({', '.join(bits) or 'no change'})"
        if method == "DELETE":
            return "users", f"User deleted: {who}"
    m = re.fullmatch(r"/api/unknown/([^/]+)(?:/(dismiss|add-person))?", p)
    if m:
        if m.group(2) == "add-person":
            return "people", f"Not recognised face added as person: {body.get('name', '?')}"
        if m.group(2) == "dismiss":
            return "control", "Not recognised event marked as reviewed"
        if method == "DELETE":
            return "data", "Not recognised event deleted"
    m = re.fullmatch(r"/api/cams(?:/([^/]+))?(?:/(use))?", p)
    if m:
        nm = str(rbody.get("name") or body.get("name") or "?")[:40]
        if m.group(2) == "use":
            return "settings", f"Camera selected: {nm}"
        if method == "POST":
            return "settings", f"Camera added: {nm}"
        if method == "PUT":
            return "settings", f"Camera changed: {nm}"
        if method == "DELETE":
            return "settings", f"Camera removed: {nm}"
    if p == "/api/settings" and method == "PUT":
        keys = [str(k) for k in body.keys()]
        return "settings", "Settings changed: " + (", ".join(keys[:8]) + (" ..." if len(keys) > 8 else "") if keys else "none")
    if p == "/api/attendance/config":
        return "settings", "Attendance setup changed"
    if p == "/api/attendance/person":
        return "settings", f"Attendance assignment changed: {body.get('name', '?')}"
    if p == "/api/quiet":
        if method == "DELETE":
            q = parse_qs(query)
            who = (q.get("name") or [""])[0] if (q.get("scope") or [""])[0] == "person" else "everyone"
            return "settings", f"Ignore turned off for {who}"
        who = body.get("name") if body.get("scope") == "person" else "everyone"
        return "settings", f"Ignore turned on for {who} ({body.get('hours', '?')} h)"
    if p == "/api/notify/test":
        return "settings", "Test phone message sent"
    if p == "/api/alerts" and method == "DELETE":
        return "data", "Alert history cleared"
    if p == "/api/snapshots" and method == "DELETE":
        return "data", "All saved pictures deleted"
    if p == "/api/notifications" and method == "DELETE":
        return "data", "Notifications cleared"
    if p == "/api/notifications/read":
        return None
    control = {"/api/start": "Watching started", "/api/stop": "Watching stopped",
               "/api/pause": "Monitoring paused", "/api/resume": "Monitoring resumed",
               "/api/report/send": "Daily report sent to the phone"}
    if p in control:
        return "control", control[p]
    return "other", f"{method} {p}"


class AuditMiddleware:
    """Plain ASGI middleware, so the live video stream is not affected."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in MUTATING:
            return await self.app(scope, receive, send)
        path = scope["path"]
        want_req = b"json" in dict(scope["headers"]).get(b"content-type", b"")
        want_resp = path.rstrip("/") == "/api/people" or path.startswith("/api/cams")
        req_body, resp = bytearray(), {"code": 0, "body": bytearray()}

        async def recv():
            msg = await receive()
            if want_req and msg["type"] == "http.request" and len(req_body) < 65536:
                req_body.extend(msg.get("body", b""))
            return msg

        async def snd(msg):
            if msg["type"] == "http.response.start":
                resp["code"] = msg["status"]
            elif msg["type"] == "http.response.body" and want_resp and len(resp["body"]) < 4096:
                resp["body"].extend(msg.get("body", b""))
            await send(msg)

        try:
            await self.app(scope, recv, snd)
        finally:
            if resp["code"]:
                try:
                    d = describe(scope["method"], path, scope.get("query_string", b"").decode("latin-1"),
                                 resp["code"], _j(req_body), _j(resp["body"]))
                    if d:
                        ip = (scope.get("client") or ("", 0))[0]
                        add(d[0], d[1], ip, resp["code"] < 400, resp["code"], scope.get("fw_who", ""))
                except Exception:
                    pass


# --------------------------------------------------------------------- API
def _filter(category, date_from, date_to):
    items = read_all()
    if category:
        items = [x for x in items if x.get("category") == category]
    if date_from:
        items = [x for x in items if x.get("time", "")[:10] >= date_from]
    if date_to:
        items = [x for x in items if x.get("time", "")[:10] <= date_to]
    return items


def make_router():
    r = APIRouter()

    @r.get("/api/audit")
    def audit_list(category: str = "", date_from: str = "", date_to: str = "", limit: int = 300):
        if category and category not in CATEGORIES:
            raise HTTPException(400, "Unknown category.")
        items = _filter(category, date_from, date_to)
        total = len(read_all())
        return {"items": items[:max(1, min(limit, 1000))], "shown": len(items), "total": total}

    @r.get("/api/audit/export")
    def audit_export(category: str = "", date_from: str = "", date_to: str = ""):
        import csv
        import io
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["time", "category", "user", "action", "ip", "result"])
        for x in reversed(_filter(category, date_from, date_to)):
            w.writerow([x.get("time", ""), x.get("category", ""), x.get("user", ""), x.get("text", ""), x.get("ip", ""),
                        "ok" if x.get("ok") else "failed"])
        return Response("\ufeff" + out.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": 'attachment; filename="facewatch_audit.csv"'})

    return r