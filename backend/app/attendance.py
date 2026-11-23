"""Workplace attendance from camera visits: departments, shifts, first in / last out, late, absent, CSV.
It only uses what the camera saw. 'Absent' means 'not seen by the camera', not proof of absence."""
import csv
import io
import json
import os
import re
import threading
from datetime import datetime, time as dtime, timedelta

from . import storage as st

FILE = os.path.join(st.DATA_DIR, "attendance.json")
MAX_DAYS = 62
HHMM = re.compile(r"([01]\d|2[0-3]):[0-5]\d")
_lock = threading.Lock()


def _default():
    return {"grace": 10, "workdays": [0, 1, 2, 3, 4],
            "shifts": [{"id": "day", "name": "Day", "start": "09:00", "end": "17:00"}],
            "departments": [], "people": {}}


def _clean(d, strict=False):
    """Keep only valid values. With strict=True a bad value raises ValueError with a friendly message."""
    def bad(msg):
        if strict:
            raise ValueError(msg)
    out = _default()
    if "grace" in d:
        g = d["grace"]
        if isinstance(g, int) and not isinstance(g, bool) and 0 <= g <= 120:
            out["grace"] = g
        else:
            bad("The grace time must be between 0 and 120 minutes.")
    if "workdays" in d:
        w = d["workdays"]
        days = sorted({x for x in w if isinstance(x, int) and not isinstance(x, bool) and 0 <= x <= 6}) if isinstance(w, list) else []
        if days:
            out["workdays"] = days
        else:
            bad("Choose at least one work day.")
    if "shifts" in d:
        shifts, seen = [], set()
        for i, s in enumerate(d["shifts"] if isinstance(d["shifts"], list) else []):
            if not isinstance(s, dict):
                continue
            name = st.safe_name(str(s.get("name", "")))
            a, b = str(s.get("start", "")), str(s.get("end", ""))
            if not name or not HHMM.fullmatch(a) or not HHMM.fullmatch(b) or b <= a:
                bad(f"Shift {i + 1}: give a name and times. The end must be after the start (night shifts are not supported yet).")
                continue
            sid = str(s.get("id", ""))
            if not re.fullmatch(r"[a-z0-9_]{1,20}", sid) or sid in seen:
                n = 1
                while f"s{n}" in seen:
                    n += 1
                sid = f"s{n}"
            seen.add(sid)
            shifts.append({"id": sid, "name": name, "start": a, "end": b})
        if shifts:
            out["shifts"] = shifts[:10]
        else:
            bad("Keep at least one shift.")
    if "departments" in d:
        names, low = [], set()
        for x in (d["departments"] if isinstance(d["departments"], list) else []):
            n = st.safe_name(str(x))
            if n and n.lower() not in low:
                low.add(n.lower())
                names.append(n)
        out["departments"] = names[:30]
    if isinstance(d.get("people"), dict):
        out["people"] = {str(k): {"department": str(v.get("department", "")), "shift": str(v.get("shift", ""))}
                         for k, v in d["people"].items() if isinstance(v, dict)}
    return out


def load():
    try:
        with open(FILE, encoding="utf-8") as f:
            d = json.load(f)
        return _clean(d if isinstance(d, dict) else {})
    except Exception:
        return _default()


def _save(cfg):
    st.init_dirs()
    tmp = FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    os.replace(tmp, FILE)


def set_config(payload):
    """Save grace, work days, shifts and departments. Assignments of people are kept."""
    with _lock:
        cur = load()
        new = dict(cur)
        new.update({k: payload[k] for k in ("grace", "workdays", "shifts", "departments") if k in payload})
        clean = _clean(new, strict=True)
        clean["people"] = cur["people"]
        _save(clean)
        return clean


def set_person(name, department, shift):
    with _lock:
        cur = load()
        if department and department not in cur["departments"]:
            raise ValueError("Unknown department. Add it in Setup first.")
        if shift and shift not in {s["id"] for s in cur["shifts"]}:
            raise ValueError("Unknown shift.")
        cur["people"][name.lower()] = {"department": department, "shift": shift}
        _save(cur)
        return cur


