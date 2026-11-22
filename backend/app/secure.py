"""Starts FaceWatch with the password login switched on. Run: uvicorn app.secure:app"""
from .main import app
from .auth import AuthMiddleware

app.add_middleware(AuthMiddleware)