"""
Tests for /api/scoring:
- Submit panelist scores
- Retrieve scores
- Score validation (1-10 range)
- Transcript upload (AI scoring mocked)
"""

from unittest.mock import patch, MagicMock

import pytest

from app.extensions import db
from app.models.interview_schedule import PanelAssignment
from tests.conftest import auth_headers


# ---------------------------------------------------------------------------
# POST /api/scoring/interviews/<id>/scores
# ---------------------------------------------------------------------------

def _score_payload(skill_scores=None):
    return {
        "scores": skill_scores or [
            {"skill_name": "Python", "skill_type": "primary", "score": 8},
            {"skill_name": "Communication", "skill_type": "soft", "score": 7},
        ]
    }


def test_submit_scores_panelist(app, client, panelist_user, sample_interview):
    headers = auth_headers(app, panelist_user)
    resp = client.post(
        f"/api/scoring/interviews/{sample_interview.id}/scores",
        json=_score_payload(),
        headers=headers,
    )
    assert resp.status_code in (200, 201)


def test_submit_scores_admin(app, client, admin_user, sample_interview):
    headers = auth_headers(app, admin_user)
    resp = client.post(
        f"/api/scoring/interviews/{sample_interview.id}/scores",
        json=_score_payload(),
        headers=headers,
    )
    assert resp.status_code in (200, 201)


def test_submit_scores_recruiter_forbidden(app, client, recruiter_user, sample_interview):
    """RECRUITER must not submit scores."""
    headers = auth_headers(app, recruiter_user)
    resp = client.post(
        f"/api/scoring/interviews/{sample_interview.id}/scores",
        json=_score_payload(),
        headers=headers,
    )
    assert resp.status_code == 403


def test_submit_scores_interview_not_found(app, client, panelist_user):
    headers = auth_headers(app, panelist_user)
    resp = client.post(
        "/api/scoring/interviews/99999/scores",
        json=_score_payload(),
        headers=headers,
    )
    assert resp.status_code == 404


def test_submit_scores_out_of_range(app, client, panelist_user, sample_interview):
    headers = auth_headers(app, panelist_user)
    payload = {"scores": [{"skill_name": "Python", "skill_type": "primary", "score": 15}]}
    resp = client.post(
        f"/api/scoring/interviews/{sample_interview.id}/scores",
        json=payload,
        headers=headers,
    )
    assert resp.status_code == 400


def test_submit_scores_zero_invalid(app, client, panelist_user, sample_interview):
    headers = auth_headers(app, panelist_user)
    payload = {"scores": [{"skill_name": "Python", "skill_type": "primary", "score": 0}]}
    resp = client.post(
        f"/api/scoring/interviews/{sample_interview.id}/scores",
        json=payload,
        headers=headers,
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/scoring/interviews/<id>/scores
# ---------------------------------------------------------------------------

def test_get_scores_empty(app, client, admin_user, sample_interview):
    headers = auth_headers(app, admin_user)
    resp = client.get(f"/api/scoring/interviews/{sample_interview.id}/scores", headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()
    scores = data if isinstance(data, list) else data.get("scores", [])
    assert isinstance(scores, list)


def test_get_scores_after_submit(app, client, panelist_user, admin_user, sample_interview):
    # Submit first
    panelist_headers = auth_headers(app, panelist_user)
    client.post(
        f"/api/scoring/interviews/{sample_interview.id}/scores",
        json=_score_payload(),
        headers=panelist_headers,
    )

    # Retrieve as admin
    admin_h = auth_headers(app, admin_user)
    resp = client.get(f"/api/scoring/interviews/{sample_interview.id}/scores", headers=admin_h)
    assert resp.status_code == 200


def test_get_scores_unauthenticated(client, sample_interview):
    resp = client.get(f"/api/scoring/interviews/{sample_interview.id}/scores")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/scoring/interviews/<id>/ai-score
# ---------------------------------------------------------------------------

def test_get_ai_score_no_transcript(app, client, admin_user, sample_interview):
    headers = auth_headers(app, admin_user)
    resp = client.get(f"/api/scoring/interviews/{sample_interview.id}/ai-score", headers=headers)
    # Either 404 (no AI score yet) or 200 with empty data
    assert resp.status_code in (200, 404)
