import os
from datetime import timedelta

from dotenv import load_dotenv


load_dotenv()


class Config:
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "sqlite:///iaas.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    _jwt_secret = os.getenv("JWT_SECRET_KEY", "")
    if not _jwt_secret or _jwt_secret == "dev-secret-change-me":
        raise RuntimeError(
            "JWT_SECRET_KEY must be set to a strong random secret. "
            "Set it in .env before starting the application."
        )
    JWT_SECRET_KEY = _jwt_secret
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    ENV = os.getenv("FLASK_ENV", "development")

    # CORS configuration (comma-separated origins)
    _cors_raw = os.getenv("CORS_ORIGINS", "")
    if not _cors_raw and os.getenv("FLASK_ENV", "development") == "production":
        raise RuntimeError(
            "CORS_ORIGINS must be set in production. "
            "Set it in .env as a comma-separated list of allowed origins."
        )
    CORS_ORIGINS = [o.strip() for o in _cors_raw.split(",") if o.strip()] or ["http://localhost:5173"]

    MAX_CONTENT_LENGTH = 100 * 1024 * 1024  # 100 MB — for large Excel panelist uploads

    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=15)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=7)

    JWT_TOKEN_LOCATION = ["cookies"]
    JWT_COOKIE_SECURE = os.getenv("JWT_COOKIE_SECURE", "True").lower() in ["true", "1", "yes"]
    if os.getenv("FLASK_ENV", "development") == "production" and not JWT_COOKIE_SECURE:
        raise RuntimeError(
            "JWT_COOKIE_SECURE must be True in production. "
            "Set JWT_COOKIE_SECURE=True in .env."
        )
    JWT_COOKIE_SAMESITE = "Strict"
    JWT_COOKIE_CSRF_PROTECT = True
    JWT_ACCESS_CSRF_HEADER_NAME = "X-CSRF-TOKEN"
    JWT_REFRESH_CSRF_HEADER_NAME = "X-CSRF-TOKEN"
