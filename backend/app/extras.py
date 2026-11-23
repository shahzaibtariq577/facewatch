"""Extra endpoints: system health, visit history, notification centre, analytics, end-of-day report."""
import os
import platform
import shutil
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Response

from . import notify, report
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

    # ---- v13 (2E): system health
    def _tree_mb(path):
        total = 0
        for root, _d, files in os.walk(path):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(root, f))
                except OSError:
                    pass
        return round(total / 1048576, 1)

    _cache = {"at": 0.0, "sizes": {}}

    def _data_sizes():
        """Folder sizes are slow to add up, so they are cached for 30 seconds."""
        if time.time() - _cache["at"] > 30:
            _cache["at"] = time.time()
            _cache["sizes"] = {"people_mb": _tree_mb(st.PEOPLE_DIR), "pictures_mb": st.matches_usage()["mb"],
                               "unknown_mb": _tree_mb(st.UNKNOWN_DIR), "models_mb": _tree_mb(st.MODEL_DIR)}
        return _cache["sizes"]

    def _checks(h):
        c = []

        def add(level, title, text):
            c.append({"level": level, "title": title, "text": text})

        if h["models_error"]:
            add("error", "Face models", h["models_error"])
        elif not h["models_ready"]:
            add("warn", "Face models", "Still loading. Wait a moment.")
        else:
            add("ok", "Face models", "Loaded.")
        if h["state"] == "error":
            add("error", "Camera", "The camera could not be opened. Check that it is connected and not used by another app.")
        elif h["state"] == "reconnecting":
            add("error", "Camera", "Disconnected. FaceWatch is trying to reconnect.")
        elif h["running"] and h["paused"]:
            add("warn", "Camera", "Watching is paused. Nobody is being checked.")
        elif h["running"]:
            add("ok", "Camera", "Connected" + (f" ({h['resolution']})" if h["resolution"] else "") + ".")
        else:
            add("info", "Camera", "Not watching. Press Start on the Live page.")
        if h["running"] and not h["paused"] and 0 < h["fps"] < 5:
            add("warn", "Speed", f"Only {h['fps']} frames per second. Matching may miss quick passers-by.")
        if h["cpu"] is not None and h["cpu"] >= 90:
            add("warn", "Processor", f"The laptop processor is at {h['cpu']}%.")
        if h["ram"] is not None and h["ram"] >= 90:
            add("warn", "Memory", f"The laptop memory is at {h['ram']}% (all programs together).")
        if h["disk"] >= 95 or h["disk_free_gb"] < 1:
            add("error", "Disk", f"Almost full: {h['disk_free_gb']} GB free.")
        elif h["disk"] >= 90 or h["disk_free_gb"] < 5:
            add("warn", "Disk", f"Getting full: {h['disk_free_gb']} GB free.")
        else:
            add("ok", "Disk", f"{h['disk_free_gb']} GB free.")
        if h["pictures_mb"] > 1000:
            add("warn", "Pictures", f"Alert pictures use {h['pictures_mb']} MB. Set a smaller keep-days value in Settings.")
        if h["people"] == 0:
            add("warn", "People", "No saved people. Nobody can be recognised yet.")
        p = h["phone"]
        if p["last_error"]:
            add("warn", "Phone alerts", p["last_error"])
        elif p["ntfy"] or p["telegram"]:
            add("ok", "Phone alerts", "Set up: " + " and ".join(n for n, on in (("ntfy", p["ntfy"]), ("Telegram", p["telegram"])) if on) + ".")
        else:
            add("info", "Phone alerts", "Not set up. Add an ntfy topic in Settings.")
        if h["daily_summary"]["on"] and not (p["ntfy"] or p["telegram"]):
            add("warn", "Daily summary", "It is turned on, but no phone channel is set up, so nothing can be sent.")
        if not h["psutil"]:
            add("info", "Monitoring", "Install psutil to see processor and memory (pip install psutil).")
        return c

    @r.get("/api/health")
    def health():
        usage = shutil.disk_usage(st.DATA_DIR)
        stat = engine.status()
        out = {"cpu": None, "ram": None, "app_mb": None,
               "disk": round(usage.used / usage.total * 100),
               "disk_free_gb": round(usage.free / 1e9, 1),
               "running": bool(engine.running), "paused": bool(engine.paused),
               "fps": stat.get("fps", 0), "uptime": int(time.time() - STARTED),
               "state": stat.get("state"), "source": stat.get("source", ""),
               "resolution": stat.get("resolution", ""), "people": stat.get("people", 0),
               "models_ready": bool(engine.models_ready), "models_error": engine.models_error,
               "psutil": psutil is not None, "python": platform.python_version()}
        out.update(_data_sizes())
        out["data_mb"] = round(sum(out[k] for k in ("people_mb", "pictures_mb", "unknown_mb", "models_mb")), 1)
        if psutil:
            out["cpu"] = round(psutil.cpu_percent(None))
            out["ram"] = round(psutil.virtual_memory().percent)
            try:
                out["app_mb"] = round(psutil.Process().memory_info().rss / 1048576)
            except Exception:
                pass
        out["phone"] = {"ntfy": notify.ntfy_ready(cfg), "telegram": notify.telegram_ready(cfg),
                        "last_error": notify.last_error}
        out["daily_summary"] = {"on": bool(cfg.get("daily_summary")), "time": cfg.get("daily_summary_time", "18:00"),
                                "last": cfg.get("daily_summary_last", "")}
        out["checks"] = _checks(out)
        rank = {"ok": 0, "info": 0, "warn": 1, "error": 2}
        out["overall"] = max((c["level"] for c in out["checks"]), key=lambda l: rank[l], default="ok")
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

    # ---- v12 (2D): end-of-day report
    def _day(date):
        if not date:
            return datetime.now().date()
        try:
            return datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "Use the date format YYYY-MM-DD.")

    @r.get("/api/report")
    def day_report(date: str = ""):
        return report.build(cfg, _day(date))

    @r.get("/api/report/export")
    def day_report_csv(date: str = ""):
        rep = report.build(cfg, _day(date))
        return Response(report.csv_text(rep), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="facewatch_report_{rep["date"]}.csv"'})

    @r.post("/api/report/send")
    def day_report_send(date: str = ""):
        try:
            notify.send_now(cfg, report.summary_text(report.build(cfg, _day(date))), tags=["bar_chart"])
        except Exception as e:
            raise HTTPException(400, str(e))
        return {"ok": True}

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