@echo off
REM One-time setup: Python packages + build the React app.
cd /d "%~dp0"
python -m venv .venv
call .venv\Scripts\activate
pip install -r backend\requirements.txt
cd frontend
call npm install
call npm run build
echo.
echo Setup finished. Double-click run.bat to start FaceWatch.
pause
