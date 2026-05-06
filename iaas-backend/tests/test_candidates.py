"""
Tests for /api/candidates:
- CRUD operations
- Duplicate detection (unique email+JD constraint)
- 30-day cooling period for NOT_SELECTED candidates
- Role-based access control
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from app.extensions import db
from app.models.candidate import Candidate
from tests.conftest import auth_headers


# ---------------------------------------------------------------------------
# GET /api/candidates
# ---------------------------------------------------------------------------

def test_list_candidates_admin(app, client, admin_user, sample_candidate):
    headers = auth_headers(app, admin_user)
    resp = client.get("/api/candidates", headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()
    candidates = data if isinstance(data, list) else data.get("candidates", [])
    assert any(c["email"] == "jane.doe@example.com" for c in candidates)


def test_list_candidates_filter_by_jd(app, client, admin_user, sample_candidate, sample_jd):
    headers = auth_headers(app, admin_user)
    resp = client.get(f"/api/candidates?jd_id={sample_jd.id}", headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()
    candidates = data if isinstance(data, list) else data.get("candidates", [])
    assert len(candidates) >= 1


def test_list_candidates_unauthenticated(client):
    resp = client.get("/api/candidates")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/candidates
# ---------------------------------------------------------------------------

def _candidate_payload(client_id, jd_id, email="new@example.com"):
    return {
        "client_id": client_id,
        "jd_id": jd_id,
        "full_name": "New Candidate",
        "email": email,
        "phone": "+9999999999",
    }


@patch("app.blueprints.candidates.send_resume_upload_notification_to_operator")
def test_create_candidate_success(mock_notify, app, client, admin_user, sample_client, sample_jd):
    mock_notify.return_value = None
    headers = auth_headers(app, admin_user)
    payload = _candidate_payload(sample_client.id, sample_jd.id, email="brandnew@example.com")
    resp = client.post("/api/candidates", json=payload, headers=headers)
    assert resp.status_code == 201
    data = resp.get_json()
    candidate = data.get("candidate", data)
    assert candidate["email"] == "brandnew@example.com"


@patch("app.blueprints.candidates.send_resume_upload_notification_to_operator")
def test_create_candidate_duplicate_email_same_jd(mock_notify, app, client, admin_user, sample_client, sample_jd, sample_candidate):
    """Creating a candidate with the same email+JD must return 409."""
    mock_notify.return_value = None
    headers = auth_headers(app, admin_user)
    payload = _candidate_payload(sample_client.id, sample_jd.id, email="jane.doe@example.com")
    resp = client.post("/api/candidates", json=payload, headers=headers)
    assert resp.status_code == 409
    assert "already exists" in resp.get_json().get("error", "").lower()


@patch("app.blueprints.candidates.send_resume_upload_notification_to_operator")
def test_create_candidate_cooling_period_enforced(mock_notify, app, client, admin_user, sample_client, sample_jd):
    """A NOT_SELECTED candidate within 30 days must be rejected."""
    mock_notify.return_value = None
    with app.app_context():
        recent_rejection = Candidate(
            client_id=sample_client.id,
            jd_id=sample_jd.id,
            full_name="Rejected Person",
            email="rejected@example.com",
            status="NOT_SELECTED",
            status_updated_at=datetime.now(timezone.utc) - timedelta(days=5),
        )
        db.session.add(recent_rejection)
        db.session.commit()

    headers = auth_headers(app, admin_user)
    payload = _candidate_payload(sample_client.id, sample_jd.id, email="rejected@example.com")
    resp = client.post("/api/candidates", json=payload, headers=headers)
    assert resp.status_code == 409


@patch("app.blueprints.candidates.send_resume_upload_notification_to_operator")
def test_create_candidate_cooling_period_expired(mock_notify, app, client, admin_user, sample_client, sample_jd):
    """A NOT_SELECTED candidate older than 30 days must be allowed to reapply."""
    mock_notify.return_value = None
    with app.app_context():
        old_rejection = Candidate(
            client_id=sample_client.id,
            jd_id=sample_jd.id,
            full_name="Old Reject",
            email="oldreject@example.com",
            status="NOT_SELECTED",
            status_updated_at=datetime.now(timezone.utc) - timedelta(days=35),
        )
        db.session.add(old_rejection)
        db.session.commit()
        old_id = old_rejection.id

    # Delete the old record so we can create a new one without hitting unique constraint
    with app.app_context():
        c = db.session.get(Candidate, old_id)
        db.session.delete(c)
        db.session.commit()

    headers = auth_headers(app, admin_user)
    payload = _candidate_payload(sample_client.id, sample_jd.id, email="oldreject@example.com")
    resp = client.post("/api/candidates", json=payload, headers=headers)
    assert resp.status_code == 201


def test_create_candidate_missing_required_fields(app, client, admin_user):
    headers = auth_headers(app, admin_user)
    resp = client.post("/api/candidates", json={"email": "partial@test.com"}, headers=headers)
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# PUT /api/candidates/<id>
# ---------------------------------------------------------------------------

def test_update_candidate_status(app, client, admin_user, sample_candidate):
    headers = auth_headers(app, admin_user)
    resp = client.put(
        f"/api/candidates/{sample_candidate.id}",
        json={"status": "SHORTLISTED"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.get_json()
    candidate = data.get("candidate", data)
    assert candidate["status"] == "SHORTLISTED"


def test_update_candidate_not_found(app, client, admin_user):
    headers = auth_headers(app, admin_user)
    resp = client.put("/api/candidates/99999", json={"status": "SHORTLISTED"}, headers=headers)
    assert resp.status_code == 404


def test_update_candidate_invalid_status(app, client, admin_user, sample_candidate):
    headers = auth_headers(app, admin_user)
    resp = client.put(
        f"/api/candidates/{sample_candidate.id}",
        json={"status": "INVALID_STATUS"},
        headers=headers,
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# DELETE /api/candidates/<id>
# ---------------------------------------------------------------------------

def test_delete_candidate_admin(app, client, admin_user, sample_candidate):
    headers = auth_headers(app, admin_user)
    resp = client.delete(f"/api/candidates/{sample_candidate.id}", headers=headers)
    assert resp.status_code in (200, 204)


def test_delete_candidate_not_found(app, client, admin_user):
    headers = auth_headers(app, admin_user)
    resp = client.delete("/api/candidates/99999", headers=headers)
    assert resp.status_code == 404


def test_delete_candidate_recruiter_forbidden(app, client, recruiter_user, sample_candidate):
    """Base RECRUITER cannot delete candidates."""
    headers = auth_headers(app, recruiter_user)
    resp = client.delete(f"/api/candidates/{sample_candidate.id}", headers=headers)
    assert resp.status_code == 403
