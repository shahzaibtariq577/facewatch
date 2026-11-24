"""FaceWatch Phase 4A: compare SFace (now) with ArcFace MobileFaceNet (w600k_mbf).
Does NOT change the app. Only reads your saved people photos.
Run from C:\\Users\\SHAZAIB\\facewatch\\backend  (venv active):  python model_test.py
"""
import os
import time
import urllib.request
import zipfile
from itertools import combinations

import cv2
import numpy as np

from app import storage as st

ZIP_URL = "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip"
ARC_NAME = "w600k_mbf.onnx"
ARC_PATH = os.path.join(st.MODEL_DIR, ARC_NAME)

# standard ArcFace 112x112 landmark positions: left eye, right eye, nose, left mouth, right mouth
TEMPLATE = np.array([[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
                     [41.5493, 92.3655], [70.7299, 92.2041]], dtype=np.float32)


def get_arcface():
    if os.path.exists(ARC_PATH) and os.path.getsize(ARC_PATH) > 10_000_000:
        return
    os.makedirs(st.MODEL_DIR, exist_ok=True)
    zpath = os.path.join(st.MODEL_DIR, "buffalo_s.zip")
    print("Downloading buffalo_s.zip (about 120 MB, one time)...")
    req = urllib.request.Request(ZIP_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(zpath, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    with zipfile.ZipFile(zpath) as z:
        with z.open(ARC_NAME) as src, open(ARC_PATH, "wb") as dst:
            dst.write(src.read())
    os.remove(zpath)
    print("Saved", ARC_PATH)


def norm(v):
    v = v.flatten().astype(np.float32)
    return v / (np.linalg.norm(v) + 1e-9)


def main():
    get_arcface()
    detector = cv2.FaceDetectorYN.create(st.model_path("yunet"), "", (320, 320), 0.7, 0.3, 5000)
    sface = cv2.FaceRecognizerSF.create(st.model_path("sface"), "")
    arc = cv2.dnn.readNetFromONNX(ARC_PATH)

    def emb_sface(img, face):
        return norm(sface.feature(sface.alignCrop(img, face)))

    def emb_arc(img, face):
        pts = np.array(face[4:14], dtype=np.float32).reshape(5, 2)
        M, _ = cv2.estimateAffinePartial2D(pts, TEMPLATE, method=cv2.LMEDS)
        crop = cv2.warpAffine(img, M, (112, 112), borderValue=0)
        blob = cv2.dnn.blobFromImage(crop, 1 / 127.5, (112, 112), (127.5, 127.5, 127.5), swapRB=True)
        arc.setInput(blob)
        return norm(arc.forward())

    people = st.load_people()
    items = []   # (name, sface_emb, arc_emb)
    t_s, t_a = [], []
    for name, imgs in people.items():
        for img in imgs:
            ih, iw = img.shape[:2]
            detector.setInputSize((iw, ih))
            _, faces = detector.detect(img)
            if faces is None or len(faces) == 0:
                continue
            face = max(faces, key=lambda f: f[2] * f[3])
            t = time.time(); a = emb_sface(img, face); t_s.append(time.time() - t)
            t = time.time(); b = emb_arc(img, face); t_a.append(time.time() - t)
            items.append((name, a, b))
    names = sorted({i[0] for i in items})
    print(f"\nPeople with a usable photo: {len(names)}   usable photos: {len(items)}")
    if len(names) < 2:
        print("Need at least 2 people with photos to compare.")
        return

    for label, k in (("SFace (current)", 1), ("ArcFace MobileFaceNet", 2)):
        same, diff, worst = [], [], (-1, "", "")
        for x, y in combinations(items, 2):
            s = float(x[k] @ y[k])
            if x[0] == y[0]:
                same.append(s)
            else:
                diff.append(s)
                if s > worst[0]:
                    worst = (s, x[0], y[0])
        print(f"\n=== {label} ===")
        if same:
            print(f"Same person:      lowest {min(same):.2f}   average {np.mean(same):.2f}   ({len(same)} pairs)")
        print(f"Different people: highest {max(diff):.2f}   average {np.mean(diff):.2f}   ({len(diff)} pairs)")
        print(f"Closest lookalike pair: {worst[1]} vs {worst[2]} = {worst[0]:.2f}")
        if same:
            gap = min(same) - max(diff)
            print(f"GAP (lowest same - highest different): {gap:+.2f}   <- bigger is better")

    print(f"\nSpeed per face: SFace {np.mean(t_s)*1000:.0f} ms   ArcFace {np.mean(t_a)*1000:.0f} ms")


if __name__ == "__main__":
    main()