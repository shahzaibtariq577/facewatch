@echo off
REM Starts the backend, which also serves the built web app on http://localhost:8000
cd /d "%~dp0backend"
call ..\.venv\Scripts\activate
start "" http://localhost:8000
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
