"""Phone notifications: ntfy (easiest) and Telegram. Standard library only."""
import base64
import json
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid

last_error = ""          # shown on the Live page if sending fails


def _clean(v):
    return (v or "").strip()


def ntfy_ready(cfg):
    return bool(_clean(cfg.get("ntfy_topic")))


def telegram_ready(cfg):
    return bool(_clean(cfg.get("telegram_token")) and _clean(cfg.get("telegram_chat")))


def configured(cfg):
    return ntfy_ready(cfg) or telegram_ready(cfg)


# -------------------------------------------------------------------- ntfy
def _open(req, who):
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{who} refused the message (HTTP {e.code}).") from None
    except Exception:
        raise RuntimeError(f"Could not reach {who}. Check the internet connection.") from None


def _hdr(text):
    """RFC 2047 encoding, so names with non-English letters survive in headers."""
    return "=?UTF-8?B?" + base64.b64encode(text.encode("utf-8")).decode("ascii") + "?="


def send_ntfy(cfg, text, photo=None, tags=None):
    base = (_clean(cfg.get("ntfy_server")) or "https://ntfy.sh").rstrip("/")
    topic = _clean(cfg.get("ntfy_topic"))
    tags = tags or ["bust_in_silhouette"]
    if photo:
        try:
            req = urllib.request.Request(
                f"{base}/{topic}", data=photo, method="PUT",
                headers={"Filename": "face.jpg", "Title": "FaceWatch", "Message": _hdr(text),
                         "Priority": "4", "Tags": ",".join(tags), "Content-Type": "image/jpeg"})
            _open(req, "ntfy")
            return
        except RuntimeError:
            pass                      # photo failed: fall back to a text-only message
    payload = json.dumps({"topic": topic, "title": "FaceWatch", "message": text,
                          "priority": 4, "tags": tags}).encode("utf-8")
    _open(urllib.request.Request(base, data=payload, headers={"Content-Type": "application/json"}), "ntfy")


# ---------------------------------------------------------------- Telegram
def _tg_call(token, method, data, headers=None):
    url = f"https://api.telegram.org/bot{token}/{method}"
    req = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            desc = json.loads(e.read().decode("utf-8")).get("description", "")
        except Exception:
            desc = ""
        raise RuntimeError(f"Telegram refused the message: {desc or e.code}") from None
    except Exception:
        raise RuntimeError("Could not reach Telegram. Check the internet connection.") from None
    if not body.get("ok"):
        raise RuntimeError("Telegram refused the message.")


def send_telegram(cfg, text, photo=None):
    token, chat = _clean(cfg.get("telegram_token")), _clean(cfg.get("telegram_chat"))
    if photo:
        b = uuid.uuid4().hex
        parts = []
        for k, v in (("chat_id", chat), ("caption", text[:1000])):
            parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode("utf-8"))
        parts.append((f'--{b}\r\nContent-Disposition: form-data; name="photo"; filename="face.jpg"\r\n'
                      f'Content-Type: image/jpeg\r\n\r\n').encode() + photo + b"\r\n")
        parts.append(f"--{b}--\r\n".encode())
        _tg_call(token, "sendPhoto", b"".join(parts),
                 {"Content-Type": f"multipart/form-data; boundary={b}"})
    else:
        data = urllib.parse.urlencode({"chat_id": chat, "text": text}).encode("utf-8")
        _tg_call(token, "sendMessage", data)


# ------------------------------------------------------------------ public
def send_now(cfg, text, photo=None, tags=None):
    """Send to every channel that is filled in. Raises RuntimeError on failure."""
    if not configured(cfg):
        raise RuntimeError("Type an ntfy topic (or a Telegram token and chat ID) in Settings first.")
    errors = []
    if ntfy_ready(cfg):
        try:
            send_ntfy(cfg, text, photo, tags)
        except RuntimeError as e:
            errors.append(str(e))
    if telegram_ready(cfg):
        try:
            send_telegram(cfg, text, photo)
        except RuntimeError as e:
            errors.append(str(e))
    if errors:
        raise RuntimeError(" ".join(errors))


def send_async(cfg, text, photo=None, tags=None):
    """Send in the background so the camera loop never waits for the internet.
    Does nothing if no channel is set up."""
    if not configured(cfg):
        return
    keys = ("ntfy_topic", "ntfy_server", "telegram_token", "telegram_chat")
    snap = {k: cfg.get(k, "") for k in keys}

    def run():
        global last_error
        try:
            send_now(snap, text, photo, tags)
            last_error = ""
        except Exception as e:
            last_error = str(e)

    threading.Thread(target=run, daemon=True).start()