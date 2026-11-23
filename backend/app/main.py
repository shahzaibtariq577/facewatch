"""FaceWatch REST API (FastAPI). Run with:  uvicorn app.main:app --port 8000"""
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, time as dtime
from typing import List

import cv2
from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import notify
from . import storage as st
from .engine import Engine, StartError, check_photo
from . import report
from .extras import make_router
from . import privacy
from . import audit
from . import users
from . import cams

st.init_dirs()
cfg = st.load_settings()
engine = Engine(cfg)
engine.reload_people()


@asynccontextmanager
async def lifespan(_app):
    def boot():
        engine.load_models()
        if engine.models_ready and cfg["autostart"] and engine.people and cfg["source_mode"] != "video":
            try:
                engine.start()
            except StartError:
                pass
    def janitor():                      # delete old pictures now and then every hour
        while True:
            st.cleanup_matches(cfg.get("keep_days", 0))
            st.cleanup_unknown(cfg.get("keep_days", 0))
            time.sleep(3600)
    threading.Thread(target=boot, daemon=True).start()
    threading.Thread(target=janitor, daemon=True).start()
    report.start(cfg)
    yield
    engine.stop()
    st.save_settings(cfg)


app = FastAPI(title="FaceWatch", version="6.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])
app.mount("/snapshots", StaticFiles(directory=st.MATCH_DIR), name="snapshots")


# ----------------------------------------------------------------- control
@app.get("/api/status")
def status():
    return engine.status()


@app.post("/api/start")
def start():
    try:
        engine.start()
    except StartError as e:
        raise HTTPException(400, str(e))
    return engine.status()


@app.post("/api/stop")
def stop():
    engine.stop()
    return engine.status()


@app.post("/api/pause")
def pause():
    engine.pause()
    return engine.status()


@app.post("/api/resume")
def resume():
    engine.resume()
    return engine.status()


@app.get("/api/stream")
def stream():
    if not engine.running:
        raise HTTPException(409, "Not watching.")
    return StreamingResponse(engine.frames(), media_type="multipart/x-mixed-replace; boundary=frame",
                             headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- settings
def public_cfg():
    """Settings for the browser. The Telegram token is never sent back."""
    out = {k: v for k, v in cfg.items() if k != "telegram_token"}
    out["telegram_token_set"] = bool(cfg.get("telegram_token"))
    return out


@app.get("/api/settings")
def get_settings():
    return public_cfg()


@app.put("/api/settings")
def put_settings(patch: dict = Body(...)):
    cfg.update(st.clean_settings(patch))
    if isinstance(patch.get("telegram_token"), str) and not patch["telegram_token"].strip():
        cfg["telegram_token"] = ""          # empty box clears the saved token
    st.save_settings(cfg)
    return public_cfg()


@app.post("/api/notify/test")
def notify_test():
    try:
        notify.send_now(cfg, "FaceWatch test message: phone alerts work.")
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@app.get("/api/cameras")
def cameras():
    if engine.running:
        raise HTTPException(409, "Stop watching first, then scan.")
    found = []
    for i in range(4):
        try:
            cap = cv2.VideoCapture(i)
            if cap.isOpened():
                found.append(i)
            cap.release()
        except Exception:
            pass
    return {"cameras": found}


# ------------------------------------------------------------------ people
def _changed():
    engine.reload_people()


async def _vet(files):
    """Read uploads, drop unreadable / faceless photos, collect warnings."""
    good, notes = [], []
    for f in files:
        data = await f.read()
        label = f.filename or "photo"
        img = st.decode_image(data)
        if img is None:
            notes.append(f"{label}: not a readable image, skipped")
            continue
        if engine.models_ready:
            try:
                usable, msg = check_photo(img)
            except Exception:
                usable, msg = True, ""
            if not usable:
                notes.append(f"{label}: no face found, skipped")
                continue
            if msg:
                notes.append(f"{label}: {msg}")
        good.append(data)
    return good, notes


@app.get("/api/people")
def people():
    return st.people_summary()


@app.post("/api/people", status_code=201)
async def add_person(name: str = Form(...), files: List[UploadFile] = File(...)):
    clean = st.safe_name(name)
    if not clean:
        raise HTTPException(400, "Please use letters or numbers in the name.")
    clean = st.find_person(clean) or clean
    good, notes = await _vet(files)
    if not good:
        raise HTTPException(400, "No usable photo. " + " | ".join(notes))
    added = st.add_photos(clean, good)
    if not added:
        raise HTTPException(400, "Could not read the selected image(s).")
    _changed()
    return {"name": clean, "added": added, "notes": notes}


@app.post("/api/people/{name}/photos", status_code=201)
async def add_photos(name: str, files: List[UploadFile] = File(...)):
    real = st.find_person(st.safe_name(name))
    if not real:
        raise HTTPException(404, "Person not found.")
    good, notes = await _vet(files)
    if not good:
        raise HTTPException(400, "No usable photo. " + " | ".join(notes))
    added = st.add_photos(real, good)
    if not added:
        raise HTTPException(400, "Could not read the selected image(s).")
    _changed()
    return {"name": real, "added": added, "notes": notes}


@app.delete("/api/people/{name}", status_code=204)
def remove_person(name: str):
    real = st.find_person(st.safe_name(name))
    if not real:
        raise HTTPException(404, "Person not found.")
    st.remove_person(real)
    _changed()
    return Response(status_code=204)


@app.get("/api/people/{name}/thumb")
def thumb(name: str):
    real = st.find_person(st.safe_name(name))
    data = st.thumbnail(real) if real else None
    if data is None:
        raise HTTPException(404, "No photo.")
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "no-cache"})


