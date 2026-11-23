"""Phase 3A: consent, rename a person, delete all data of a person."""
import csv
import json
import os
import threading
from datetime import datetime

from fastapi import APIRouter, Body, HTTPException

from . import attendance, quiet
from . import storage as st

CONSENT_FILE = os.path.join(st.DATA_DIR, "consent.json")
_clock = threading.Lock()


# ----------------------------------------------------------------- consent
def _read_consent():
    try:
        with open(CONSENT_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _write_consent(d):
    st.init_dirs()
    tmp = CONSENT_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=2)
    os.replace(tmp, CONSENT_FILE)


def set_consent(name, value):
    """value True / False records it with today's date. None clears the record."""
    with _clock:
        d = _read_consent()
        if value is None:
            d.pop(name.lower(), None)
        else:
            d[name.lower()] = {"name": name, "consent": bool(value), "date": datetime.now().strftime("%Y-%m-%d")}
        _write_consent(d)


def _move_consent(old, new=None):
    with _clock:
        d = _read_consent()
        rec = d.pop(old.lower(), None)
        if rec is None:
            return False
        if new:
            rec["name"] = new
            d[new.lower()] = rec
        _write_consent(d)
        return True


def consent_list():
    d = _read_consent()
    out = []
    for p in st.people_summary():
        c = d.get(p["name"].lower())
        if c:
            out.append({"name": p["name"], "consent": bool(c.get("consent")), "date": c.get("date", "")})
    return out


# --------------------------------------------------------------- alert log
def _rewrite_log(low, new_name=None):
    """Delete (new_name None) or rename the alert rows of one person.
    Returns (rows changed, picture names of those rows, picture names still used by other rows)."""
    if not os.path.exists(st.LOG_FILE):
        return 0, [], set()
    count, gone, kept = 0, [], set()
    with st._lock:
        try:
            with open(st.LOG_FILE, newline="", encoding="utf-8") as f:
                rows = list(csv.reader(f))
            header = rows[0]
            ni, si = header.index("name"), header.index("snapshot")
        except Exception:
            return 0, [], set()
        out = [header]
        for r in rows[1:]:
            snap = os.path.basename(r[si].replace("\\", "/")) if len(r) > si and r[si] else ""
            if len(r) > ni and r[ni].lower() == low:
                count += 1
                if snap:
                    gone.append(snap)
                if new_name is not None:
                    r = list(r)
                    r[ni] = new_name
                    out.append(r)
            else:
                out.append(r)
                if snap:
                    kept.add(snap)
        if count:
            tmp = st.LOG_FILE + ".tmp"
            with open(tmp, "w", newline="", encoding="utf-8") as f:
                csv.writer(f).writerows(out)
            os.replace(tmp, st.LOG_FILE)
    return count, gone, kept


def _delete_pictures(gone, kept):
    n = 0
    for s in set(gone) - kept:
        for fn in (s, st.FACE_PREFIX + s):
            try:
                os.remove(os.path.join(st.MATCH_DIR, fn))
                n += 1
            except OSError:
                pass
    return n


# ------------------------------------------------ "Not recognised" events
def _unknown(low, new_name=None):
    removed = []
    with st._lock:
        items = st._read_unknown_raw()
        if new_name is None:
            keep = [x for x in items if (x.get("person") or "").lower() != low]
            removed = [x for x in items if (x.get("person") or "").lower() == low]
            if removed:
                st._write_unknown_raw(keep)
        else:
            for x in items:
                if (x.get("person") or "").lower() == low:
                    x["person"] = new_name
                    removed.append(x)
            if removed:
                st._write_unknown_raw(items)
    if new_name is None:
        for x in removed:
            st._remove_unknown_files(x["id"])
    return len(removed)


