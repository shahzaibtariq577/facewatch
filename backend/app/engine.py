"""Face matching engine: YuNet finds faces, SFace compares them.

Only faces are compared, so clothing and background are ignored. Scores are
averaged over the last few frames so a single odd frame cannot raise an alert.

v6: visits, "not seen" notices, Telegram alerts, photo quality check.
v12: "Not recognised" events (a face that stays in view and matches nobody).
v12 (2B): notification centre (people, camera and system notices are saved to a file).
v21 (3E): several cameras at once (one worker per camera, "grid mode"). With grid mode off, one camera
is watched exactly as before.
"""
import os
import re
import threading
import time
from collections import deque
from datetime import datetime

import cv2
import numpy as np

from . import notify
from . import quiet
from . import storage as st

FRAME_WIDTH = 640     # frames are shrunk to this width for speed
MAX_FACES = 6         # max faces scored per frame
SMOOTH_FRAMES = 7     # scores are averaged over this many frames
MIN_FRAMES = 3        # a face needs this many scores before it can match
LOST_AFTER = 10       # forget a face after this many frames without it
UNKNOWN_AFTER = 15    # an unmatched face must stay in view this many frames before it is saved
UNKNOWN_MIN_FACE = 50 # ignore very small faces (pixels, on the 640 wide picture)
MULTI_MIN_GAP = 0.1   # grid mode: each camera is checked at most 10 times a second
TILE_W, TILE_H = 480, 360   # size of one camera tile in the grid picture


class StartError(Exception):
    pass


MODEL = "arcface"      # v22: "arcface" (stronger) or "sface" (the old model). Change this word to roll back.

