"""Starts FaceWatch with the password login switched on. Run: uvicorn app.secure:app"""
from .main import app
from .auth import AuthMiddleware
from .audit import AuditMiddleware

app.add_middleware(AuthMiddleware)
app.add_middleware(AuditMiddleware)     # added last, so it is outermost and also sees the logins