"""
Tests for /api/qc:
- Dashboard listing
- Interview review
- Validation (approve/override)
"""

import pytest

from app.extensions import db
from app.models.interview_schedule import InterviewSchedule
from tests.conftest import auth_headers


# ---------------------------------------------------------------------------
# GET /api/qc/dashboard
# ---------------------------------------------------------------------------

def test_qc_dashboard_as_qc_user(app, client, qc_user, sample_interview):
    headers = auth_headers(app, qc_user)
    resp = client.get("/api/qc/dashboard", headers=headers)
    assert resp.status_code == 200


def test_qc_dashboard_as_admin(app, client, admin_user, sample_interview):
    headers = auth_headers(app, admin_user)
    resp = client.get("/api/qc/dashboard", headers=headers)
    assert resp.status_code == 200


def test_qc_dashboard_panelist_forbidden(app, client, panelist_user):
    headers = auth_headers(app, panelist_user)
    resp = client.get("/api/qc/dashboard", headers=headers)
    assert resp.status_code == 403


def test_qc_dashboard_unauthenticated(client):
    resp = client.get("/api/qc/dashboard")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/qc/interviews/<id>/review
# ---------------------------------------------------------------------------

def test_qc_review_returns_interview_data(app, client, qc_user, sample_reviewable_interview):
    headers = auth_headers(app, qc_user)
    resp = client.get(f"/api/qc/interviews/{sample_reviewable_interview.id}/review", headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()
    assert data is not None


def test_qc_review_not_found(app, client, qc_user):
    headers = auth_headers(app, qc_user)
    resp = client.get("/api/qc/interviews/99999/review", headers=headers)
    assert resp.status_code == 404


def test_qc_review_recruiter_forbidden(app, client, recruiter_user, sample_reviewable_interview):
    headers = auth_headers(app, recruiter_user)
    resp = client.get(f"/api/qc/interviews/{sample_reviewable_interview.id}/review", headers=headers)
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# POST /api/qc/interviews/<id>/validate
# ---------------------------------------------------------------------------

def test_qc_validate_interview(app, client, qc_user, sample_reviewable_interview):
    headers = auth_headers(app, qc_user)
    resp = client.put(
        f"/api/qc/interviews/{sample_reviewable_interview.id}/review",
        json={
            "final_recommendation": "HIRE",
            "qc_notes": "Strong candidate.",
            "approved": True,
        },
        headers=headers,
    )
    assert resp.status_code in (200, 201)


def test_qc_validate_with_overrides(app, client, qc_user, sample_reviewable_interview):
    headers = auth_headers(app, qc_user)
    resp = client.put(
        f"/api/qc/interviews/{sample_reviewable_interview.id}/review",
        json={
            "final_recommendation": "MAYBE",
            "qc_notes": "Needs improvement in communication.",
            "approved": False,
            "skill_overrides": [],
        },
        headers=headers,
    )
    assert resp.status_code in (200, 201)


def test_qc_validate_invalid_recommendation(app, client, qc_user, sample_reviewable_interview):
    headers = auth_headers(app, qc_user)
    resp = client.put(
        f"/api/qc/interviews/{sample_reviewable_interview.id}/review",
        json={
            "final_recommendation": "EXCELLENT",  # invalid
            "approved": True,
        },
        headers=headers,
    )
    assert resp.status_code == 400


def test_qc_validate_non_qc_user_forbidden(app, client, recruiter_user, sample_reviewable_interview):
    headers = auth_headers(app, recruiter_user)
    resp = client.put(
        f"/api/qc/interviews/{sample_reviewable_interview.id}/review",
        json={"final_recommendation": "HIRE", "approved": True},
        headers=headers,
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET /api/qc/reports
# ---------------------------------------------------------------------------

def test_qc_reports_as_qc(app, client, qc_user):
    headers = auth_headers(app, qc_user)
    resp = client.get("/api/qc/interviews", headers=headers)
    assert resp.status_code == 200
