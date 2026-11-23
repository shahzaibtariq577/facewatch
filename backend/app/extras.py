"""Extra endpoints: system health, per-person visit history, notification centre."""
import shutil
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Response

from . import storage as st

try:
    import psutil
    psutil.cpu_percent(None)        # first call is always 0, so prime it
except Exception:
    psutil = None

STARTED = time.time()
FMT = st.TIME_FMT


def make_router(cfg, engine):
    r = APIRouter()

    @r.get("/api/health")
    def health():
        usage = shutil.disk_usage(st.DATA_DIR)
        out = {"cpu": None, "ram": None,
               "disk": round(usage.used / usage.total * 100),
               "disk_free_gb": round(usage.free / 1e9, 1),
               "pictures_mb": st.matches_usage()["mb"],
               "running": bool(engine.running),
               "fps": engine.status().get("fps", 0),
               "uptime": int(time.time() - STARTED)}
        if psutil:
            out["cpu"] = round(psutil.cpu_percent(None))
            out["ram"] = round(psutil.virtual_memory().percent)
            try:
                out["app_mb"] = round(psutil.Process().memory_info().rss / 1048576)
            except Exception:
                out["app_mb"] = None
        return out

    @r.get("/api/people/{name}/history")
    def history(name: str):
        want = st.safe_name(name).lower()
        rows = [x for x in st.read_log() if x["name"].lower() == want]
        gap = max(cfg.get("visit_gap", 120), 2 * cfg.get("alert_interval", 10))
        now = datetime.now()
        visits = sorted(st.build_visits(rows, gap), key=lambda v: v["end"], reverse=True)
        items = [{"start": v["start"].strftime(FMT), "end": v["end"].strftime(FMT),
                  "seconds": int((v["end"] - v["start"]).total_seconds()),
                  "alerts": v["alerts"], "face": v["face"],
                  "active": (now - v["end"]).total_seconds() <= gap} for v in visits[:100]]
        return {"name": name, "visits": len(visits), "alerts": len(rows),
                "seconds": sum(i["seconds"] for i in items),
                "first": rows[0]["time"].strftime(FMT) if rows else None,
                "last": rows[-1]["time"].strftime(FMT) if rows else None,
                "items": items}

    # ---- v12 (2C): analytics
    @r.get("/api/analytics")
    def analytics(days: int = 0, date_from: str = "", date_to: str = ""):
        days = days if days in (1, 7, 30) else 0
        start, stop, _prev, span = st.resolve_range(days, date_from, date_to)
        rows = st.read_log()
        gap = max(cfg.get("visit_gap", 120), 2 * cfg.get("alert_interval", 10))
        visits = st.build_visits(rows, gap)        # oldest first
        today = datetime.now().date()

        def inside(t):
            return (start is None or t >= start) and (stop is None or t < stop)

        first_visit = {}
        for v in visits:
            first_visit.setdefault(v["name"], v)
        rv = [v for v in visits if inside(v["start"])]
        rr = [x for x in rows if inside(x["time"])]

        # visits per day (at most the last 31 days of the range)
        end_day = (stop - timedelta(days=1)).date() if stop else today
        if start:
            first_day = start.date()
        else:
            first_day = min((x["time"].date() for x in rows), default=today)
        first_day = max(first_day, end_day - timedelta(days=30))
        daily = []
        d = first_day
        while d <= end_day:
            dv = [v for v in rv if v["start"].date() == d]
            daily.append({"date": d.isoformat(), "visits": len(dv),
                          "alerts": sum(1 for x in rr if x["time"].date() == d),
                          "people": len({v["name"] for v in dv})})
            d += timedelta(days=1)

        hourly = [0] * 24
        for v in rv:
            hourly[v["start"].hour] += 1

        # last 8 weeks (Monday to Sunday), whatever range is chosen
        monday = today - timedelta(days=today.weekday())
        weekly = []
        for k in range(7, -1, -1):
            w0 = monday - timedelta(days=7 * k)
            wv = [v for v in visits if w0 <= v["start"].date() < w0 + timedelta(days=7)]
            weekly.append({"week": w0.isoformat(), "visits": len(wv), "people": len({v["name"] for v in wv})})

        first_n = sum(1 for v in rv if first_visit[v["name"]] is v)
        names = {v["name"] for v in rv}
        new_people = {n for n in names if inside(first_visit[n]["start"])}
        secs = [(v["end"] - v["start"]).total_seconds() for v in rv]
        return {"days": days, "span_days": span, "visits": len(rv), "alerts": len(rr),
                "people": len(names), "daily": daily, "hourly": hourly, "weekly": weekly,
                "first_time_visits": first_n, "repeat_visits": len(rv) - first_n,
                "new_people": len(new_people), "returning_people": len(names) - len(new_people),
                "avg_seconds": int(sum(secs) / len(secs)) if secs else 0,
                "daily_capped": bool(start and (end_day - start.date()).days > 30)}

    # ---- v12 (2B): notification centre
    @r.get("/api/notifications")
    def notifications(category: str = "", limit: int = 200):
        if category and category not in st.NOTIF_CATEGORIES:
            raise HTTPException(400, "Unknown category.")
        items, unread, total = st.read_notifications(category or None, limit)
        return {"unread": unread, "total": total, "items": items}

    @r.post("/api/notifications/read")
    def notifications_read(category: str = ""):
        if category and category not in st.NOTIF_CATEGORIES:
            raise HTTPException(400, "Unknown category.")
        return {"marked": st.mark_notifications_read(category or None)}

    @r.delete("/api/notifications", status_code=204)
    def notifications_clear():
        st.clear_notifications()
        return Response(status_code=204)

    return r