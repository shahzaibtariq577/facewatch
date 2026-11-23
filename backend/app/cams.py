"""Phase 3D: a list of cameras (name, location, type, source) and 'use this camera'.
engine.py is not changed: choosing a camera copies its source into the normal settings
(source_mode, cam_index, url, video_path), which the engine already reads when you press Start."""
import json
import os
import re
import secrets
import threading

from . import storage as st

FILE = os.path.join(st.DATA_DIR, "cameras.json")
MAX_CAMS = 8
KINDS = ("webcam", "network", "video")
URL_OK = re.compile(r"(rtsp|rtmp|http|https)://\S+", re.I)
_lock = threading.RLock()


class NotFound(ValueError):
    pass


class Conflict(ValueError):
    pass


def _text(v, n):
    s = re.sub(r"[\x00-\x1f\x7f]", "", str(v or ""))
    return re.sub(r"\s+", " ", s).strip()[:n]


def mask(url):
    return re.sub(r"//[^@/]*@", "//", url or "")      # never show a password


def _read():
    try:
        with open(FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, list) else None
    except Exception:
        return None


def _write(items):
    st.init_dirs()
    tmp = FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=2)
    os.replace(tmp, FILE)


def _seed(cfg):
    kind = cfg.get("source_mode", "webcam")
    kind = kind if kind in KINDS else "webcam"
    name = {"webcam": "Camera 1", "network": "Network camera", "video": "Video file"}[kind]
    return {"id": "c" + secrets.token_hex(3), "name": name, "location": "", "kind": kind,
            "index": int(cfg.get("cam_index", 0)), "url": cfg.get("url", ""), "path": cfg.get("video_path", "")}


def load(cfg):
    """The saved cameras. The first time, one camera is made from the current Video source setting."""
    with _lock:
        items = _read()
        if items is None:
            items = [_seed(cfg)]
            _write(items)
        return items


def source_label(c):
    if c["kind"] == "webcam":
        return f"Webcam {c['index']}"
    if c["kind"] == "network":
        return mask(c["url"])
    return os.path.basename(c["path"].replace("\\", "/")) or c["path"]


def is_active(cfg, c):
    if cfg.get("source_mode") != c["kind"]:
        return False
    if c["kind"] == "webcam":
        return cfg.get("cam_index") == c["index"]
    if c["kind"] == "network":
        return cfg.get("url") == c["url"]
    return cfg.get("video_path") == c["path"]


def public(cfg, c):
    return {"id": c["id"], "name": c["name"], "location": c["location"], "kind": c["kind"],
            "index": c["index"], "path": c["path"], "has_url": bool(c["url"]),
            "source": source_label(c), "active": is_active(cfg, c)}


def _source(c):
    return (c["kind"], c["index"], c["url"], c["path"])


def _build(payload, items, old=None):
    """Check the form and return a camera record. ValueError has a friendly message."""
    base = dict(old) if old else {"id": "c" + secrets.token_hex(3), "name": "", "location": "",
                                  "kind": "webcam", "index": 0, "url": "", "path": ""}
    if "name" in payload or not old:
        base["name"] = _text(payload.get("name"), 40)
    if "location" in payload:
        base["location"] = _text(payload.get("location"), 40)
    if "kind" in payload:
        base["kind"] = str(payload.get("kind"))
    if not base["name"]:
        raise ValueError("Give the camera a name.")
    if any(x["name"].lower() == base["name"].lower() and x["id"] != base["id"] for x in items):
        raise Conflict("Another camera already has this name.")
    if base["kind"] not in KINDS:
        raise ValueError("Choose a camera type.")
    if base["kind"] == "webcam":
        i = payload.get("index", base["index"])
        if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i <= 9:
            raise ValueError("The webcam number must be between 0 and 9.")
        base["index"] = i
    elif base["kind"] == "network":
        url = str(payload.get("url") or "").strip()
        if url:
            if not URL_OK.fullmatch(url):
                raise ValueError("The address must start with rtsp://, http:// or https://.")
            base["url"] = url
        elif not base["url"]:
            raise ValueError("Type the network camera address.")
    else:
        path = _text(payload.get("path", base["path"]), 260)
        if not path:
            raise ValueError("Type the path of the video file.")
        base["path"] = path
    return base


def _find(items, cid):
    for i, c in enumerate(items):
        if c["id"] == cid:
            return i
    raise NotFound("Camera not found.")


def _apply(cfg, c):
    cfg.update(source_mode=c["kind"], cam_index=c["index"], url=c["url"], video_path=c["path"])
    st.save_settings(cfg)


def add(cfg, payload):
    with _lock:
        items = load(cfg)
        if len(items) >= MAX_CAMS:
            raise ValueError(f"You can save at most {MAX_CAMS} cameras.")
        c = _build(payload, items)
        items.append(c)
        _write(items)
        return c


def update(cfg, running, cid, payload):
    with _lock:
        items = load(cfg)
        i = _find(items, cid)
        old = items[i]
        new = _build(payload, items, old)
        was_active = is_active(cfg, old)
        if _source(new) != _source(old):
            if was_active and running:
                raise Conflict("Stop watching first to change the camera that is in use.")
        items[i] = new
        _write(items)
        if new["name"] != old["name"]:
            _rename_source(old["name"], new["name"])
        if was_active and _source(new) != _source(old):
            _apply(cfg, new)
        return new


