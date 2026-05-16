"""
Tests for /api/feedback/<token>

Coverage:
  GET  — valid token, invalid token, expired, already used, no skills
  POST — happy path (no_coding_round toggle, with coding Q&A, all 4 recommendations, multi-pair)
       — token state errors (404, 409, 410)
       — score validation (empty list, out-of-range, zero, bad recommendation)
       — comment minimums: primary 1000, secondary 250, soft 250, overall 500
       — coding section: missing Q&A, empty pairs, no score, score out of range,
         assessment too short, exact minimums, no_coding_round skips all coding validation
"""

from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa

from app.extensions import db
from app.models.interview_schedule import PanelAssignment
from app.models.jd_skill import JDSkill

# ---------------------------------------------------------------------------
# Constants mirroring the backend rules
# ---------------------------------------------------------------------------

COMMENT_MIN = {"primary": 1000, "secondary": 250, "soft": 250}
OVERALL_MIN = 500
CODING_COMMENT_MIN = 1000


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _comment(length: int) -> str:
    """Return a string of exactly `length` non-whitespace characters.
    Using only alphanumeric chars so .strip() inside the backend never changes the length."""
    return ("abcdefghijklmnopqrstuvwxyz0123456789" * (length // 36 + 2))[:length]


def _make_token(app, interview_id: int, panelist_id: int, token: str,
                expires_offset_hours: int = 24, token_used: bool = False,
                valid_from_offset_hours: int = -1):
    """Set a feedback token on an existing panel_assignment row.
    valid_from defaults to 1 hour in the past so tests are never blocked."""
    with app.app_context():
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        valid_from = now + timedelta(hours=valid_from_offset_hours)
        expires_at = now + timedelta(hours=expires_offset_hours)
        db.session.execute(
            sa.text(
                "UPDATE panel_assignments "
                "SET feedback_token = :token, token_valid_from = :vf, "
                "token_expires_at = :exp, "
                "token_used = :used, token_used_at = NULL "
                "WHERE interview_id = :iid AND panelist_id = :pid"
            ),
            {"token": token, "vf": valid_from, "exp": expires_at,
             "used": 1 if token_used else 0,
             "iid": interview_id, "pid": panelist_id},
        )
        db.session.commit()


def _make_expired_token(app, interview_id: int, panelist_id: int, token: str):
    """Set an already-expired feedback token (valid_from also in past so it passes that check)."""
    with app.app_context():
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        valid_from = now - timedelta(hours=200)
        expired_at = now - timedelta(hours=72)
        db.session.execute(
            sa.text(
                "UPDATE panel_assignments "
                "SET feedback_token = :token, token_valid_from = :vf, "
                "token_expires_at = :exp, "
                "token_used = 0, token_used_at = NULL "
                "WHERE interview_id = :iid AND panelist_id = :pid"
            ),
            {"token": token, "vf": valid_from, "exp": expired_at,
             "iid": interview_id, "pid": panelist_id},
        )
        db.session.commit()


def _valid_payload(skills, *, with_coding: bool = False):
    """Build a fully valid POST payload satisfying all character minimums."""
    scores = [
        {
            "skill_id": s.id,
            "skill_name": s.skill_name,
            "skill_type": s.skill_type,
            "score": 4,
            "comments": _comment(COMMENT_MIN.get(s.skill_type, 0)),
        }
        for s in skills
    ]
    payload = {
        "scores": scores,
        "overall_comments": _comment(OVERALL_MIN),
        "recommendation": "HIRE",
        "no_coding_round": not with_coding,
    }
    if with_coding:
        payload.update({
            "coding_qa": [{
                "question": "Implement binary search on a sorted array.",
                "answer": "def bs(arr, t):\n    lo, hi = 0, len(arr)-1\n    while lo<=hi:\n        mid=(lo+hi)//2\n        if arr[mid]==t: return mid\n        elif arr[mid]<t: lo=mid+1\n        else: hi=mid-1\n    return -1",
            }],
            "coding_score": 4,
            "coding_comments": _comment(CODING_COMMENT_MIN),
        })
    return payload


# ---------------------------------------------------------------------------
# GET /api/feedback/<token>
# ---------------------------------------------------------------------------

def test_get_feedback_valid_token(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Valid token returns 200 with candidate, JD, panelist, and sorted skills."""
    token = "get-valid-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    resp = client.get(f"/api/feedback/{token}")
    assert resp.status_code == 200
    data = resp.get_json()

    assert data["candidate_name"] == "Jane Doe"
    assert data["jd_title"] == "Senior Python Developer"
    assert data["job_code"] == "JD-2026-0001"
    assert data["panelist_name"] == "Test Panelist"
    assert isinstance(data["skills"], list)
    assert len(data["skills"]) == 3
    # sorted: primary → secondary → soft
    assert [s["skill_type"] for s in data["skills"]] == ["primary", "secondary", "soft"]
    for skill in data["skills"]:
        assert {"id", "skill_name", "skill_type", "subtopics"} <= skill.keys()


def test_get_feedback_invalid_token(client):
    """Non-existent token returns 404."""
    resp = client.get("/api/feedback/does-not-exist-xyz")
    assert resp.status_code == 404
    assert "error" in resp.get_json()


def test_get_feedback_expired_token(app, client, feedback_interview, panelist_entity):
    """Expired token returns 410."""
    token = "get-expired-001"
    _make_expired_token(app, feedback_interview.id, panelist_entity.id, token)

    resp = client.get(f"/api/feedback/{token}")
    assert resp.status_code == 410
    assert "error" in resp.get_json()


def test_get_feedback_used_token(app, client, feedback_interview, panelist_entity):
    """Already-used token returns 409."""
    token = "get-used-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token, token_used=True)

    resp = client.get(f"/api/feedback/{token}")
    assert resp.status_code == 409
    assert "error" in resp.get_json()


def test_get_feedback_not_yet_available(app, client, feedback_interview, panelist_entity):
    """Token with future valid_from returns 425 with available_from field."""
    token = "get-not-yet-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token,
                valid_from_offset_hours=+2)  # available 2 hours from now

    resp = client.get(f"/api/feedback/{token}")
    assert resp.status_code == 425
    data = resp.get_json()
    assert "error" in data
    assert "available_from" in data


def test_get_feedback_no_skills(app, client, feedback_interview, panelist_entity):
    """Feedback form loads even when JD has no skills — returns empty list."""
    token = "get-no-skills-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    resp = client.get(f"/api/feedback/{token}")
    assert resp.status_code == 200
    assert isinstance(resp.get_json()["skills"], list)


# ---------------------------------------------------------------------------
# POST — happy path
# ---------------------------------------------------------------------------

def test_submit_no_coding_round_toggle(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """no_coding_round=True stores None for all coding columns."""
    token = "post-no-coding-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    resp = client.post(f"/api/feedback/{token}", json=_valid_payload(sample_jd_skills))
    assert resp.status_code == 201
    assert resp.get_json()["message"] == "Feedback submitted successfully"

    with app.app_context():
        row = db.session.execute(
            sa.text(
                "SELECT token_used, recommendation, overall_comments, "
                "no_coding_round, coding_qa, coding_score, coding_comments "
                "FROM panel_assignments WHERE feedback_token = :t"
            ),
            {"t": token},
        ).mappings().first()
        assert row["token_used"] in (True, 1)
        assert row["recommendation"] == "HIRE"
        assert row["no_coding_round"] in (True, 1)
        assert row["coding_qa"] is None
        assert row["coding_score"] is None
        assert row["coding_comments"] is None


def test_submit_with_coding_section(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Coding Q&A + score + assessment stored correctly in DB."""
    token = "post-with-coding-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    resp = client.post(f"/api/feedback/{token}", json=_valid_payload(sample_jd_skills, with_coding=True))
    assert resp.status_code == 201

    with app.app_context():
        row = db.session.execute(
            sa.text(
                "SELECT no_coding_round, coding_qa, coding_score, coding_comments "
                "FROM panel_assignments WHERE feedback_token = :t"
            ),
            {"t": token},
        ).mappings().first()
        assert row["no_coding_round"] in (False, 0, None)
        assert row["coding_qa"] is not None
        assert row["coding_score"] == 4
        assert row["coding_comments"] is not None
        assert len(row["coding_comments"]) >= CODING_COMMENT_MIN


def test_submit_all_recommendations(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """All four recommendation values are accepted."""
    for i, rec in enumerate(["STRONG_HIRE", "HIRE", "MAYBE", "NO_HIRE"]):
        token = f"post-rec-{i:03d}"
        _make_token(app, feedback_interview.id, panelist_entity.id, token)

        payload = _valid_payload(sample_jd_skills)
        payload["recommendation"] = rec
        resp = client.post(f"/api/feedback/{token}", json=payload)
        assert resp.status_code == 201, f"rec={rec} failed: {resp.get_json()}"


def test_submit_multiple_coding_pairs(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Multiple Q&A pairs stored as JSON array."""
    token = "post-multi-pairs-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills, with_coding=True)
    payload["coding_qa"] = [
        {"question": "Binary search", "answer": "def bs(): pass"},
        {"question": "Reverse a linked list", "answer": "def rev(): pass"},
    ]
    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 201


def test_submit_scores_persisted(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Per-skill scores are stored in interview_scores with overall_score only."""
    token = "post-scores-persist-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    resp = client.post(f"/api/feedback/{token}", json=_valid_payload(sample_jd_skills))
    assert resp.status_code == 201

    with app.app_context():
        rows = db.session.execute(
            sa.text("SELECT overall_score, technical_score, communication_score, problem_solving_score "
                    "FROM interview_scores WHERE interview_id = :iid"),
            {"iid": feedback_interview.id},
        ).mappings().all()
        assert len(rows) == len(sample_jd_skills)
        for row in rows:
            assert row["overall_score"] == 4
            assert row["technical_score"] is None
            assert row["communication_score"] is None
            assert row["problem_solving_score"] is None


# ---------------------------------------------------------------------------
# POST — token state errors (resolved before payload validation)
# ---------------------------------------------------------------------------

def test_submit_invalid_token(client):
    """Non-existent token returns 404 without touching payload."""
    resp = client.post("/api/feedback/nonexistent-token-xyz", json={})
    assert resp.status_code == 404


def test_submit_already_used(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Already-used token returns 409."""
    token = "post-used-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token, token_used=True)

    resp = client.post(f"/api/feedback/{token}", json=_valid_payload(sample_jd_skills))
    assert resp.status_code == 409


def test_submit_expired(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Expired token returns 410."""
    token = "post-expired-001"
    _make_expired_token(app, feedback_interview.id, panelist_entity.id, token)

    resp = client.post(f"/api/feedback/{token}", json=_valid_payload(sample_jd_skills))
    assert resp.status_code == 410


# ---------------------------------------------------------------------------
# POST — score field validation
# ---------------------------------------------------------------------------

def test_empty_scores_list(app, client, feedback_interview, panelist_entity):
    """Empty scores list returns 400 with scores error key."""
    token = "post-empty-scores-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    resp = client.post(f"/api/feedback/{token}", json={
        "scores": [], "overall_comments": "", "recommendation": "HIRE"
    })
    assert resp.status_code == 400
    data = resp.get_json()
    assert "errors" in data and "scores" in data["errors"]


def test_score_out_of_range(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Score of 11 (> 10) returns 400."""
    token = "post-score-range-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    resp = client.post(f"/api/feedback/{token}", json={
        "scores": [{"skill_id": sample_jd_skills[0].id, "skill_name": "Python",
                    "skill_type": "primary", "score": 11, "comments": ""}],
        "overall_comments": "", "recommendation": "HIRE",
    })
    assert resp.status_code == 400
    assert "errors" in resp.get_json()


def test_score_zero(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Score of 0 (< 1) returns 400."""
    token = "post-score-zero-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    resp = client.post(f"/api/feedback/{token}", json={
        "scores": [{"skill_id": sample_jd_skills[0].id, "skill_name": "Python",
                    "skill_type": "primary", "score": 0, "comments": ""}],
        "overall_comments": "", "recommendation": "HIRE",
    })
    assert resp.status_code == 400


def test_invalid_recommendation(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Unrecognised recommendation string returns 400."""
    token = "post-bad-rec-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    resp = client.post(f"/api/feedback/{token}", json={
        "scores": [{"skill_id": sample_jd_skills[0].id, "skill_name": "Python",
                    "skill_type": "primary", "score": 7, "comments": ""}],
        "overall_comments": "", "recommendation": "TOTALLY_HIRE",
    })
    assert resp.status_code == 400
    data = resp.get_json()
    assert "errors" in data and "recommendation" in data["errors"]


# ---------------------------------------------------------------------------
# POST — per-skill comment minimum enforcement
# ---------------------------------------------------------------------------

def test_primary_comment_too_short(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Primary skill comment of 999 chars returns 400 mentioning 1000."""
    token = "post-primary-short-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    primary = next(s for s in sample_jd_skills if s.skill_type == "primary")
    for entry in payload["scores"]:
        if entry["skill_id"] == primary.id:
            entry["comments"] = _comment(999)

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 400
    error = resp.get_json()["error"]
    assert "1000" in error


def test_primary_comment_exact_minimum(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Primary skill comment of exactly 1000 chars is accepted."""
    token = "post-primary-exact-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    primary = next(s for s in sample_jd_skills if s.skill_type == "primary")
    for entry in payload["scores"]:
        if entry["skill_id"] == primary.id:
            entry["comments"] = _comment(1000)

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 201


def test_secondary_comment_too_short(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Secondary skill comment of 249 chars returns 400 mentioning 250."""
    token = "post-secondary-short-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    secondary = next(s for s in sample_jd_skills if s.skill_type == "secondary")
    for entry in payload["scores"]:
        if entry["skill_id"] == secondary.id:
            entry["comments"] = _comment(249)

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 400
    assert "250" in resp.get_json()["error"]


def test_soft_comment_too_short(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Soft skill comment of 100 chars returns 400 mentioning 250."""
    token = "post-soft-short-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    soft = next(s for s in sample_jd_skills if s.skill_type == "soft")
    for entry in payload["scores"]:
        if entry["skill_id"] == soft.id:
            entry["comments"] = _comment(100)

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 400
    assert "250" in resp.get_json()["error"]


def test_secondary_comment_exact_minimum(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Secondary skill comment of exactly 250 chars is accepted."""
    token = "post-secondary-exact-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    secondary = next(s for s in sample_jd_skills if s.skill_type == "secondary")
    for entry in payload["scores"]:
        if entry["skill_id"] == secondary.id:
            entry["comments"] = _comment(250)

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 201


# ---------------------------------------------------------------------------
# POST — overall comment minimum enforcement
# ---------------------------------------------------------------------------

def test_overall_comment_too_short(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Overall comments of 499 chars returns 400 mentioning 500."""
    token = "post-overall-short-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    payload["overall_comments"] = _comment(499)

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 400
    assert "500" in resp.get_json()["error"]


def test_overall_comment_exact_minimum(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Overall comments of exactly 500 chars is accepted."""
    token = "post-overall-exact-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    payload["overall_comments"] = _comment(500)

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 201


def test_overall_comment_missing(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Missing overall_comments (empty string) returns 400."""
    token = "post-overall-missing-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    payload["overall_comments"] = ""

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST — coding section validation
# ---------------------------------------------------------------------------

def test_coding_required_when_not_toggled(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """no_coding_round=False with no Q&A returns 400."""
    token = "post-coding-missing-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    payload["no_coding_round"] = False
    payload["coding_qa"] = []
    payload["coding_score"] = 7
    payload["coding_comments"] = _comment(CODING_COMMENT_MIN)

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 400
    assert "coding" in resp.get_json()["error"].lower()


def test_coding_empty_pair_fields_rejected(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """Q&A pairs with blank question/answer are filtered — still fails if no valid pair."""
    token = "post-coding-empty-pair-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    payload["no_coding_round"] = False
    payload["coding_qa"] = [
        {"question": "", "answer": ""},
        {"question": "  ", "answer": "valid answer"},
    ]
    payload["coding_score"] = 7
    payload["coding_comments"] = _comment(CODING_COMMENT_MIN)

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 400


def test_coding_score_missing(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """coding_score=None with Q&A present returns 400."""
    token = "post-coding-no-score-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    payload["no_coding_round"] = False
    payload["coding_qa"] = [{"question": "Reverse a string", "answer": "s[::-1]"}]
    payload["coding_score"] = None
    payload["coding_comments"] = _comment(CODING_COMMENT_MIN)

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 400
    assert "coding score" in resp.get_json()["error"].lower()


def test_coding_score_out_of_range(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """coding_score=11 returns 400."""
    token = "post-coding-score-range-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    payload["no_coding_round"] = False
    payload["coding_qa"] = [{"question": "Q", "answer": "A"}]
    payload["coding_score"] = 11
    payload["coding_comments"] = _comment(CODING_COMMENT_MIN)

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 400


def test_coding_assessment_too_short(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """coding_comments of 999 chars returns 400 mentioning 1000."""
    token = "post-coding-short-comment-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    payload["no_coding_round"] = False
    payload["coding_qa"] = [{"question": "Q", "answer": "A"}]
    payload["coding_score"] = 4
    payload["coding_comments"] = _comment(999)

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 400
    assert "1000" in resp.get_json()["error"]


def test_coding_assessment_exact_minimum(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """coding_comments of exactly 1000 chars is accepted."""
    token = "post-coding-exact-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    payload["no_coding_round"] = False
    payload["coding_qa"] = [{"question": "Reverse a string", "answer": "return s[::-1]"}]
    payload["coding_score"] = 5
    payload["coding_comments"] = _comment(1000)

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 201


def test_no_coding_round_skips_all_coding_validation(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """no_coding_round=True skips coding validation — no coding fields required."""
    token = "post-no-coding-skip-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    payload["no_coding_round"] = True
    # Intentionally omit all coding fields
    for key in ("coding_qa", "coding_score", "coding_comments"):
        payload.pop(key, None)

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 201


def test_coding_score_zero_rejected(app, client, feedback_interview, sample_jd_skills, panelist_entity):
    """coding_score=0 (< 1) returns 400."""
    token = "post-coding-score-zero-001"
    _make_token(app, feedback_interview.id, panelist_entity.id, token)

    payload = _valid_payload(sample_jd_skills)
    payload["no_coding_round"] = False
    payload["coding_qa"] = [{"question": "Q", "answer": "A"}]
    payload["coding_score"] = 0
    payload["coding_comments"] = _comment(CODING_COMMENT_MIN)

    resp = client.post(f"/api/feedback/{token}", json=payload)
    assert resp.status_code == 400