# ----------------------------------------------------------- notifications
def _notifications(low, old, new_name=None):
    changed = 0
    with st._lock:
        items = st._read_notif_raw()
        if new_name is None:
            keep = [x for x in items if (x.get("name") or "").lower() != low]
            changed = len(items) - len(keep)
            if changed:
                st._write_notif_raw(keep)
        else:
            for x in items:
                if (x.get("name") or "").lower() == low:
                    x["name"] = new_name
                    x["text"] = str(x.get("text", "")).replace(old, new_name)
                    changed += 1
            if changed:
                st._write_notif_raw(items)
    return changed


# -------------------------------------------------- attendance and ignore
def _attendance(old, new=None):
    with attendance._lock:
        cfg = attendance.load()
        rec = cfg["people"].pop(old.lower(), None)
        if rec is None:
            return False
        if new:
            cfg["people"][new.lower()] = rec
        attendance._save(cfg)
        return True


def _quiet(old, new=None):
    with quiet._lock:
        quiet._load()
        rec = quiet._state["people"].pop(old.lower(), None)
        if rec is None:
            return False
        if new:
            rec["name"] = new
            quiet._state["people"][new.lower()] = rec
        quiet._save()
        return True


# ------------------------------------------------------------- operations
def delete_person_data(name):
    """Erase everything stored about one person. Safe to run again if it was interrupted."""
    real = st.find_person(st.safe_name(name))
    target = real or st.safe_name(name)
    if not target:
        raise HTTPException(400, "Please give a name.")
    low = target.lower()
    res = {"name": target, "photos": 0, "alerts": 0, "pictures": 0, "unknown": 0,
           "notifications": 0, "attendance": False, "ignore": False, "consent": False}
    if real:
        res["photos"] = len(st.photo_files(real))
        st.remove_person(real)
    res["alerts"], gone, kept = _rewrite_log(low)
    res["pictures"] = _delete_pictures(gone, kept)
    res["unknown"] = _unknown(low)
    res["notifications"] = _notifications(low, target)
    res["attendance"] = _attendance(target)
    res["ignore"] = _quiet(target)
    res["consent"] = _move_consent(target)
    found = bool(real) or any(res[k] for k in ("alerts", "unknown", "notifications", "attendance", "ignore", "consent"))
    if not found:
        raise HTTPException(404, "Person not found.")
    return res


def rename_person(old, new):
    real = st.find_person(st.safe_name(old))
    if not real:
        raise HTTPException(404, "Person not found.")
    clean = st.safe_name(new)
    if not clean:
        raise HTTPException(400, "Please use letters or numbers in the name.")
    other = st.find_person(clean)
    if other and other.lower() != real.lower():
        raise HTTPException(409, f"A person called {other} already exists.")
    if clean == real:
        return {"name": real}
    try:
        os.rename(st.person_dir(real), st.person_dir(clean))
    except OSError as e:
        raise HTTPException(400, f"Could not rename the folder: {e}")
    low = real.lower()
    _rewrite_log(low, clean)
    _unknown(low, clean)
    _notifications(low, real, clean)
    _attendance(real, clean)
    _quiet(real, clean)
    _move_consent(real, clean)
    return {"name": clean}


def make_router(cfg, engine):
    r = APIRouter()

    @r.get("/api/consent")
    def consent_get():
        return {"items": consent_list()}

    @r.put("/api/people/{name}/consent")
    def consent_put(name: str, payload: dict = Body(...)):
        real = st.find_person(st.safe_name(name))
        if not real:
            raise HTTPException(404, "Person not found.")
        v = payload.get("consent")
        if v is not None and not isinstance(v, bool):
            raise HTTPException(400, "Consent must be true, false or null.")
        set_consent(real, v)
        return {"name": real, "consent": v}

    @r.post("/api/people/{name}/rename")
    def rename(name: str, payload: dict = Body(...)):
        res = rename_person(name, str(payload.get("new_name", "")))
        engine.reload_people()
        return res

    @r.delete("/api/people/{name}/data")
    def wipe(name: str):
        res = delete_person_data(name)
        engine.reload_people()
        return res

    return r