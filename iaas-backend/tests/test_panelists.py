"""
Tests for the /api/panelists blueprint.

Covers: list, create, bulk create, excel upload, update, delete, access control.
Uses the shared conftest fixtures (session-scoped SQLite app, auth_headers helper).
"""

import io
import re

import openpyxl
import pytest

from tests.conftest import auth_headers


BASE = "/api/panelists"


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_xlsx(rows: list[dict]) -> bytes:
    """Build an in-memory .xlsx with the expected column layout."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Name", "Skill", "Email ID", "Number", "Location"])
    for row in rows:
        ws.append([
            row.get("name", ""),
            row.get("skill", ""),
            row.get("email", ""),
            row.get("phone", ""),
            row.get("location", ""),
        ])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _admin_headers(app, admin_user):
    return auth_headers(app, admin_user)


def _recruiter_headers(app, recruiter_user):
    return auth_headers(app, recruiter_user)


# ── 1. List returns empty when no panelists exist ──────────────────────────────

def test_list_empty(client, app, admin_user):
    res = client.get(BASE, headers=_admin_headers(app, admin_user))
    assert res.status_code == 200
    data = res.get_json()
    assert "panelists" in data
    assert data["panelists"] == []


# ── 2. Create single panelist ──────────────────────────────────────────────────

def test_create_single(client, app, admin_user):
    res = client.post(
        BASE,
        json={"name": "Alice Smith", "email": "alice@example.com", "skill": "Python", "phone": "9999999999", "location": "Bangalore"},
        headers=_admin_headers(app, admin_user),
    )
    assert res.status_code == 201
    p = res.get_json()["panelist"]
    assert p["name"] == "Alice Smith"
    assert p["email"] == "alice@example.com"
    assert re.match(r"^PAN-\d{4}$", p["panel_id"]), f"panel_id format wrong: {p['panel_id']}"


# ── 3. Duplicate email returns 409 ─────────────────────────────────────────────

def test_duplicate_email(client, app, admin_user):
    headers = _admin_headers(app, admin_user)
    client.post(BASE, json={"name": "Alice", "email": "dup@example.com"}, headers=headers)
    res = client.post(BASE, json={"name": "Alice 2", "email": "dup@example.com"}, headers=headers)
    assert res.status_code == 409
    assert "email" in res.get_json().get("errors", {})


# ── 4. Created panelist appears in list ────────────────────────────────────────

def test_list_returns_created_panelist(client, app, admin_user):
    headers = _admin_headers(app, admin_user)
    client.post(BASE, json={"name": "Bob Jones", "email": "bob@example.com"}, headers=headers)
    res = client.get(BASE, headers=headers)
    assert res.status_code == 200
    emails = [p["email"] for p in res.get_json()["panelists"]]
    assert "bob@example.com" in emails


# ── 5. Update panelist ─────────────────────────────────────────────────────────

def test_update_panelist(client, app, admin_user):
    headers = _admin_headers(app, admin_user)
    create_res = client.post(BASE, json={"name": "Carol", "email": "carol@example.com"}, headers=headers)
    panelist_id = create_res.get_json()["panelist"]["id"]

    res = client.put(f"{BASE}/{panelist_id}", json={"name": "Carol Updated"}, headers=headers)
    assert res.status_code == 200
    assert res.get_json()["panelist"]["name"] == "Carol Updated"


# ── 6. Delete panelist ─────────────────────────────────────────────────────────

def test_delete_panelist(client, app, admin_user):
    headers = _admin_headers(app, admin_user)
    create_res = client.post(BASE, json={"name": "Dave", "email": "dave@example.com"}, headers=headers)
    panelist_id = create_res.get_json()["panelist"]["id"]

    del_res = client.delete(f"{BASE}/{panelist_id}", headers=headers)
    assert del_res.status_code == 200

    list_res = client.get(BASE, headers=headers)
    ids = [p["id"] for p in list_res.get_json()["panelists"]]
    assert panelist_id not in ids


# ── 7. Bulk create — all succeed ───────────────────────────────────────────────

def test_bulk_create(client, app, admin_user):
    headers = _admin_headers(app, admin_user)
    payload = {
        "panelists": [
            {"name": "Eve",   "email": "eve@example.com",   "skill": "Java"},
            {"name": "Frank", "email": "frank@example.com", "skill": "Go"},
            {"name": "Grace", "email": "grace@example.com", "skill": "Rust"},
        ]
    }
    res = client.post(f"{BASE}/bulk", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] == 3
    assert data["total"] == 3


# ── 8. Bulk create — missing email produces row-level error ────────────────────

def test_bulk_missing_email(client, app, admin_user):
    headers = _admin_headers(app, admin_user)
    payload = {"panelists": [{"name": "No Email"}]}
    res = client.post(f"{BASE}/bulk", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] == 0
    assert data["results"][0]["status"] == "error"


# ── 9. Excel upload creates panelists ─────────────────────────────────────────

def test_excel_upload(client, app, admin_user):
    headers = _admin_headers(app, admin_user)
    xlsx_bytes = _make_xlsx([
        {"name": "Henry", "email": "henry@example.com", "skill": "SQL", "phone": "1234567890", "location": "Delhi"},
        {"name": "Iris",  "email": "iris@example.com",  "skill": "ML"},
    ])
    data = {"file": (io.BytesIO(xlsx_bytes), "panelists.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    res = client.post(
        f"{BASE}/excel-upload",
        data=data,
        content_type="multipart/form-data",
        headers=headers,
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["success"] == 2


# ── 10. Non-admin role is forbidden ───────────────────────────────────────────

def test_non_admin_blocked(client, app, recruiter_user):
    res = client.get(BASE, headers=_recruiter_headers(app, recruiter_user))
    assert res.status_code == 403
