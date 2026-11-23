"""Files on disk: settings, people photos, alert log, face models."""
import csv
import json
import os
import re
import shutil
import threading
import time
import urllib.request
from datetime import datetime, timedelta

import cv2
import numpy as np

DATA_DIR = os.environ.get(
    "FACEWATCH_DATA", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"))
MODEL_DIR = os.path.join(DATA_DIR, "models")
PEOPLE_DIR = os.path.join(DATA_DIR, "people")
MATCH_DIR = os.path.join(DATA_DIR, "matches")
UNKNOWN_DIR = os.path.join(DATA_DIR, "unknown")        # v12: faces that were not recognised
UNKNOWN_FILE = os.path.join(DATA_DIR, "unknown.json")
NOTIF_FILE = os.path.join(DATA_DIR, "notifications.json")   # v12 (2B): notification centre
LOG_FILE = os.path.join(DATA_DIR, "match_log.csv")
CONFIG_FILE = os.path.join(DATA_DIR, "settings.json")

MAX_PHOTO_SIDE = 1280
FACE_PREFIX = "face_"   # close-up of the face is saved as face_<snapshot name>
IMAGE_TYPES = (".jpg", ".jpeg", ".png", ".bmp", ".webp")

DEFAULTS = {
    "threshold": 0.50, "alert_interval": 10, "beep": True, "snapshots": True,
    "autostart": True, "auto_reconnect": True,
    "save_full_frame": True, "keep_days": 7,      # keep_days 0 = keep forever
    "pictures_once": True,       # only the first alert of a visit saves pictures
    "source_mode": "webcam", "cam_index": 0, "url": "", "video_path": "",
    # v6
    "visit_gap": 120,            # seconds away before a return counts as a new visit
    "not_seen_minutes": 0,       # 0 = off
    "ntfy_topic": "", "ntfy_server": "https://ntfy.sh",
    "telegram_token": "", "telegram_chat": "",
    "notify_on_match": True, "notify_on_missing": True, "notify_send_photo": True,
    # v12 (Phase 2A)
    "unknown_events": True,      # save a "Not recognised" event when an unknown face stays in view
    "unknown_gap": 60,           # seconds to wait before the next "Not recognised" event
    "notify_on_unknown": True,   # send a phone alert (ntfy) for a "Not recognised" event
}
_TYPES = {k: type(v) for k, v in DEFAULTS.items()}

BASE = "https://github.com/opencv/opencv_zoo/raw/main/models/"
MODELS = {
    "yunet": ("face_detection_yunet_2023mar.onnx",
              BASE + "face_detection_yunet/face_detection_yunet_2023mar.onnx", 100_000),
    "sface": ("face_recognition_sface_2021dec.onnx",
              BASE + "face_recognition_sface/face_recognition_sface_2021dec.onnx", 10_000_000),
}

_lock = threading.Lock()


def init_dirs():
    for d in (DATA_DIR, MODEL_DIR, PEOPLE_DIR, MATCH_DIR, UNKNOWN_DIR):
        os.makedirs(d, exist_ok=True)


# ---------------------------------------------------------------- settings
def load_settings():
    cfg = dict(DEFAULTS)
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            cfg.update(clean_settings(json.load(f)))
    except Exception:
        pass
    return cfg


def clean_settings(patch):
    """Keep only known keys with the right type."""
    out = {}
    for k, v in (patch or {}).items():
        t = _TYPES.get(k)
        if t is None:
            continue
        if t is bool and isinstance(v, bool):
            out[k] = v
        elif t is float and isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = round(min(0.9, max(0.1, float(v))), 2)
        elif t is int and isinstance(v, int) and not isinstance(v, bool):
            out[k] = max(0, v)
        elif t is str and isinstance(v, str):
            out[k] = v.strip()
    if out.get("source_mode") not in (None, "webcam", "video", "network"):
        del out["source_mode"]
    if "ntfy_topic" in out:
        out["ntfy_topic"] = re.sub(r"[^A-Za-z0-9_-]", "", out["ntfy_topic"])[:64]
    if "ntfy_server" in out:
        srv = out["ntfy_server"].rstrip("/")
        out["ntfy_server"] = srv if srv.startswith(("http://", "https://")) else "https://ntfy.sh"
    return out


def save_settings(cfg):
    init_dirs()
    with _lock, open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


# ------------------------------------------------------------------ models
def model_path(key):
    return os.path.join(MODEL_DIR, MODELS[key][0])


def ensure_models():
    """Download the two small ONNX models on first run (about 40 MB)."""
    init_dirs()
    for key, (name, url, min_size) in MODELS.items():
        path = model_path(key)
        if os.path.exists(path) and os.path.getsize(path) >= min_size:
            continue
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
            shutil.copyfileobj(r, f)
        if os.path.getsize(path) < min_size:
            os.remove(path)
            raise RuntimeError(f"Download of {name} failed (file too small).")


# ------------------------------------------------------------------ images
def shrink(img):
    h, w = img.shape[:2]
    s = min(1.0, MAX_PHOTO_SIDE / max(h, w))
    return cv2.resize(img, (int(w * s), int(h * s))) if s < 1.0 else img


def decode_image(data: bytes):
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    return None if img is None else shrink(img)


def read_image(path):
    img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    return None if img is None else shrink(img)


def write_image(path, img, quality=90):
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if ok:
        buf.tofile(path)
    return ok


# ---------------------------------------------------------------- pictures
def cleanup_matches(days):
    """Delete alert pictures older than `days` days. 0 means keep everything."""
    if not days or not os.path.isdir(MATCH_DIR):
        return 0
    cutoff = time.time() - days * 86400
    removed = 0
    for f in os.listdir(MATCH_DIR):
        path = os.path.join(MATCH_DIR, f)
        try:
            if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                os.remove(path)
                removed += 1
        except OSError:
            pass
    return removed


def delete_all_matches():
    n = 0
    for f in os.listdir(MATCH_DIR) if os.path.isdir(MATCH_DIR) else []:
        try:
            os.remove(os.path.join(MATCH_DIR, f))
            n += 1
        except OSError:
            pass
    return n


def matches_usage():
    total, count = 0, 0
    for f in os.listdir(MATCH_DIR) if os.path.isdir(MATCH_DIR) else []:
        try:
            total += os.path.getsize(os.path.join(MATCH_DIR, f))
            count += 1
        except OSError:
            pass
    return {"mb": round(total / 1048576, 1), "files": count}


# ------------------------------------------------------------------ people
def safe_name(name):
    return re.sub(r"[^\w \-]", "", name or "", flags=re.UNICODE).strip()[:40]


def person_dir(name):
    return os.path.join(PEOPLE_DIR, name)


def find_person(name):
    """Match a name to an existing folder, ignoring case (Windows does too)."""
    for k in list_people_names():
        if k.lower() == name.lower():
            return k
    return None


def list_people_names():
    if not os.path.isdir(PEOPLE_DIR):
        return []
    return sorted(n for n in os.listdir(PEOPLE_DIR) if os.path.isdir(person_dir(n)))


def photo_files(name):
    folder = person_dir(name)
    if not os.path.isdir(folder):
        return []
    return [os.path.join(folder, f) for f in sorted(os.listdir(folder)) if f.lower().endswith(IMAGE_TYPES)]


def load_people():
    """name -> list of BGR images"""
    people = {}
    for name in list_people_names():
        imgs = [i for i in (read_image(p) for p in photo_files(name)) if i is not None]
        if imgs:
            people[name] = imgs
    return people


def people_summary():
    return [{"name": n, "photos": len(photo_files(n))} for n in list_people_names() if photo_files(n)]


def add_photos(name, blobs):
    """Save uploaded photos. Returns how many were readable."""
    import time
    folder = person_dir(name)
    os.makedirs(folder, exist_ok=True)
    added = 0
    for i, data in enumerate(blobs):
        img = decode_image(data)
        if img is None:
            continue
        write_image(os.path.join(folder, f"{int(time.time() * 1000)}_{i}.jpg"), img)
        added += 1
    if not added and not photo_files(name):
        shutil.rmtree(folder, ignore_errors=True)
    return added


def remove_person(name):
    shutil.rmtree(person_dir(name), ignore_errors=True)


def thumbnail(name, size=112):
    files = photo_files(name)
    if not files:
        return None
    img = read_image(files[0])
    if img is None:
        return None
    h, w = img.shape[:2]
    s = min(h, w)
    y0, x0 = int((h - s) * 0.15), (w - s) // 2
    crop = cv2.resize(img[y0:y0 + s, x0:x0 + s], (size, size))
    ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return buf.tobytes() if ok else None


# --------------------------------------------------------------- alert log
TIME_FMT = "%Y-%m-%d %H:%M:%S"


def log_alert(stamp, name, score, snapshot, source):
    init_dirs()
    with _lock:
        new = not os.path.exists(LOG_FILE) or os.path.getsize(LOG_FILE) == 0
        with open(LOG_FILE, "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if new:
                w.writerow(["time", "name", "score", "snapshot", "source"])
            w.writerow([stamp.strftime(TIME_FMT), name, f"{score:.2f}", snapshot, source])


def read_log():
    """All alerts, oldest first. 'id' is the row number."""
    rows = []
    if not os.path.exists(LOG_FILE):
        return rows
    try:
        with _lock, open(LOG_FILE, newline="", encoding="utf-8") as f:
            for i, r in enumerate(csv.DictReader(f)):
                try:
                    t = datetime.strptime(r["time"], TIME_FMT)
                except Exception:
                    continue
                snap = os.path.basename((r.get("snapshot") or "").replace("\\", "/"))
                rows.append({"id": i, "time": t, "name": r.get("name", ""),
                             "score": r.get("score", ""), "snapshot": snap,
                             "source": r.get("source", "")})
    except Exception:
        pass
    return rows


def clear_log():
    with _lock:
        try:
            os.remove(LOG_FILE)
        except OSError:
            pass


def build_visits(rows, gap_seconds):
    """Group alert rows into visits. A visit ends when the same person has no
    alert for gap_seconds. Duration is first alert to last alert, so it is
    approximate (up to one alert interval short)."""
    last, visits = {}, []
    for r in sorted(rows, key=lambda r: r["time"]):
        v = last.get(r["name"])
        if v and (r["time"] - v["end"]).total_seconds() <= gap_seconds:
            v["end"] = r["time"]
            v["alerts"] += 1
        else:
            v = {"name": r["name"], "start": r["time"], "end": r["time"], "alerts": 1, "face": ""}
            last[r["name"]] = v
            visits.append(v)
        snap = r["snapshot"]
        if snap and os.path.exists(os.path.join(MATCH_DIR, FACE_PREFIX + snap)):
            v["face"] = FACE_PREFIX + snap
    return visits


# ------------------------------------------- v12: "Not recognised" events
MAX_UNKNOWN = 500          # oldest events (and their pictures) are removed after this many


def _read_unknown_raw():
    try:
        with open(UNKNOWN_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _write_unknown_raw(items):
    init_dirs()
    tmp = UNKNOWN_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f)
    os.replace(tmp, UNKNOWN_FILE)


def _unknown_files(uid):
    return [os.path.join(UNKNOWN_DIR, uid + ".jpg"), os.path.join(UNKNOWN_DIR, uid + "_full.jpg")]


def _remove_unknown_files(uid):
    for p in _unknown_files(uid):
        try:
            os.remove(p)
        except OSError:
            pass


def read_unknown():
    """All 'Not recognised' events, newest first."""
    with _lock:
        items = _read_unknown_raw()
    return sorted(items, key=lambda x: x.get("time", ""), reverse=True)


def add_unknown(stamp, face_img, frame, score, source, save_full=True):
    """Save one 'Not recognised' event: a face close-up, optionally the full picture."""
    init_dirs()
    uid = "unk_" + stamp.strftime("%Y%m%d_%H%M%S_") + f"{stamp.microsecond // 1000:03d}"
    has_face = has_full = False
    if face_img is not None and face_img.size:
        has_face = bool(write_image(os.path.join(UNKNOWN_DIR, uid + ".jpg"), face_img, 88))
    if save_full and frame is not None:
        has_full = bool(write_image(os.path.join(UNKNOWN_DIR, uid + "_full.jpg"), frame, 75))
    item = {"id": uid, "time": stamp.strftime(TIME_FMT), "score": round(float(score), 2),
            "source": source, "status": "new", "face": has_face, "full": has_full, "person": ""}
    with _lock:
        items = _read_unknown_raw()
        items.append(item)
        items.sort(key=lambda x: x.get("time", ""))
        while len(items) > MAX_UNKNOWN:
            _remove_unknown_files(items.pop(0)["id"])
        _write_unknown_raw(items)
    return item


def set_unknown_status(uid, status, person=""):
    with _lock:
        items = _read_unknown_raw()
        for x in items:
            if x.get("id") == uid:
                x["status"] = status
                x["person"] = person
                _write_unknown_raw(items)
                return True
    return False


def get_unknown(uid):
    with _lock:
        for x in _read_unknown_raw():
            if x.get("id") == uid:
                return x
    return None


def delete_unknown(uid):
    with _lock:
        items = _read_unknown_raw()
        keep = [x for x in items if x.get("id") != uid]
        if len(keep) == len(items):
            return False
        _write_unknown_raw(keep)
    _remove_unknown_files(uid)
    return True


def unknown_path(uid, kind):
    """Path of the picture file, or None. Only ids that exist in the list are accepted."""
    if not get_unknown(uid):
        return None
    path = _unknown_files(uid)[1 if kind == "full" else 0]
    return path if os.path.exists(path) else None


def cleanup_unknown(days):
    """Delete 'Not recognised' events older than `days` days. 0 means keep everything."""
    if not days:
        return 0
    cutoff = (datetime.now() - timedelta(days=days)).strftime(TIME_FMT)
    with _lock:
        items = _read_unknown_raw()
        old = [x for x in items if x.get("time", "") < cutoff]
        if not old:
            return 0
        _write_unknown_raw([x for x in items if x.get("time", "") >= cutoff])
    for x in old:
        _remove_unknown_files(x["id"])
    return len(old)


# ------------------------------------------- v12 (2B): notification centre
MAX_NOTIF = 500            # oldest notifications are dropped after this many
KEEP_NOTIF_DAYS = 30       # and any older than this many days
NOTIF_CATEGORIES = ("people", "camera", "system")


def _read_notif_raw():
    try:
        with open(NOTIF_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _write_notif_raw(items):
    init_dirs()
    tmp = NOTIF_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f)
    os.replace(tmp, NOTIF_FILE)


def add_notification(category, kind, text, name=""):
    """Add one notification. Same text twice within 20 seconds is saved only once."""
    if category not in NOTIF_CATEGORIES:
        category = "system"
    now = datetime.now()
    with _lock:
        items = _read_notif_raw()
        if items:
            last = items[-1]
            try:
                age = (now - datetime.strptime(last["time"], TIME_FMT)).total_seconds()
            except Exception:
                age = 999
            if last.get("text") == text and age < 20:
                return None
        cutoff = (now - timedelta(days=KEEP_NOTIF_DAYS)).strftime(TIME_FMT)
        items = [x for x in items if x.get("time", "") >= cutoff]
        nid = max([x.get("id", 0) for x in items] + [0]) + 1
        item = {"id": nid, "time": now.strftime(TIME_FMT), "category": category,
                "kind": kind, "text": text, "name": name, "read": False}
        items.append(item)
        _write_notif_raw(items[-MAX_NOTIF:])
    return item


def read_notifications(category=None, limit=200):
    """Newest first. Returns (items, unread_in_all, total_in_all)."""
    with _lock:
        items = _read_notif_raw()
    unread = sum(1 for x in items if not x.get("read"))
    shown = [x for x in items if not category or x.get("category") == category]
    shown.sort(key=lambda x: x.get("id", 0), reverse=True)
    return shown[:max(1, min(limit, 500))], unread, len(items)


def mark_notifications_read(category=None):
    with _lock:
        items = _read_notif_raw()
        n = 0
        for x in items:
            if not x.get("read") and (not category or x.get("category") == category):
                x["read"] = True
                n += 1
        if n:
            _write_notif_raw(items)
    return n


def clear_notifications():
    with _lock:
        try:
            os.remove(NOTIF_FILE)
        except OSError:
            pass


# ------------------------------------------- v12 (2C): date range for Dashboard and Analytics
def resolve_range(days, date_from="", date_to=""):
    """Returns (start, stop, prev_start, span_days).
    A valid custom range (YYYY-MM-DD to YYYY-MM-DD) wins. Otherwise days = 1, 7 or 30 means
    'the last N days including today'. start None = all time. stop None = no end.
    prev_start is where the equal-length period before this one begins."""
    midnight = datetime.min.time()
    try:
        s = datetime.strptime(date_from, "%Y-%m-%d").date()
        e = datetime.strptime(date_to, "%Y-%m-%d").date()
        if s <= e:
            start = datetime.combine(s, midnight)
            span = (e - s).days + 1
            return start, datetime.combine(e + timedelta(days=1), midnight), start - timedelta(days=span), span
    except (ValueError, TypeError):
        pass
    if days in (1, 7, 30):
        start = datetime.combine(datetime.now().date(), midnight) - timedelta(days=days - 1)
        return start, None, start - timedelta(days=days), days
    return None, None, None, 0