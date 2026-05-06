"""
Tests for GET/POST/PUT/DELETE /api/users
Covers: list, create (role hierarchy), update, delete, by-client filter.
"""

import pytest

from app.extensions import db
from app.models.user import User, UserRole
from tests.conftest import auth_headers


# ---------------------------------------------------------------------------
# GET /api/users
# ---------------------------------------------------------------------------

def test_list_users_admin(app, client, admin_user):
    headers = auth_headers(app, admin_user)
    resp = client.get("/api/users", headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data, list) or "users" in data


def test_list_users_unauthenticated(client):
    resp = client.get("/api/users")
    assert resp.status_code == 401


def test_list_users_m_recruiter_sees_own_client(app, client, m_recruiter_user, sample_client):
    headers = auth_headers(app, m_recruiter_user)
    resp = client.get("/api/users", headers=headers)
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# GET /api/users/by-client/<client_id>
# ---------------------------------------------------------------------------

def test_users_by_client(app, client, admin_user, sample_client, recruiter_user):
    headers = auth_headers(app, admin_user)
    resp = client.get(f"/api/users/by-client/{sample_client.id}", headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()
    users = data if isinstance(data, list) else data.get("users", [])
    emails = [u["email"] for u in users]
    assert "recruiter@test.com" in emails


# ---------------------------------------------------------------------------
# POST /api/users  (create)
# ---------------------------------------------------------------------------

def test_create_user_admin_success(app, client, admin_user, sample_client):
    headers = auth_headers(app, admin_user)
    resp = client.post(
        "/api/users",
        json={
            "full_name": "New Recruiter",
            "email": "new.recruiter@test.com",
            "password": "Pass@12345",
            "role": "RECRUITER",
            "client_id": sample_client.id,
        },
        headers=headers,
    )
    assert resp.status_code == 201
    data = resp.get_json()
    user = data.get("user", data)
    assert user["email"] == "new.recruiter@test.com"


def test_create_user_duplicate_email(app, client, admin_user, recruiter_user, sample_client):
    headers = auth_headers(app, admin_user)
    resp = client.post(
        "/api/users",
        json={
            "full_name": "Dup",
            "email": "recruiter@test.com",  # already exists
            "password": "Pass@12345",
            "role": "RECRUITER",
            "client_id": sample_client.id,
        },
        headers=headers,
    )
    assert resp.status_code in (400, 409)


def test_create_user_unauthenticated(client, sample_client):
    resp = client.post(
        "/api/users",
        json={
            "full_name": "Ghost",
            "email": "ghost@test.com",
            "password": "Pass@12345",
            "role": "RECRUITER",
            "client_id": sample_client.id,
        },
    )
    assert resp.status_code == 401


def test_recruiter_cannot_create_user(app, client, recruiter_user, sample_client):
    """RECRUITER role must not be allowed to create any user."""
    headers = auth_headers(app, recruiter_user)
    resp = client.post(
        "/api/users",
        json={
            "full_name": "Another",
            "email": "another@test.com",
            "password": "Pass@12345",
            "role": "RECRUITER",
            "client_id": sample_client.id,
        },
        headers=headers,
    )
    assert resp.status_code == 403


def test_m_recruiter_cannot_create_admin(app, client, m_recruiter_user, sample_client):
    """M_RECRUITER should not be able to create an ADMIN user."""
    headers = auth_headers(app, m_recruiter_user)
    resp = client.post(
        "/api/users",
        json={
            "full_name": "Bad Admin",
            "email": "badmin@test.com",
            "password": "Pass@12345",
            "role": "ADMIN",
            "client_id": sample_client.id,
        },
        headers=headers,
    )
    assert resp.status_code == 403


def test_create_user_missing_required_fields(app, client, admin_user):
    headers = auth_headers(app, admin_user)
    resp = client.post("/api/users", json={"email": "partial@test.com"}, headers=headers)
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# PUT /api/users/<user_id>
# ---------------------------------------------------------------------------

def test_update_user_full_name(app, client, admin_user, recruiter_user):
    headers = auth_headers(app, admin_user)
    resp = client.put(
        f"/api/users/{recruiter_user.id}",
        json={"full_name": "Updated Name"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.get_json()
    user = data.get("user", data)
    assert user["full_name"] == "Updated Name"


def test_update_nonexistent_user(app, client, admin_user):
    headers = auth_headers(app, admin_user)
    resp = client.put("/api/users/99999", json={"full_name": "Ghost"}, headers=headers)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /api/users/<user_id>
# ---------------------------------------------------------------------------

def test_delete_user_admin(app, client, admin_user, sample_client):
    with app.app_context():
        target = User(full_name="To Delete", email="todelete@test.com", role=UserRole.RECRUITER.value, client_id=sample_client.id)
        target.set_password("Pass@1234")
        db.session.add(target)
        db.session.commit()
        target_id = target.id

    headers = auth_headers(app, admin_user)
    resp = client.delete(f"/api/users/{target_id}", headers=headers)
    assert resp.status_code in (200, 204)


def test_delete_nonexistent_user(app, client, admin_user):
    headers = auth_headers(app, admin_user)
    resp = client.delete("/api/users/99999", headers=headers)
    assert resp.status_code == 404
