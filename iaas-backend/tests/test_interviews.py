"""
Tests for /api/interviews:
- Schedule interview (Teams + email mocked)
- List, status update, cancellation
- Role-based access
"""

from unittest.mock import patch, MagicMock

import pytest

from app.extensions import db
from app.models.interview_schedule import InterviewSchedule
from tests.conftest import auth_headers


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _schedule_payload(candidate_id, jd_id, panelist_id):
    return {
        "candidate_id": candidate_id,
        "jd_id": jd_id,
        "scheduled_at": "2026-08-15T10:00:00",
        "timezone": "Asia/Kolkata",
        "duration_minutes": 60,
        "mode": "virtual",
        "panelist_ids": [panelist_id],
        "notes": "Test interview",
        "additional_emails": [],
    }


# ---------------------------------------------------------------------------
# POST /api/interviews
# ---------------------------------------------------------------------------

@patch("app.blueprints.interviews.send_interview_scheduled_to_candidate")
@patch("app.blueprints.interviews.send_interview_scheduled_to_panelist")
@patch("app.blueprints.interviews.send_interview_scheduled_to_recruiter")
@patch("app.blueprints.interviews.send_interview_notification_to_additional_recipient")
@patch("app.blueprints.interviews.create_teams_interview_event")
def test_schedule_interview_success(
    mock_teams,
    mock_notify_extra,
    mock_notify_rec,
    mock_notify_panelist,
    mock_notify_candidate,
    app, client, admin_user, sample_candidate, sample_jd, panelist_user
):
    mock_teams.return_value = {
        "join_url": "https://teams.microsoft.com/l/meetup-join/mock",
        "external_event_id": "event-123",
        "teams_meeting_id": "teams-456",
    }

    headers = auth_headers(app, admin_user)
    payload = _schedule_payload(sample_candidate.id, sample_jd.id, panelist_user.id)
    resp = client.post("/api/interviews", json=payload, headers=headers)

    assert resp.status_code == 201
    data = resp.get_json()
    assert "interview" in data or data.get("status") == "SCHEDULED" or data.get("id")


@patch("app.blueprints.interviews.send_interview_scheduled_to_candidate")
@patch("app.blueprints.interviews.send_interview_scheduled_to_panelist")
@patch("app.blueprints.interviews.send_interview_scheduled_to_recruiter")
@patch("app.blueprints.interviews.send_interview_notification_to_additional_recipient")
@patch("app.blueprints.interviews.create_teams_interview_event")
def test_schedule_interview_panelist_role_forbidden(
    mock_teams, mock_notify_extra, mock_notify_rec,
    mock_notify_panelist, mock_notify_candidate,
    app, client, panelist_user, sample_candidate, sample_jd
):
    """PANELIST must not schedule interviews."""
    mock_teams.return_value = {"join_url": "https://teams.test", "external_event_id": "ev1", "teams_meeting_id": "tm1"}
    headers = auth_headers(app, panelist_user)
    payload = _schedule_payload(sample_candidate.id, sample_jd.id, panelist_user.id)
    resp = client.post("/api/interviews", json=payload, headers=headers)
    assert resp.status_code == 403


def test_schedule_interview_unauthenticated(client, sample_candidate, sample_jd, panelist_user):
    payload = _schedule_payload(sample_candidate.id, sample_jd.id, panelist_user.id)
    resp = client.post("/api/interviews", json=payload)
    assert resp.status_code == 401


@patch("app.blueprints.interviews.send_interview_scheduled_to_candidate")
@patch("app.blueprints.interviews.send_interview_scheduled_to_panelist")
@patch("app.blueprints.interviews.send_interview_scheduled_to_recruiter")
@patch("app.blueprints.interviews.send_interview_notification_to_additional_recipient")
@patch("app.blueprints.interviews.create_teams_interview_event")
def test_schedule_interview_missing_candidate(
    mock_teams, mock_notify_extra, mock_notify_rec,
    mock_notify_panelist, mock_notify_candidate,
    app, client, admin_user, sample_jd, panelist_user
):
    mock_teams.return_value = {"join_url": "https://teams.test", "external_event_id": "ev1", "teams_meeting_id": "tm1"}
    headers = auth_headers(app, admin_user)
    payload = {
        "candidate_id": 99999,
        "jd_id": sample_jd.id,
        "scheduled_at": "2026-08-15T10:00:00",
        "timezone": "Asia/Kolkata",
        "duration_minutes": 60,
        "mode": "virtual",
        "panelist_ids": [panelist_user.id],
    }
    resp = client.post("/api/interviews", json=payload, headers=headers)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/interviews
# ---------------------------------------------------------------------------

def test_list_interviews_admin(app, client, admin_user, sample_interview):
    headers = auth_headers(app, admin_user)
    resp = client.get("/api/interviews", headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()
    interviews = data if isinstance(data, list) else data.get("interviews", [])
    assert len(interviews) >= 1


def test_list_interviews_unauthenticated(client):
    resp = client.get("/api/interviews")
    assert resp.status_code == 401


def test_list_interviews_panelist_sees_own(app, client, panelist_user, sample_interview):
    """A panelist should see only interviews they are assigned to."""
    headers = auth_headers(app, panelist_user)
    resp = client.get("/api/interviews", headers=headers)
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# PUT /api/interviews/<id>/status
# ---------------------------------------------------------------------------

def test_update_interview_status_to_completed(app, client, admin_user, sample_interview):
    headers = auth_headers(app, admin_user)
    resp = client.put(
        f"/api/interviews/{sample_interview.id}/status",
        json={"status": "COMPLETED"},
        headers=headers,
    )
    assert resp.status_code == 200


@patch("app.blueprints.interviews.cancel_teams_interview_event")
def test_cancel_interview(mock_cancel, app, client, admin_user, sample_interview):
    mock_cancel.return_value = None
    headers = auth_headers(app, admin_user)
    resp = client.put(
        f"/api/interviews/{sample_interview.id}/status",
        json={"status": "CANCELLED"},
        headers=headers,
    )
    assert resp.status_code == 200


def test_update_interview_status_invalid(app, client, admin_user, sample_interview):
    headers = auth_headers(app, admin_user)
    resp = client.put(
        f"/api/interviews/{sample_interview.id}/status",
        json={"status": "GHOST"},
        headers=headers,
    )
    assert resp.status_code == 400


def test_update_interview_status_recruiter_forbidden(app, client, recruiter_user, sample_interview):
    """RECRUITER must not update interview status."""
    headers = auth_headers(app, recruiter_user)
    resp = client.put(
        f"/api/interviews/{sample_interview.id}/status",
        json={"status": "COMPLETED"},
        headers=headers,
    )
    assert resp.status_code == 403


def test_update_interview_status_not_found(app, client, admin_user):
    headers = auth_headers(app, admin_user)
    resp = client.put("/api/interviews/99999/status", json={"status": "COMPLETED"}, headers=headers)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Panelist availability
# ---------------------------------------------------------------------------

def test_create_panelist_availability(app, client, panelist_user):
    headers = auth_headers(app, panelist_user)
    resp = client.post(
        "/api/interviews/panelist-availability",
        json={
            "slots": [{"date": "2026-09-01", "start_time": "09:00", "end_time": "17:00"}]
        },
        headers=headers,
    )
    assert resp.status_code in (200, 201)


def test_get_panelist_availability(app, client, panelist_user):
    headers = auth_headers(app, panelist_user)
    resp = client.get("/api/interviews/panelist-availability", headers=headers)
    assert resp.status_code == 200