def _resolve(cfg, name):
    p = cfg["people"].get(name.lower(), {})
    shift = {s["id"]: s for s in cfg["shifts"]}.get(p.get("shift")) or cfg["shifts"][0]
    dept = p.get("department", "")
    return (dept if dept in cfg["departments"] else ""), shift


def people_setup():
    cfg = load()
    out = []
    for p in st.people_summary():
        dept, shift = _resolve(cfg, p["name"])
        out.append({"name": p["name"], "department": dept, "shift": shift["id"]})
    return out


def build(app_cfg, d_from, d_to, department=""):
    """Attendance for every saved person from d_from to d_to (dates). department: '' = all,
    'none' = people without a department, or a department name."""
    if d_to < d_from:
        raise ValueError("The start date is after the end date.")
    if (d_to - d_from).days + 1 > MAX_DAYS:
        raise ValueError(f"Choose at most {MAX_DAYS} days.")
    cfg = load()
    gap = max(app_cfg.get("visit_gap", 120), 2 * app_cfg.get("alert_interval", 10))
    by = {}
    for v in st.build_visits(st.read_log(), gap):
        by.setdefault((v["name"].lower(), v["start"].date()), []).append(v)
    now = datetime.now()
    today = now.date()
    days = [d_from + timedelta(days=i) for i in range((d_to - d_from).days + 1)]
    people, by_day = [], {d: {"present": 0, "late": 0, "absent": 0} for d in days}
    for p in st.people_summary():
        name = p["name"]
        dept, shift = _resolve(cfg, name)
        if department == "none" and dept:
            continue
        if department not in ("", "none") and dept != department:
            continue
        sh, sm = map(int, shift["start"].split(":"))
        rows, tot = [], {"present": 0, "late": 0, "absent": 0, "seconds": 0}
        for d in days:
            work = d.weekday() in cfg["workdays"]
            start = datetime.combine(d, dtime(sh, sm))
            late_after = start + timedelta(minutes=cfg["grace"])
            vs = by.get((name.lower(), d), [])
            row = {"date": d.isoformat(), "status": "", "first_in": "", "last_out": "", "minutes": 0, "late_minutes": 0}
            if vs:
                first, last = min(v["start"] for v in vs), max(v["end"] for v in vs)
                secs = sum(int((v["end"] - v["start"]).total_seconds()) for v in vs)
                late = work and first > late_after
                row.update(status="late" if late else "present", first_in=first.strftime("%H:%M"),
                           last_out=last.strftime("%H:%M"), minutes=round(secs / 60),
                           late_minutes=int((first - start).total_seconds() // 60) if late else 0)
                tot["present"] += 1
                tot["late"] += 1 if late else 0
                tot["seconds"] += secs
                by_day[d]["present"] += 1
                by_day[d]["late"] += 1 if late else 0
            elif not work:
                row["status"] = "off"
            elif d > today:
                row["status"] = "upcoming"
            elif d == today and now <= late_after:
                row["status"] = "pending"
            else:
                row["status"] = "absent"
                tot["absent"] += 1
                by_day[d]["absent"] += 1
            rows.append(row)
        people.append({"name": name, "department": dept, "shift": shift, "present": tot["present"],
                       "late": tot["late"], "absent": tot["absent"], "hours": round(tot["seconds"] / 3600, 1),
                       "rows": rows})
    return {"from": d_from.isoformat(), "to": d_to.isoformat(), "department": department,
            "departments": cfg["departments"], "grace": cfg["grace"],
            "totals": {"people": len(people), "present": sum(p["present"] for p in people),
                       "late": sum(p["late"] for p in people), "absent": sum(p["absent"] for p in people)},
            "by_day": [{"date": d.isoformat(), **by_day[d]} for d in days],
            "people": people}


def csv_text(rep):
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["date", "person", "department", "shift", "shift_start", "status", "first_in", "last_out",
                "minutes_present", "minutes_late"])
    for p in rep["people"]:
        for r in p["rows"]:
            w.writerow([r["date"], p["name"], p["department"], p["shift"]["name"], p["shift"]["start"],
                        r["status"], r["first_in"], r["last_out"], r["minutes"], r["late_minutes"]])
    return "\ufeff" + out.getvalue()