# ----------------------------------------------- "Not recognised" events
def _unk(x):
    return {"id": x["id"], "time": x["time"], "score": x.get("score", 0), "source": x.get("source", ""),
            "status": x.get("status", "new"), "person": x.get("person", ""),
            "face": bool(x.get("face")), "full": bool(x.get("full"))}


@app.get("/api/unknown")
def unknown_list(limit: int = 100):
    items = st.read_unknown()
    return {"new": sum(1 for x in items if x.get("status", "new") == "new"),
            "total": len(items),
            "items": [_unk(x) for x in items[:max(1, min(limit, 500))]]}


@app.get("/api/unknown/{uid}/image")
def unknown_image(uid: str, kind: str = "face"):
    path = st.unknown_path(uid, "full" if kind == "full" else "face")
    if not path:
        raise HTTPException(404, "No picture.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.post("/api/unknown/{uid}/dismiss")
def unknown_dismiss(uid: str):
    if not st.set_unknown_status(uid, "dismissed"):
        raise HTTPException(404, "Event not found.")
    return {"ok": True}


@app.delete("/api/unknown/{uid}", status_code=204)
def unknown_delete(uid: str):
    if not st.delete_unknown(uid):
        raise HTTPException(404, "Event not found.")
    return Response(status_code=204)


@app.post("/api/unknown/{uid}/add-person", status_code=201)
def unknown_add_person(uid: str, payload: dict = Body(...)):
    """Make a saved person from the face close-up of an event."""
    item = st.get_unknown(uid)
    path = st.unknown_path(uid, "face")
    if not item or not path:
        raise HTTPException(404, "This event has no face picture.")
    clean = st.safe_name(str(payload.get("name", "")))
    if not clean:
        raise HTTPException(400, "Please use letters or numbers in the name.")
    clean = st.find_person(clean) or clean
    img = st.read_image(path)
    if img is None:
        raise HTTPException(400, "Could not read the picture.")
    note = ""
    if engine.models_ready:
        try:
            usable, msg = check_photo(img)
        except Exception:
            usable, msg = True, ""
        if not usable:
            raise HTTPException(400, "No clear face found in this picture, so it was not added.")
        note = msg
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok or not st.add_photos(clean, [buf.tobytes()]):
        raise HTTPException(400, "Could not save the photo.")
    st.set_unknown_status(uid, "added", clean)
    _changed()
    return {"name": clean, "note": note}


# ------------------------------------------------------------------ alerts
def _face(snap):
    name = st.FACE_PREFIX + snap if snap else ""
    return name if name and os.path.exists(os.path.join(st.MATCH_DIR, name)) else ""


def _full(snap):
    return snap if snap and os.path.exists(os.path.join(st.MATCH_DIR, snap)) else ""


def _row(r):
    return {"id": r["id"], "time": r["time"].strftime(st.TIME_FMT), "name": r["name"],
            "score": r["score"], "snapshot": _full(r["snapshot"]), "face": _face(r["snapshot"]),
            "source": r["source"]}


@app.get("/api/alerts")
def alerts(limit: int = 15):
    rows = st.read_log()
    return [_row(r) for r in reversed(rows[-max(1, min(limit, 500)):])]


@app.get("/api/alerts/export")
def export_alerts():
    if not os.path.exists(st.LOG_FILE):
        raise HTTPException(404, "No alerts to export yet.")
    return FileResponse(st.LOG_FILE, media_type="text/csv", filename="facewatch_alerts.csv")


@app.delete("/api/alerts", status_code=204)
def clear_alerts():
    st.clear_log()
    return Response(status_code=204)


@app.get("/api/storage")
def storage_info():
    return st.matches_usage()


@app.delete("/api/snapshots")
def delete_snapshots():
    st.delete_all_matches()
    return st.matches_usage()


@app.get("/api/dashboard")
def dashboard(days: int = 0, date_from: str = "", date_to: str = "", camera: str = ""):
    """days: 1 = today, 7, 30, or 0 = all time. Or a custom range with date_from and date_to
    (YYYY-MM-DD). Also returns the previous equal period for comparison."""
    days = days if days in (1, 7, 30) else 0
    all_rows = st.read_log()
    rows = cams.pick(cfg, all_rows, camera)
    now = datetime.now()
    today = now.date()
    start, stop, prev_start, span = st.resolve_range(days, date_from, date_to)
    ranged = start is not None
    in_range = [r for r in rows if (start is None or r["time"] >= start) and (stop is None or r["time"] < stop)]
    prev_alerts = (sum(1 for r in rows if prev_start <= r["time"] < start) if ranged else None)
    todays = [r for r in rows if r["time"].date() == today]
    hourly = [0] * 24
    for r in todays:
        hourly[r["time"].hour] += 1

    range_count = {}
    for r in in_range:
        range_count[r["name"]] = range_count.get(r["name"], 0) + 1

    stats = {}
    for r in rows:
        s = stats.setdefault(r["name"], {"today": 0, "total": 0, "last": None, "first": None, "face": ""})
        s["total"] += 1
        s["face"] = _face(r["snapshot"]) or s["face"]
        if r["time"].date() == today:
            s["today"] += 1
        if s["last"] is None or r["time"] > s["last"]:
            s["last"] = r["time"]
        if s["first"] is None or r["time"] < s["first"]:
            s["first"] = r["time"]
    names = sorted({p["name"] for p in st.people_summary()} | set(stats))
    by_person = [{"name": n, "today": stats.get(n, {}).get("today", 0),
                  "range": range_count.get(n, 0),
                  "total": stats.get(n, {}).get("total", 0),
                  "face": stats.get(n, {}).get("face", ""),
                  "last": stats[n]["last"].strftime(st.TIME_FMT) if n in stats else None,
                  "first": stats[n]["first"].strftime(st.TIME_FMT) if n in stats else None} for n in names]

    # visits: alerts of one person closer together than the gap form one visit
    gap = max(cfg.get("visit_gap", 120), 2 * cfg.get("alert_interval", 10))
    all_visits = st.build_visits(rows, gap)
    visits_today = sum(1 for v in all_visits if v["start"].date() == today)
    range_visits = [v for v in all_visits
                    if (start is None or v["start"] >= start) and (stop is None or v["start"] < stop)]
    prev_visits = (sum(1 for v in all_visits if prev_start <= v["start"] < start) if ranged else None)
    visits = [{"name": v["name"], "start": v["start"].strftime(st.TIME_FMT),
               "end": v["end"].strftime(st.TIME_FMT),
               "seconds": int((v["end"] - v["start"]).total_seconds()),
               "alerts": v["alerts"], "face": v["face"],
               "active": (now - v["end"]).total_seconds() <= gap}
              for v in sorted(range_visits, key=lambda v: v["end"], reverse=True)[:200]]

    last = max(rows, key=lambda r: r["time"]) if rows else None
    by_camera = cams.by_camera(cfg, all_rows, start, stop, gap)
    return {
        "by_camera": by_camera,
        "today": len(todays), "total": len(rows), "people": engine.people_count,
        "visits_today": visits_today, "visits": visits,
        "days": days, "custom": ranged and days == 0, "span_days": span, "range_alerts": len(in_range), "range_visits": len(range_visits),
        "prev_alerts": prev_alerts, "prev_visits": prev_visits,
        "last": {"time": last["time"].strftime(st.TIME_FMT), "name": last["name"]} if last else None,
        "hourly": hourly, "by_person": by_person,
        "history": [_row(r) for r in reversed(in_range[-300:])],
    }


app.include_router(make_router(cfg, engine))
app.include_router(privacy.make_router(cfg, engine))
app.include_router(audit.make_router())
app.include_router(users.make_router())
app.include_router(cams.make_router(cfg, engine))


# --------------------------------------------- serve the built React app
DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                    "frontend", "dist")
if os.path.isdir(DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST, "assets")), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = os.path.join(DIST, path)
        return FileResponse(f if path and os.path.isfile(f) else os.path.join(DIST, "index.html"))