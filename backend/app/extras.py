"""Extra endpoints: system health and per-person visit history."""
import shutil
import time
from datetime import datetime

from fastapi import APIRouter

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

    return r