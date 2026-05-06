"""
Tests for POST /api/auth/login, POST /api/auth/logout,
POST /api/auth/refresh, GET /api/auth/me
"""

import pytest
from flask_jwt_extended import create_access_token, create_refresh_token

from app.extensions import db
from app.models.user import User, UserRole
from tests.conftest import auth_headers


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_user(app, email="user@test.com", password="Pass@1234", role=UserRole.RECRUITER.value, is_active=True):
    with app.app_context():
        user = User(full_name="Test User", email=email, role=role, is_active=is_active)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        db.session.refresh(user)
        return user


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

def test_health_endpoint(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ok"


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

def test_login_success(app, client):
    _create_user(app, email="login@test.com", password="Pass@1234")
    resp = client.post(
        "/api/auth/login",
        json={"email": "login@test.com", "password": "Pass@1234"},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert "user" in data
    assert data["user"]["email"] == "login@test.com"


def test_login_wrong_password(app, client):
    _create_user(app, email="login2@test.com", password="Pass@1234")
    resp = client.post(
        "/api/auth/login",
        json={"email": "login2@test.com", "password": "WrongPassword"},
    )
    assert resp.status_code == 401
    assert "error" in resp.get_json()


def test_login_nonexistent_email(client):
    resp = client.post(
        "/api/auth/login",
        json={"email": "nobody@test.com", "password": "Pass@1234"},
    )
    assert resp.status_code == 401


def test_login_missing_email_field(client):
    resp = client.post("/api/auth/login", json={"password": "Pass@1234"})
    assert resp.status_code == 400


def test_login_missing_password_field(client):
    resp = client.post("/api/auth/login", json={"email": "x@test.com"})
    assert resp.status_code == 400


def test_login_empty_body(client):
    resp = client.post("/api/auth/login", json={})
    assert resp.status_code == 400


def test_login_inactive_user(app, client):
    _create_user(app, email="inactive@test.com", password="Pass@1234", is_active=False)
    resp = client.post(
        "/api/auth/login",
        json={"email": "inactive@test.com", "password": "Pass@1234"},
    )
    assert resp.status_code == 401


def test_login_email_case_insensitive(app, client):
    _create_user(app, email="case@test.com", password="Pass@1234")
    resp = client.post(
        "/api/auth/login",
        json={"email": "CASE@TEST.COM", "password": "Pass@1234"},
    )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# /me
# ---------------------------------------------------------------------------

def test_me_returns_current_user(app, client, admin_user):
    headers = auth_headers(app, admin_user)
    resp = client.get("/api/auth/me", headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["email"] == "admin@test.com"
    assert data["role"] == "ADMIN"


def test_me_unauthenticated(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_me_invalid_token(client):
    resp = client.get("/api/auth/me", headers={"Authorization": "Bearer invalid.token.here"})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Logout
# ---------------------------------------------------------------------------

def test_logout_success(app, client, admin_user):
    headers = auth_headers(app, admin_user)
    resp = client.post("/api/auth/logout", headers=headers)
    assert resp.status_code == 200
    assert "Logged out" in resp.get_json().get("message", "")


def test_logout_token_revoked_on_me(app, client, admin_user):
    """After logout, the same token must be rejected on /me."""
    headers = auth_headers(app, admin_user)
    client.post("/api/auth/logout", headers=headers)
    resp = client.get("/api/auth/me", headers=headers)
    assert resp.status_code == 401


def test_logout_unauthenticated(client):
    resp = client.post("/api/auth/logout")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Refresh
# ---------------------------------------------------------------------------

def test_refresh_returns_new_access_token(app, client, admin_user):
    with app.app_context():
        refresh_token = create_refresh_token(
            identity=str(admin_user.id),
            additional_claims={"role": admin_user.role, "client_id": admin_user.client_id},
        )
    resp = client.post(
        "/api/auth/refresh",
        headers={"Authorization": f"Bearer {refresh_token}"},
    )
    assert resp.status_code == 200


def test_refresh_with_access_token_rejected(app, client, admin_user):
    """An access token must not be accepted on the refresh endpoint."""
    headers = auth_headers(app, admin_user)
    resp = client.post("/api/auth/refresh", headers=headers)
    assert resp.status_code == 422