# standard ArcFace 112x112 landmark positions: left eye, right eye, nose, left mouth, right mouth
_ARC_TEMPLATE = np.array([[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
                          [41.5493, 92.3655], [70.7299, 92.2041]], dtype=np.float32)


class ArcRecognizer:
    """ArcFace MobileFaceNet (w600k_mbf) through OpenCV. Needs the 5 landmarks that YuNet gives."""
    name = "arcface"

    def __init__(self, path):
        self.net = cv2.dnn.readNetFromONNX(path)

    def embed(self, img, face_row):
        pts = np.array(face_row[4:14], dtype=np.float32).reshape(5, 2)
        m, _ = cv2.estimateAffinePartial2D(pts, _ARC_TEMPLATE, method=cv2.LMEDS)
        crop = cv2.warpAffine(img, m, (112, 112), borderValue=0)
        blob = cv2.dnn.blobFromImage(crop, 1 / 127.5, (112, 112), (127.5, 127.5, 127.5), swapRB=True)
        self.net.setInput(blob)
        f = self.net.forward().flatten().astype(np.float32)
        return f / (np.linalg.norm(f) + 1e-9)


def make_recognizer():
    """Returns (recognizer, model name). Falls back to SFace if ArcFace is not available."""
    if MODEL == "arcface":
        try:
            p = st.model_path("arcface")
            if os.path.exists(p):
                return ArcRecognizer(p), "arcface"
        except Exception:
            pass
    return cv2.FaceRecognizerSF.create(st.model_path("sface"), ""), "sface"


def face_feature(recognizer, img, face_row):
    if hasattr(recognizer, "embed"):
        return recognizer.embed(img, face_row)
    aligned = recognizer.alignCrop(img, face_row)
    f = recognizer.feature(aligned).flatten()
    return f / (np.linalg.norm(f) + 1e-9)


GREEN = (94, 197, 34)     # BGR colours
AMBER = (27, 138, 201)


def draw_tag(frame, text, x, y, color, text_color=(0, 0, 0)):
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
    y0 = max(y - th - 14, 0)
    cv2.rectangle(frame, (x, y0), (x + tw + 14, y0 + th + 12), color, -1)
    cv2.putText(frame, text, (x + 7, y0 + th + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                text_color, 2, cv2.LINE_AA)


def draw_corners(frame, x, y, w, h, color, thick=3):
    """Face frame with bold corners and a faint full outline."""
    cv2.rectangle(frame, (x, y), (x + w, y + h), color, 1, cv2.LINE_AA)
    n = max(10, int(min(w, h) * 0.22))
    for px, py, dx, dy in ((x, y, 1, 1), (x + w, y, -1, 1), (x, y + h, 1, -1), (x + w, y + h, -1, -1)):
        cv2.line(frame, (px, py), (px + dx * n, py), color, thick, cv2.LINE_AA)
        cv2.line(frame, (px, py), (px, py + dy * n), color, thick, cv2.LINE_AA)


def check_photo(img):
    """Quality check for an uploaded reference photo.
    Returns (usable, notes). usable is False when no face is found.
    The blur / side-turn limits are simple rules of thumb, not exact."""
    ih, iw = img.shape[:2]
    det = cv2.FaceDetectorYN.create(st.model_path("yunet"), "", (iw, ih), 0.7, 0.3, 5000)
    _, faces = det.detect(img)
    if faces is None or len(faces) == 0:
        return False, "no face found"
    notes = []
    if len(faces) > 1:
        notes.append("more than one face (the biggest one is used)")
    f = max(faces, key=lambda r: r[2] * r[3])
    x, y, w, h = [int(v) for v in f[:4]]
    if min(w, h) < 80:
        notes.append("face is small (use a closer photo)")
    crop = img[max(y, 0):max(y + h, 0), max(x, 0):max(x + w, 0)]
    if crop.size:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        if cv2.Laplacian(gray, cv2.CV_64F).var() < 40:
            notes.append("looks blurry")
    eye_mid = (float(f[4]) + float(f[6])) / 2
    eye_dist = abs(float(f[6]) - float(f[4])) + 1e-6
    if abs(float(f[8]) - eye_mid) / eye_dist > 0.35:
        notes.append("face is turned to the side")
    return True, "; ".join(notes)


class Lane:
    """One camera that is being watched (a worker thread plus its own picture and numbers)."""

    def __init__(self, idx, source, label, name, location, stop):
        self.idx = idx
        self.source = source
        self.label = label            # the name written into alerts and the log
        self.name = name
        self.location = location
        self.stop = stop              # set when watching stops
        self.thread = None
        self.done = False
        self.state = "starting"       # starting|running|reconnecting|error|stopped
        self.note = ""
        self.fps = 0.0
        self.faces = 0
        self.best = 0.0
        self.matched = []
        self.res = ""
        self.cam_down = False
        self.last_proc = 0.0
        self.last_unknown_ts = 0.0
        self.version = -1             # which version of the saved people its references were built from
        self.frame = None
        self.frame_id = 0
        self.cond = threading.Condition()

    def publish(self, frame):
        with self.cond:
            self.frame = frame
            self.frame_id += 1
            self.cond.notify_all()


def _ascii(text):
    return str(text).encode("ascii", "replace").decode()


class Engine:
    def __init__(self, cfg: dict):
        self.cfg = cfg                     # shared with the API; changes apply live
        self.people = {}                   # name -> BGR images
        self.people_count = 0
        self.people_version = 0            # goes up when the saved people change
        self.models_ready = False
        self.models_error = ""

        self.stop_event = threading.Event()
        self.lanes = []                    # the cameras of this run (one when grid mode is off)
        self.multi = False                 # True when several cameras are watched at once
        self.running = False
        self.state = "loading"             # loading|stopped|error (while running, the state comes from the cameras)
        self.note = ""
        self.source = 0
        self.source_label = ""
        self.paused = False                # watching is on, but nobody is checked

        self.notif_seq = 0                 # goes up each time a notification is saved
        self.unknown_seq = 0               # goes up each time a "Not recognised" event is saved
        self.alert_seq = 0
        self.last_alert = None
        self.last_alert_ts = 0.0

        # v6: notices (visit start, not seen, back in view), kept in memory
        self.events = deque(maxlen=50)
        self.event_seq = 0
        self.last_seen = {}                # name -> time last matched (by any camera)
        self.missing = set()               # names currently flagged "not seen"
        self.started_at = time.time()
        self._alert_at = {}                # name -> time of the last alert (by any camera)
        self._lock = threading.RLock()     # protects what all cameras share

    # ----------------------------------------------------------- setup
    def load_models(self):
        try:
            st.ensure_models()
            self.models_ready = True
            self.state = "stopped"
        except Exception as e:
            self.state = "error"
            self.models_error = f"Model download failed: {e}. Check the internet and restart."
            self.note = self.models_error
            self._note("system", "error", self.models_error)

    def reload_people(self):
        self.people = st.load_people()
        self.people_count = len(self.people)
        self.people_version += 1

    # --------------------------------------------------------- control
    def resolve_source(self):
        c = self.cfg
        mode = c["source_mode"]
        if mode == "video":
            path = c.get("video_path", "")
            if not path or not os.path.exists(path):
                raise StartError("Video file not found. Set the path in Settings.")
            return path, os.path.basename(path)
        if mode == "network":
            url = c.get("url", "")
            if not url:
                raise StartError("Type the network camera address in Settings first.")
            return url, re.sub(r"//[^@/]*@", "//", url)      # never show passwords
        return int(c["cam_index"]), f"Camera {int(c['cam_index'])}"

    @staticmethod
    def _source_of(c):
        """Source of a saved camera (3D). Raises StartError with a friendly message."""
        if c["kind"] == "video":
            if not c.get("path") or not os.path.exists(c["path"]):
                raise StartError(f"{c['name']}: video file not found.")
            return c["path"]
        if c["kind"] == "network":
            if not c.get("url"):
                raise StartError(f"{c['name']}: type the network camera address on the Cameras page.")
            return c["url"]
        return int(c.get("index", 0))

    def _plan(self):
        """(multi, [camera specs]) for the next run."""
        cams = None
        try:
            from . import cams
        except Exception:
            pass
        if cams is not None:
            try:
                grid = cams.multi_on()
            except Exception:
                grid = False
            if grid:
                watch = cams.watch_list(self.cfg)
                if not watch:
                    raise StartError("Grid mode is on, but no camera has Watch ticked. Tick Watch on the Cameras page, "
                                     "or turn off \"Watch several cameras at once\".")
                specs, seen = [], set()
                for c in watch:
                    src = self._source_of(c)
                    if repr(src) in seen:
                        raise StartError(f"{c['name']} uses the same source as another watched camera. "
                                         "Each camera needs its own webcam number or address.")
                    seen.add(repr(src))
                    specs.append({"source": src, "label": c["name"], "name": c["name"], "location": c.get("location", "")})
                return True, specs
        source, label = self.resolve_source()
        try:                       # 3F: alerts and reports name the saved camera
            label = cams.active_name(self.cfg) or label
        except Exception:
            pass
        return False, [{"source": source, "label": label, "name": label, "location": ""}]

    def start(self):
        if self.running:
            return
        if not self.people:
            raise StartError("Add at least one person with a clear photo first.")
        if not self.models_ready:
            raise StartError("The face models are still loading.")
        multi, specs = self._plan()
        self.multi = multi
        self.source = specs[0]["source"]
        self.source_label = ", ".join(s["name"] for s in specs) if multi else specs[0]["label"]
        self.stop_event = threading.Event()          # a new one, so an old worker can never wake up again
        self.paused = False
        self.running = True
        self.state = "starting"
        self.note = ""
        self.last_seen, self.missing, self._alert_at = {}, set(), {}
        self.started_at = time.time()
        self.lanes = [Lane(i, s["source"], s["label"], s["name"], s["location"], self.stop_event)
                      for i, s in enumerate(specs)]
        for lane in self.lanes:
            t = threading.Thread(target=self._worker, args=(lane,), daemon=True)
            t.start()
            lane.thread = t
        self._note("system", "start", f"Watching started ({self.source_label}).")

    def stop(self):
        was_running = self.running
        self.stop_event.set()
        for lane in list(self.lanes):
            t = lane.thread
            if t and t.is_alive():
                t.join(timeout=3)
        self.running = False
        self.paused = False
        if self.state != "error":
            self.state = "stopped"
        for lane in list(self.lanes):
            lane.matched, lane.faces, lane.fps, lane.res = [], 0, 0.0, ""
            with lane.cond:
                lane.frame = None
                lane.cond.notify_all()
        if was_running:
            self._note("system", "stop", "Watching stopped.")

    def pause(self):
        """Keep the camera connected but stop checking faces and sending alerts."""
        if self.running and not self.paused:
            self.paused = True
            for lane in self.lanes:
                lane.matched, lane.faces, lane.best = [], 0, 0.0
            self._note("system", "pause", "Monitoring paused. No faces are checked.")

    def resume(self):
        if self.paused:
            with self._lock:
                self.last_seen, self.missing = {}, set()     # the "not seen" timers start again
                self.started_at = time.time()
            self.paused = False
            self._note("system", "resume", "Monitoring resumed.")

    def status(self):
        lanes = list(self.lanes)
        if self.running and lanes and not any(l.thread is None or l.thread.is_alive() for l in lanes):
            self.running = False
            if self.state != "error":
                self.state = "stopped"
        now = time.time()
        run = self.running and bool(lanes)
        state, note = self.state, self.note
        if run:
            states = [l.state for l in lanes]
            state = next((s for s in ("running", "reconnecting", "starting", "error") if s in states), self.state)
            notes = [(f"{l.name}: {l.note}" if self.multi else l.note) for l in lanes if l.note]
            note = notes[0] if notes else ""
        live = [l for l in lanes if l.state == "running"] if run else []
        return {
            "running": self.running, "paused": self.paused,
            "resolution": lanes[0].res if run and not self.multi else "",
            "state": state, "note": note,
            "models_ready": self.models_ready, "people": self.people_count,
            "fps": round(sum(l.fps for l in live) / len(live), 1) if live else 0.0,
            "faces": sum(l.faces for l in lanes) if run else 0,
            "best": round(max((l.best for l in lanes), default=0.0), 2) if run else 0.0,
            "matched": sorted({m for l in lanes for m in l.matched}) if run else [],
            "source": self.source_label,
            "multi": bool(self.multi and run),
            "lanes": [{"id": l.idx, "name": l.name, "location": l.location, "state": l.state, "note": l.note,
                       "fps": round(l.fps, 1), "faces": l.faces, "matched": list(l.matched), "resolution": l.res}
                      for l in lanes] if run else [],
            "alert_seq": self.alert_seq, "last_alert": self.last_alert,
            "alert_age": round(now - self.last_alert_ts, 1) if self.last_alert else None,
            "missing": sorted(self.missing),
            "events": list(self.events)[-8:][::-1],      # newest first
            "event_seq": self.event_seq,
            "unknown_seq": self.unknown_seq,
            "notif_seq": self.notif_seq,
            "notify_error": notify.last_error,
        }

    # ---------------------------------------------------------- stream
    @staticmethod
    def _chunk(jpeg):
        return b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + \
               str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n"

    def frames(self, lane=-1):
        """MJPEG chunks for as long as the engine runs. In grid mode: one picture with all cameras,
        or one camera when lane is given. With one camera: that camera."""
        lanes = list(self.lanes)
        if not lanes:
            return iter(())
        if self.multi and not 0 <= lane < len(lanes):
            return self._mosaic_frames()
        return self._lane_frames(lanes[lane] if 0 <= lane < len(lanes) else lanes[0])

    def _lane_frames(self, lane):
        last = -1
        while self.running:
            with lane.cond:
                lane.cond.wait_for(lambda: lane.frame_id != last or not self.running, timeout=2)
                frame, last = lane.frame, lane.frame_id
            if frame is None:
                continue
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if ok:
                yield self._chunk(buf.tobytes())

    def _mosaic_frames(self):
        last_ids, last_t = None, 0.0
        while self.running:
            lanes = list(self.lanes)
            ids = tuple(l.frame_id for l in lanes)
            if ids != last_ids or time.time() - last_t > 1.0:
                last_ids, last_t = ids, time.time()
                ok, buf = cv2.imencode(".jpg", self._mosaic(lanes), [cv2.IMWRITE_JPEG_QUALITY, 75])
                if ok:
                    yield self._chunk(buf.tobytes())
            time.sleep(0.07)

    def _mosaic(self, lanes):
        """All cameras in one picture: 1 camera = big, 2 = side by side, 3 or 4 = 2x2."""
        n = max(1, len(lanes))
        cols = 1 if n == 1 else 2
        rows = (n + cols - 1) // cols
        tw, th = (640, 480) if n == 1 else (TILE_W, TILE_H)
        canvas = np.full((rows * th, cols * tw, 3), 16, dtype=np.uint8)
        for i, lane in enumerate(lanes):
            x0, y0 = (i % cols) * tw, (i // cols) * th
            frame = lane.frame if lane.state in ("running", "starting") else None
            if frame is not None:
                fh, fw = frame.shape[:2]
                s = min(tw / fw, th / fh)
                small = cv2.resize(frame, (max(1, int(fw * s)), max(1, int(fh * s))))
                sh, sw = small.shape[:2]
                canvas[y0 + (th - sh) // 2:y0 + (th - sh) // 2 + sh, x0 + (tw - sw) // 2:x0 + (tw - sw) // 2 + sw] = small
            else:
                msg = {"reconnecting": "Reconnecting...", "error": "Camera problem"}.get(lane.state, "No picture")
                cv2.putText(canvas, msg, (x0 + 20, y0 + th // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2, cv2.LINE_AA)
            cv2.rectangle(canvas, (x0, y0), (x0 + tw, y0 + 26), (0, 0, 0), -1)
            title = _ascii(lane.name + (f" - {lane.location}" if lane.location else ""))
            cv2.putText(canvas, title, (x0 + 8, y0 + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
            if lane.state == "running":
                cv2.putText(canvas, f"{lane.fps:.0f} FPS", (x0 + tw - 70, y0 + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                            (190, 190, 190), 1, cv2.LINE_AA)
            cv2.rectangle(canvas, (x0, y0), (x0 + tw - 1, y0 + th - 1), (60, 60, 60), 1)
        return canvas

    # ---------------------------------------------------------- notices
    def _event(self, kind, name, text):
        self.events.append({"time": datetime.now().strftime(st.TIME_FMT),
                            "kind": kind, "name": name, "text": text})
        self.event_seq += 1
        self._note("people", kind, text, name)

    def _note(self, category, kind, text, name=""):
        """Save a notification for the Notifications page. Never stops the camera loop."""
        try:
            if st.add_notification(category, kind, text, name):
                self.notif_seq += 1
        except Exception:
            pass

    def _cam_lost(self, lane):
        if not lane.cam_down:
            lane.cam_down = True
            self._note("camera", "lost", f"Camera disconnected ({lane.label}). Trying to reconnect.")

    def _cam_back(self, lane):
        if lane.cam_down:
            lane.cam_down = False
            self._note("camera", "back", f"Camera reconnected ({lane.label}).")

    def _send(self, name, text, photo=None, tags=None):
        """Phone message, unless 'Ignore' is on for everyone or for this person."""
        if quiet.phone_muted(name):
            return
        notify.send_async(self.cfg, text, photo, tags)

    def _new_visit(self, lane, name, score, crop):
        """A person appeared after being away longer than the visit gap."""
        if quiet.person_muted(name):
            return                       # ignored person: the visit is still logged by the alert
        self._event("visit", name, f"{name} arrived (score {score:.2f}).")
        if not self.cfg.get("notify_on_match"):
            return
        photo = None
        if self.cfg.get("notify_send_photo") and crop is not None and crop.size:
            ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 88])
            photo = buf.tobytes() if ok else None
        stamp = datetime.now().strftime("%H:%M:%S")
        self._send(name, f"FaceWatch: {name} seen at {stamp} "
                         f"({lane.label}). Score {score:.2f}.", photo)

    def _went_missing(self, name, minutes):
        self.missing.add(name)
        if quiet.person_muted(name):
            return
        self._event("missing", name, f"{name} has not been seen for {minutes} minutes.")
        if self.cfg.get("notify_on_missing"):
            self._send(name, f"FaceWatch: {name} has not been seen for {minutes} minutes.", tags=["warning"])

    # ---------------------------------------------------------- unknown
    def _unknown(self, lane, score, frame, face):
        """Save a 'Not recognised' event. This is only a note that a face did not match
        anyone saved. It does not say who the person is or that anything is wrong."""
        try:
            st.add_unknown(datetime.now(), face, frame, score, lane.label,
                           save_full=bool(self.cfg.get("save_full_frame", True)))
            self.unknown_seq += 1
            self._event("unknown", "", "A face was not recognised. Review it on the Not recognised page.")
            if self.cfg.get("notify_on_unknown", True):
                photo = None
                if self.cfg.get("notify_send_photo") and face is not None and face.size:
                    ok, buf = cv2.imencode(".jpg", face, [cv2.IMWRITE_JPEG_QUALITY, 88])
                    photo = buf.tobytes() if ok else None
                stamp = datetime.now().strftime("%H:%M:%S")
                self._send("", f"FaceWatch: a face was not recognised at {stamp} "
                               f"({lane.label}). It does not match anyone saved.",
                           photo, tags=["grey_question"])
        except Exception as e:
            lane.note = f"Could not save a Not recognised event: {e}"

    # ---------------------------------------------------------- alerts
    def _alert(self, lane, name, score, frame, face=None, pics=True):
        stamp = datetime.now()
        snap = ""
        try:
            if self.cfg["snapshots"] and pics:
                os.makedirs(st.MATCH_DIR, exist_ok=True)
                snap = f"{name}_{stamp:%Y%m%d_%H%M%S}.jpg"
                if self.cfg.get("save_full_frame", True):
                    st.write_image(os.path.join(st.MATCH_DIR, snap), frame, 75)
                if face is not None and face.size:
                    st.write_image(os.path.join(st.MATCH_DIR, st.FACE_PREFIX + snap), face, 88)
            st.log_alert(stamp, name, score, snap, lane.label)
            if lane.state != "error":
                lane.note = ""
        except PermissionError:
            lane.note = "Could not write match_log.csv (is it open in Excel?)"
        except Exception as e:
            lane.note = f"Could not save alert: {e}"
        self.last_alert = {"name": name, "score": round(score, 2), "time": stamp.strftime(st.TIME_FMT)}
        self.last_alert_ts = time.time()
        self.alert_seq += 1

    # ---------------------------------------------------------- worker
    def _build_refs(self, detector, recognizer):
        refs, problems = {}, []
        for name, imgs in list(self.people.items()):
            embs = []
            for img in imgs:
                ih, iw = img.shape[:2]
                detector.setInputSize((iw, ih))
                _, faces = detector.detect(img)
                if faces is None or len(faces) == 0:
                    continue
                best = max(faces, key=lambda f: f[2] * f[3])
                embs.append(face_feature(recognizer, img, best))
            if embs:
                refs[name] = embs
            else:
                problems.append(name)
        return refs, problems

    def _worker(self, lane):
        try:
            self._run(lane)
        except Exception as e:                 # a camera must never die silently
            lane.state, lane.note = "error", f"This camera stopped: {e}"
            self._note("camera", "error", f"{lane.label}: {lane.note}")
        finally:
            self._lane_done(lane)

    def _lane_done(self, lane):
        with self._lock:
            lane.matched, lane.faces, lane.fps = [], 0, 0.0
            if lane.state != "error":
                lane.state = "stopped"
            lane.done = True
            if all(l.done for l in self.lanes):          # the last camera finished: the whole run is over
                self.running = False
                bad = next((l for l in self.lanes if l.state == "error"), None)
                if bad:
                    self.state, self.note = "error", bad.note
                elif self.state != "error":
                    self.state = "stopped"

    def _run(self, lane):
        try:
            detector = cv2.FaceDetectorYN.create(st.model_path("yunet"), "", (320, 320), 0.7, 0.3, 5000)
            recognizer, model_name = make_recognizer()
            self.model_name = model_name
        except Exception as e:
            lane.state, lane.note = "error", f"Could not start the face models: {e}"
            return

        stop = lane.stop
        live = isinstance(lane.source, int) or str(lane.source).lower().startswith(("http", "rtsp", "rtmp"))
        refs, base_note = {}, ""
        tracks, next_id, frame_no = {}, 0, 0
        prev, fps = time.time(), 0.0

        while not stop.is_set():
            cap = cv2.VideoCapture(lane.source)
            if not cap.isOpened():
                cap.release()
                if live and self.cfg["auto_reconnect"]:
                    self._cam_lost(lane)
                    lane.state, lane.note = "reconnecting", "Camera not available. Retrying..."
                    stop.wait(2.0)
                    continue
                lane.state, lane.note = "error", "Could not open the camera or video. Check Settings or the Cameras page."
                self._note("camera", "error", f"Could not open the camera or video ({lane.label}).")
                break
            try:
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)     # less delay on network cameras
            except Exception:
                pass
            lane.state, lane.note = "running", base_note
            self._cam_back(lane)
            try:
                lane.res = f"{int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))}"
            except Exception:
                lane.res = ""
            if len(self.lanes) == 1:
                self.started_at = time.time()    # "not seen" countdown restarts after a reconnect (one camera only)

            while not stop.is_set():
                ok, frame = cap.read()
                if not ok:
                    break
                if self.multi:                   # grid mode: skip frames so several cameras do not overload the computer
                    if time.time() - lane.last_proc < MULTI_MIN_GAP:
                        continue
                    lane.last_proc = time.time()
                frame = cv2.resize(frame, (FRAME_WIDTH, int(frame.shape[0] * FRAME_WIDTH / frame.shape[1])))
                h, w = frame.shape[:2]

                if self.paused:
                    # no checking, no alerts, and the live picture is not shown
                    shot = np.full((h, w, 3), 24, dtype=np.uint8)
                    cv2.putText(shot, "Monitoring paused", (max(w // 2 - 130, 10), h // 2),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (220, 220, 220), 2, cv2.LINE_AA)
                    tracks.clear()
                    lane.matched, lane.faces, lane.best = [], 0, 0.0
                    prev = time.time()
                    lane.publish(shot)
                    continue

                if lane.version != self.people_version:
                    lane.version = self.people_version
                    tracks.clear()
                    refs, problems = self._build_refs(detector, recognizer)
                    base_note = ("No face found in photos of: " + ", ".join(problems)) if problems else ""
                    lane.note = base_note
                    with self._lock:
                        self.missing &= set(refs)            # forget removed people

                detector.setInputSize((w, h))
                _, faces = detector.detect(frame)
                matched, crops, best, used, n_faces = {}, {}, 0.0, set(), 0
                unknown_new = []
                frame_no += 1

                if faces is not None:
                    faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)[:MAX_FACES]
                    n_faces = len(faces)
                    for face in faces:
                        x, y, fw, fh = [int(v) for v in face[:4]]
                        cx, cy = x + fw / 2, y + fh / 2

                        # link this face to the nearest face from earlier frames
                        tid, dist_best = None, max(fw, fh)
                        for t_id, t in tracks.items():
                            if t_id in used:
                                continue
                            d = ((t["cx"] - cx) ** 2 + (t["cy"] - cy) ** 2) ** 0.5
                            if d < dist_best:
                                tid, dist_best = t_id, d
                        if tid is None:
                            tid = next_id
                            next_id += 1
                            tracks[tid] = {"scores": {}, "age": 0, "known": False, "unk": False}
                        used.add(tid)
                        t = tracks[tid]
                        t["cx"], t["cy"], t["seen"] = cx, cy, frame_no
                        t["age"] += 1

                        if refs:
                            try:
                                emb = face_feature(recognizer, frame, face)
                                for pname, embs in refs.items():
                                    dq = t["scores"].setdefault(pname, deque(maxlen=SMOOTH_FRAMES))
                                    dq.append(max(float(emb @ r) for r in embs))
                            except Exception:
                                pass

                        best_name, best_avg, best_n, second = None, None, 0, None
                        for pname, dq in t["scores"].items():
                            if not dq or pname not in refs:
                                continue
                            m = sum(dq) / len(dq)
                            if best_avg is None or m > best_avg:
                                if best_avg is not None:
                                    second = best_avg
                                best_name, best_avg, best_n = pname, m, len(dq)
                            elif second is None or m > second:
                                second = m

                        # margin rule: the best person must beat the second best (lookalike protection)
                        arc = model_name == "arcface"          # settings are read live
                        threshold = self.cfg.get("threshold_arc", 0.45) if arc else self.cfg["threshold"]
                        margin = self.cfg.get("margin", 0.05) if arc else 0.0
                        clear = second is None or best_avg is None or (best_avg - second) >= margin
                        is_match = (best_avg is not None and best_n >= MIN_FRAMES
                                    and best_avg >= threshold and clear)
                        if best_avg is not None:
                            best = max(best, best_avg)
                        if is_match:
                            t["known"] = True
                            if best_avg >= matched.get(best_name, 0.0):
                                # clean close-up of the face (taken before the boxes are drawn)
                                mx, my = int(fw * 0.4), int(fh * 0.4)
                                crops[best_name] = frame[max(y - my, 0):min(y + fh + my, h),
                                                         max(x - mx, 0):min(x + fw + mx, w)].copy()
                            matched[best_name] = max(matched.get(best_name, 0.0), best_avg)
                            draw_corners(frame, x, y, fw, fh, GREEN)
                            draw_tag(frame, f"{best_name}  {best_avg:.2f}", x, y, GREEN)
                        else:
                            # a face that stays in view and matches nobody: remember it (clean close-up,
                            # taken before the boxes are drawn)
                            if (self.cfg.get("unknown_events", True) and not t["known"] and not t["unk"]
                                    and t["age"] >= UNKNOWN_AFTER and best_n >= MIN_FRAMES
                                    and min(fw, fh) >= UNKNOWN_MIN_FACE):
                                mx, my = int(fw * 0.4), int(fh * 0.4)
                                unknown_new.append((t, best_avg, frame[max(y - my, 0):min(y + fh + my, h),
                                                                       max(x - mx, 0):min(x + fw + mx, w)].copy()))
                            draw_corners(frame, x, y, fw, fh, AMBER, 2)
                            tag = f"No match  {best_avg:.2f}" if best_avg is not None else "Checking..."
                            draw_tag(frame, tag, x, y, AMBER, (255, 255, 255))

                for t_id in [k for k, t in tracks.items() if frame_no - t["seen"] > LOST_AFTER]:
                    del tracks[t_id]

                now_t = time.time()

                # "Not recognised" events (one per face, and not more often than unknown_gap seconds, per camera)
                if unknown_new and now_t - lane.last_unknown_ts >= self.cfg.get("unknown_gap", 60):
                    lane.last_unknown_ts = now_t
                    for ut, uscore, ucrop in unknown_new:
                        ut["unk"] = True
                        self._unknown(lane, uscore, frame, ucrop)

                # visits, "not seen" and alerts are shared by all cameras: one person is one visit
                with self._lock:
                    visit_gap = max(self.cfg.get("visit_gap", 120), 2 * self.cfg["alert_interval"])
                    for pname, score in matched.items():
                        prev_seen = self.last_seen.get(pname)
                        self.last_seen[pname] = now_t
                        if pname in self.missing:
                            self.missing.discard(pname)
                            if not quiet.person_muted(pname):
                                self._event("back", pname, f"{pname} is back in view.")
                        if prev_seen is None or now_t - prev_seen > visit_gap:
                            self._new_visit(lane, pname, score, crops.get(pname))

                    # not-seen notice
                    minutes = self.cfg.get("not_seen_minutes", 0)
                    if minutes:
                        for pname in refs:
                            since = max(self.last_seen.get(pname, 0.0), self.started_at)
                            if pname not in self.missing and now_t - since >= minutes * 60:
                                self._went_missing(pname, minutes)

                    # regular alerts: again every N seconds while the person stays in view
                    for pname, score in matched.items():
                        since = now_t - self._alert_at.get(pname, 0)
                        if since >= self.cfg["alert_interval"]:
                            self._alert_at[pname] = now_t
                            # pictures_once: only the first alert of a visit gets a picture
                            pics = (not self.cfg.get("pictures_once", False)) or since > visit_gap
                            self._alert(lane, pname, score, frame, crops.get(pname), pics)

                now = time.time()
                fps = 0.9 * fps + 0.1 * (1 / max(now - prev, 1e-3))
                prev = now
                lane.fps, lane.faces, lane.best, lane.matched = fps, n_faces, best, sorted(matched)
                lane.publish(frame)

            cap.release()
            if stop.is_set():
                break
            if live and self.cfg["auto_reconnect"]:
                self._cam_lost(lane)
                lane.state, lane.note = "reconnecting", "Connection lost. Reconnecting..."
                stop.wait(2.0)
                continue
            lane.note = "Connection lost." if live else "Video finished."
            self._note("camera" if live else "system", "lost" if live else "end", f"{lane.label}: {lane.note}")
            break