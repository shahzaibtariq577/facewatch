"""'Ignore for X hours': silence phone alerts for everyone, or alerts and notices for one person.
Visits are still recorded, so the Dashboard and Reports stay complete."""
import json
import os
import threading
import time
from datetime import datetime

from . import storage as st

FILE = os.path.join(st.DATA_DIR, "quiet.json")
MAX_HOURS = 72
_lock = threading.Lock()
_state = {"all": 0.0, "people": {}}      # people: lower-case name -> {"name": str, "until": float}
_loaded = False


def _load():
    global _loaded
    if _loaded:
        return
    _loaded = True
    try:
        with open(FILE, encoding="utf-8") as f:
            d = json.load(f)
        _state["all"] = float(d.get("all", 0) or 0)
        for k, v in (d.get("people") or {}).items():
            _state["people"][str(k)] = {"name": str(v.get("name", k)), "until": float(v.get("until", 0))}
    except Exception:
        pass


def _prune():
    now = time.time()
    if _state["all"] <= now:
        _state["all"] = 0.0
    for k in [k for k, v in _state["people"].items() if v["until"] <= now]:
        del _state["people"][k]


def _save():
    try:
        st.init_dirs()
        tmp = FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_state, f)
        os.replace(tmp, FILE)
    except Exception:
        pass


def phone_muted(name=""):
    """True if a phone message about this person (or about anyone) must not be sent now."""
    with _lock:
        _load()
        now = time.time()
        if _state["all"] > now:
            return True
        p = _state["people"].get((name or "").lower())
        return bool(p and p["until"] > now)


def person_muted(name):
    """True if in-app notices about this person are ignored now."""
    with _lock:
        _load()
        p = _state["people"].get((name or "").lower())
        return bool(p and p["until"] > time.time())


def _fmt(ts):
    return datetime.fromtimestamp(ts).strftime(st.TIME_FMT)


def snapshot():
    with _lock:
        _load()
        _prune()
        now = time.time()

        def item(until):
            return {"until": _fmt(until), "minutes_left": max(1, int((until - now) / 60 + 0.99))}
        return {"all": item(_state["all"]) if _state["all"] else None,
                "people": sorted(({"name": v["name"], **item(v["until"])} for v in _state["people"].values()),
                                 key=lambda x: x["name"].lower())}


def set_mute(scope, hours, name=""):
    """scope is 'all' or 'person'. Returns the end time. Raises ValueError on bad input."""
    try:
        hours = float(hours)
    except (TypeError, ValueError):
        raise ValueError("Choose how many hours.")
    if not 0.25 <= hours <= MAX_HOURS:
        raise ValueError(f"Choose between 15 minutes and {MAX_HOURS} hours.")
    until = time.time() + hours * 3600
    with _lock:
        _load()
        if scope == "all":
            _state["all"] = until
        elif scope == "person" and name:
            _state["people"][name.lower()] = {"name": name, "until": until}
        else:
            raise ValueError("Choose a person.")
        _save()
    return _fmt(until)


def clear_mute(scope, name=""):
    with _lock:
        _load()
        if scope == "all":
            _state["all"] = 0.0
        elif scope == "person":
            _state["people"].pop((name or "").lower(), None)
        _save()