def remove(cfg, running, cid):
    with _lock:
        items = load(cfg)
        i = _find(items, cid)
        if running and is_active(cfg, items[i]):
            raise Conflict("Stop watching first to remove the camera that is in use.")
        c = items.pop(i)
        _write(items)
        return c


def use(cfg, running, cid):
    with _lock:
        items = load(cfg)
        c = items[_find(items, cid)]
        if running:
            raise Conflict("Stop watching first, then choose another camera.")
        _apply(cfg, c)
        return c



# ------------------------------------------------- per-camera views (3F)
def legacy_label(c):
    """What older alerts called this camera, before names were used (the engine's old source label)."""
    if c["kind"] == "webcam":
        return f"Camera {c['index']}"
    if c["kind"] == "network":
        return mask(c["url"])
    return os.path.basename(c["path"].replace("\\", "/")) or c["path"]


def active_name(cfg):
    for c in load(cfg):
        if is_active(cfg, c):
            return c["name"]
    return None


def keyer(cfg):
    """Function: the source text of an alert -> the name of the saved camera it belongs to
    (or the source text itself when no saved camera owns it)."""
    items = load(cfg)
    table = {}
    for c in items:
        table.setdefault(legacy_label(c).lower(), c["name"])
    for c in items:
        table[c["name"].lower()] = c["name"]
    return lambda src: table.get((src or "").lower(), src or "Unknown source")


def pick(cfg, rows, camera=""):
    """Alert rows of one camera (all rows when camera is empty)."""
    if not camera:
        return rows
    k, want = keyer(cfg), camera.lower()
    return [r for r in rows if k(r.get("source", "")).lower() == want]


def pick_unknown(cfg, items, camera=""):
    if not camera:
        return items
    k, want = keyer(cfg), camera.lower()
    return [x for x in items if k(x.get("source", "")).lower() == want]


def options(cfg):
    """Saved cameras first, then any other source name found in the alert history."""
    items = load(cfg)
    out = [{"name": c["name"], "location": c["location"]} for c in items]
    k, known = keyer(cfg), {c["name"].lower() for c in items}
    for src in sorted({k(r.get("source", "")) for r in st.read_log()}):
        if src.lower() not in known and len(out) < 30:
            out.append({"name": src, "location": ""})
            known.add(src.lower())
    return out


def by_camera(cfg, rows, start, stop, gap):
    """Visits, people and alerts per camera inside the date range (start / stop may be None)."""
    k = keyer(cfg)
    groups = {c["name"]: {"name": c["name"], "location": c["location"], "rows": []} for c in load(cfg)}
    for r in rows:
        key = k(r.get("source", ""))
        groups.setdefault(key, {"name": key, "location": "", "rows": []})["rows"].append(r)
    out = []
    for g in groups.values():
        vs = [v for v in st.build_visits(g["rows"], gap)
              if (start is None or v["start"] >= start) and (stop is None or v["start"] < stop)]
        out.append({"name": g["name"], "location": g["location"], "visits": len(vs),
                    "alerts": sum(v["alerts"] for v in vs), "people": len({v["name"] for v in vs})})
    return sorted(out, key=lambda x: (-x["visits"], x["name"].lower()))


def _rename_source(old, new):
    """A camera was renamed: old alerts and Not recognised events follow the new name."""
    import csv
    with st._lock:
        try:
            with open(st.LOG_FILE, newline="", encoding="utf-8") as f:
                rows = list(csv.reader(f))
            si = rows[0].index("source")
            n = 0
            for r in rows[1:]:
                if len(r) > si and r[si] == old:
                    r[si] = new
                    n += 1
            if n:
                tmp = st.LOG_FILE + ".tmp"
                with open(tmp, "w", newline="", encoding="utf-8") as f:
                    csv.writer(f).writerows(rows)
                os.replace(tmp, st.LOG_FILE)
        except Exception:
            pass
        try:
            items = st._read_unknown_raw()
            hit = [x for x in items if x.get("source") == old]
            for x in hit:
                x["source"] = new
            if hit:
                st._write_unknown_raw(items)
        except Exception:
            pass


# --------------------------------------------------------------------- API
def make_router(cfg, engine):
    from fastapi import APIRouter, Body, HTTPException

    r = APIRouter()

    def call(fn, *a):
        try:
            return fn(*a)
        except NotFound as e:
            raise HTTPException(404, str(e))
        except Conflict as e:
            raise HTTPException(409, str(e))
        except ValueError as e:
            raise HTTPException(400, str(e))

    @r.get("/api/cams")
    def cams_get():
        return {"items": [public(cfg, c) for c in load(cfg)], "running": bool(engine.running), "max": MAX_CAMS}

    @r.get("/api/cams/sources")
    def cams_sources():
        return {"items": options(cfg)}

    @r.post("/api/cams", status_code=201)
    def cams_add(payload: dict = Body(...)):
        c = call(add, cfg, payload)
        return {"id": c["id"], "name": c["name"]}

    @r.put("/api/cams/{cid}")
    def cams_put(cid: str, payload: dict = Body(...)):
        c = call(update, cfg, bool(engine.running), cid, payload)
        return {"id": c["id"], "name": c["name"]}

    @r.delete("/api/cams/{cid}")
    def cams_delete(cid: str):
        c = call(remove, cfg, bool(engine.running), cid)
        return {"id": c["id"], "name": c["name"]}

    @r.post("/api/cams/{cid}/use")
    def cams_use(cid: str):
        c = call(use, cfg, bool(engine.running), cid)
        return {"id": c["id"], "name": c["name"]}

    return r