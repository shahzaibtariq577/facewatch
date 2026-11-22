# FaceWatch

Real-time face watcher with a web dashboard. It watches a camera and raises alerts when it sees
people you saved, using **faces only** (clothing and background are ignored).

- **Backend:** Python, FastAPI, OpenCV (YuNet face detection + SFace recognition)
- **Frontend:** React + Vite (Live, Dashboard, People, Settings)
- **Alerts:** banner, beep, snapshot, CSV log, repeated at an interval you choose
- **Auto:** starts by itself, remembers settings, reconnects when the camera drops

> **Privacy:** only use this on people who agree to it, and only with cameras you own.
> Snapshots contain faces. Never commit the `backend/data/` folder.

## Project layout

```
facewatch/
  backend/
    app/
      main.py      REST API + MJPEG video stream
      engine.py    camera loop, face matching, alerts
      storage.py   settings, people photos, alert log, model download
    requirements.txt
  frontend/
    src/           React app (App, api.js, pages/*)
    vite.config.js
  setup.bat        Windows one-time setup
  run.bat          Windows start
```

## Quick start (Windows)

Needs Python 3.10+ and Node.js 18+.

1. Double-click `setup.bat` (once).
2. Double-click `run.bat`. The browser opens at http://localhost:8000.
3. Open **People**, add a name and 2 or 3 clear front-facing photos.
4. Go to **Live** and press **Start watching**.

The first run downloads two face models (about 40 MB) into `backend/data/models`.

## Development (two terminals)

```bash
# terminal 1 - backend on :8000
cd backend
python -m venv ../.venv && ../.venv/Scripts/activate   # Linux/Mac: source ../.venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# terminal 2 - frontend on :5173 (proxies /api to :8000)
cd frontend
npm install
npm run dev
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/status` | state, FPS, faces, matches, alert counter |
| POST | `/api/start`, `/api/stop` | start or stop watching |
| GET | `/api/stream` | live video (MJPEG) |
| GET / PUT | `/api/settings` | read or change settings |
| GET | `/api/cameras` | scan webcams |
| GET / POST | `/api/people` | list people / add a person with photos |
| POST | `/api/people/{name}/photos` | add photos |
| DELETE | `/api/people/{name}` | remove a person |
| GET | `/api/people/{name}/thumb` | face thumbnail |
| GET / DELETE | `/api/alerts` | recent alerts / clear history |
| GET | `/api/dashboard` | totals, hourly chart, per-person stats, history |

Interactive docs: http://localhost:8000/docs

## Tuning

- A lookalike (for example a brother) gets flagged: raise **Match strictness**, try 0.55, and add more photos.
- The real person is missed: lower it, or add clearer front-facing photos.
- Reliable range is about 3 to 4 meters from a webcam. Sunglasses, masks and side views lower the score.

## Roadmap

1. Visits (first seen, last seen, time present) and body tracking joined to face identity
2. Phone alerts (Telegram, WhatsApp or email)
3. Several cameras
4. Windows .exe and start with Windows
5. Number plate search

## License

MIT
