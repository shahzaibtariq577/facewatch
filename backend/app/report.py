"""End-of-day report and the daily summary message (presence and attendance only)."""
import csv
import io
import threading
import time
from datetime import datetime, timedelta

from . import notify
from . import storage as st

FMT = st.TIME_FMT


def build(cfg, day):
    """Facts for one day (a date). Only who was seen and when. No scores or judgements."""
    ds = day.strftime("%Y-%m-%d")
    gap = max(cfg.get("visit_gap", 120), 2 * cfg.get("alert_interval", 10))
    rows = st.read_log()
    visits = [v for v in st.build_visits(rows, gap) if v["start"].date() == day]
    people = {}
    for v in visits:
        p = people.setdefault(v["name"], {"name": v["name"], "visits": 0, "alerts": 0, "seconds": 0,
                                          "first": v["start"], "last": v["end"]})
        p["visits"] += 1
        p["alerts"] += v["alerts"]
        p["seconds"] += int((v["end"] - v["start"]).total_seconds())
        p["first"] = min(p["first"], v["start"])
        p["last"] = max(p["last"], v["end"])
    table = sorted(people.values(), key=lambda p: p["first"])
    seen = {p["name"].lower() for p in table}
    not_seen = [p["name"] for p in st.people_summary() if p["name"].lower() not in seen]
    hourly = [0] * 24
    for v in visits:
        hourly[v["start"].hour] += 1
    busiest = hourly.index(max(hourly)) if any(hourly) else None
    notes, _unread, _total = st.read_notifications("camera", 500)
    cam = sum(1 for n in notes if n.get("time", "").startswith(ds) and n.get("kind") in ("lost", "error"))
    return {
        "date": ds, "is_today": day == datetime.now().date(),
        "people_seen": len(table), "visits": len(visits),
        "alerts": sum(1 for r in rows if r["time"].date() == day),
        "seconds": sum(p["seconds"] for p in table),
        "busiest_hour": busiest, "busiest_visits": hourly[busiest] if busiest is not None else 0,
        "unknown_events": sum(1 for x in st.read_unknown() if x.get("time", "").startswith(ds)),
        "camera_problems": cam, "not_seen": not_seen,
        "people": [{"name": p["name"], "visits": p["visits"], "alerts": p["alerts"], "seconds": p["seconds"],
                    "first": p["first"].strftime(FMT), "last": p["last"].strftime(FMT)} for p in table],
    }


def summary_text(rep):
    day = datetime.strptime(rep["date"], "%Y-%m-%d").strftime("%a %d %b")
    lines = [f"FaceWatch daily summary, {day}",
             f"People seen: {rep['people_seen']}. Visits: {rep['visits']}."]
    if rep["people"]:
        first = rep["people"][0]
        lines.append(f"First seen: {first['name']} at {first['first'][11:16]}.")
    if rep["not_seen"]:
        names = rep["not_seen"]
        shown = ", ".join(names[:10]) + (f" and {len(names) - 10} more" if len(names) > 10 else "")
        lines.append(f"Not seen: {shown}.")
    if rep["busiest_hour"] is not None:
        h = rep["busiest_hour"]
        lines.append(f"Busiest hour: {h:02d}:00 to {(h + 1) % 24:02d}:00.")
    lines.append(f"Not recognised faces: {rep['unknown_events']}. Camera problems: {rep['camera_problems']}.")
    return "\n".join(lines)


def csv_text(rep):
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["date", "person", "first_seen", "last_seen", "visits", "minutes_present", "alerts"])
    for p in rep["people"]:
        w.writerow([rep["date"], p["name"], p["first"][11:19], p["last"][11:19], p["visits"],
                    round(p["seconds"] / 60, 1), p["alerts"]])
    for n in rep["not_seen"]:
        w.writerow([rep["date"], n, "", "", 0, 0, 0])
    return "\ufeff" + out.getvalue()      # BOM so Excel reads the letters correctly


_state = {"retry_at": 0.0}


def check_and_send(cfg, now=None):
    """Send today's summary once, after the chosen time. Returns True if a message was sent."""
    if not cfg.get("daily_summary") or not notify.configured(cfg):
        return False
    now = now or datetime.now()
    today = now.strftime("%Y-%m-%d")
    if cfg.get("daily_summary_last") == today or now.strftime("%H:%M") < cfg.get("daily_summary_time", "18:00"):
        return False
    if time.time() < _state["retry_at"]:
        return False
    try:
        notify.send_now(cfg, summary_text(build(cfg, now.date())), tags=["bar_chart"])
    except Exception as e:
        _state["retry_at"] = time.time() + 1800         # try again in 30 minutes
        st.add_notification("system", "error", f"Daily summary could not be sent: {e}")
        return False
    cfg["daily_summary_last"] = today
    st.save_settings(cfg)
    st.add_notification("system", "summary", "Daily summary sent to your phone.")
    return True


def summary_loop(cfg):
    while True:
        try:
            check_and_send(cfg)
        except Exception:
            pass
        time.sleep(30)


def start(cfg):
    threading.Thread(target=summary_loop, args=(cfg,), daemon=True).start()