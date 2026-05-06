"""
Tests for GET/POST/PUT/DELETE /api/clients
"""

import pytest

from app.extensions import db
from app.models.client import Client
from tests.conftest import auth_headers


# ---------------------------------------------------------------------------
# POST /api/clients
# ---------------------------------------------------------------------------

def test_create_client_admin(app, client, admin_user):
    headers = auth_headers(app, admin_user)
    resp = client.post(
        "/api/clients",
        json={"name": "New Corp", "industry": "Finance", "contact_email": "info@newcorp.com"},
        headers=headers,
    )
    assert resp.status_code == 201
    data = resp.get_json()
    assert data["name"] == "New Corp"


def test_create_client_non_admin_forbidden(app, client, m_recruiter_user):
    headers = auth_headers(app, m_recruiter_user)
    resp = client.post(
        "/api/clients",
        json={"name": "Sneaky Corp", "industry": "Tech", "contact_email": "x@x.com"},
        headers=headers,
    )
    assert resp.status_code == 403


def test_create_client_unauthenticated(client):
    resp = client.post(
        "/api/clients",
        json={"name": "Anon Corp", "industry": "Tech", "contact_email": "a@b.com"},
    )
    assert resp.status_code == 401


def test_create_client_missing_name(app, client, admin_user):
    headers = auth_headers(app, admin_user)
    resp = client.post(
        "/api/clients",
        json={"industry": "Tech"},
        headers=headers,
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/clients
# ---------------------------------------------------------------------------

def test_list_clients_admin(app, client, admin_user, sample_client):
    headers = auth_headers(app, admin_user)
    resp = client.get("/api/clients", headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()
    clients = data if isinstance(data, list) else data.get("clients", [])
    assert any(c["name"] == "Acme Corp" for c in clients)


def test_list_clients_unauthenticated(client):
    resp = client.get("/api/clients")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/clients/<client_id>
# ---------------------------------------------------------------------------

def test_get_client_by_id(app, client, admin_user, sample_client):
    headers = auth_headers(app, admin_user)
    resp = client.get(f"/api/clients/{sample_client.id}", headers=headers)
    assert resp.status_code == 200
    assert resp.get_json()["name"] == "Acme Corp"


def test_get_client_not_found(app, client, admin_user):
    headers = auth_headers(app, admin_user)
    resp = client.get("/api/clients/99999", headers=headers)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PUT /api/clients/<client_id>
# ---------------------------------------------------------------------------

def test_update_client_admin(app, client, admin_user, sample_client):
    headers = auth_headers(app, admin_user)
    resp = client.put(
        f"/api/clients/{sample_client.id}",
        json={"name": "Acme Corp Updated"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.get_json()["name"] == "Acme Corp Updated"


# ---------------------------------------------------------------------------
# DELETE /api/clients/<client_id>
# ---------------------------------------------------------------------------

def test_delete_client_no_jds(app, client, admin_user):
    with app.app_context():
        empty_client = Client(name="Empty Corp", industry="Retail", contact_email="e@corp.com")
        db.session.add(empty_client)
        db.session.commit()
        empty_id = empty_client.id

    headers = auth_headers(app, admin_user)
    resp = client.delete(f"/api/clients/{empty_id}", headers=headers)
    assert resp.status_code in (200, 204)


def test_delete_client_with_jds_blocked(app, client, admin_user, sample_client, sample_jd):
    """Deleting a client that has JDs must be blocked."""
    headers = auth_headers(app, admin_user)
    resp = client.delete(f"/api/clients/{sample_client.id}", headers=headers)
    assert resp.status_code in (400, 409)


def test_delete_client_non_admin_forbidden(app, client, m_recruiter_user, sample_client):
    headers = auth_headers(app, m_recruiter_user)
    resp = client.delete(f"/api/clients/{sample_client.id}", headers=headers)
    assert resp.status_code == 403
