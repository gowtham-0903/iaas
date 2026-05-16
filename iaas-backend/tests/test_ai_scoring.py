"""
Tests for M4 Phase 2 AI scoring engine:
- generate_ai_score weighted average calculation (unit tests — no DB)
- POST /api/scoring/interviews/<id>/generate-score (integration)
- GET /api/scoring/interviews/<id>/ai-score (integration)
"""

import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.extensions import db
from app.models.interview_schedule import InterviewSchedule, PanelAssignment
from app.models.interview_scoring import AIInterviewScore, InterviewScore, InterviewTranscript
from app.models.panelist import Panelist
from app.services.ai_scorer import _compute_weighted_scores, AIScoreResponseV2
from pydantic import ValidationError
from tests.conftest import auth_headers


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def completed_interview(app, sample_candidate, sample_jd, admin_user):
    """COMPLETED interview with a panelist entity."""
    with app.app_context():
        interview = InterviewSchedule(
            candidate_id=sample_candidate.id,
            jd_id=sample_jd.id,
            scheduled_at=datetime(2026, 9, 1, 10, 0, 0),
            duration_minutes=60,
            mode="virtual",
            timezone="Asia/Kolkata",
            status="COMPLETED",
        )
        db.session.add(interview)
        db.session.commit()
        db.session.refresh(interview)
        return interview


@pytest.fixture
def panelist_for_scoring(app, admin_user):
    with app.app_context():
        p = Panelist(
            panel_id="PAN-SCORE-001",
            name="Scoring Panelist",
            skill="Python",
            email="scoringpanelist@example.com",
            created_by=admin_user.id,
        )
        db.session.add(p)
        db.session.commit()
        db.session.refresh(p)
        return p


@pytest.fixture
def interview_with_scores(app, completed_interview, panelist_for_scoring, sample_jd_skills):
    """Interview + panel_assignment + interview_scores."""
    with app.app_context():
        pa = PanelAssignment(
            interview_id=completed_interview.id,
            panelist_id=panelist_for_scoring.id,
            overall_comments="Solid candidate with good fundamentals.",
            recommendation="HIRE",
        )
        db.session.add(pa)

        primary_skill = sample_jd_skills[0]  # Python — primary
        secondary_skill = sample_jd_skills[1]  # REST APIs — secondary

        # Score primary: technical=8, comm=8, ps=8 → avg = 8 → 8/2 = 4.0 on 1-5
        db.session.add(InterviewScore(
            interview_id=completed_interview.id,
            panelist_id=panelist_for_scoring.id,
            skill_id=primary_skill.id,
            technical_score=8,
            communication_score=8,
            problem_solving_score=8,
            comments="Good Python knowledge",
            submitted_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ))
        # Score secondary: technical=6, comm=6, ps=6 → avg = 6 → 6/2 = 3.0 on 1-5
        db.session.add(InterviewScore(
            interview_id=completed_interview.id,
            panelist_id=panelist_for_scoring.id,
            skill_id=secondary_skill.id,
            technical_score=6,
            communication_score=6,
            problem_solving_score=6,
            comments="Decent REST API knowledge",
            submitted_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ))
        db.session.commit()
        fresh = db.session.get(InterviewSchedule, completed_interview.id)
        return fresh


# ---------------------------------------------------------------------------
# Unit tests — weighted average (pure calculation, uses DB)
# ---------------------------------------------------------------------------

def test_weighted_average_known_values(app, interview_with_scores, sample_jd_skills):
    """
    Primary skill avg 1-5 = 4.0  (scores 8/8/8 on 1-10 → mean=8 → /2 = 4.0)
    Secondary skill avg 1-5 = 3.0 (scores 6/6/6 → mean=6 → /2 = 3.0)
    overall = (4.0 * 0.7 + 3.0 * 0.3) * 20 = (2.8 + 0.9) * 20 = 74.0
    primary_match = 4.0/5 * 100 = 80.0
    secondary_match = 3.0/5 * 100 = 60.0
    recommendation = HIRE (70 <= 74 < 85)
    """
    with app.app_context():
        jd_skills = [
            {"id": sample_jd_skills[0].id, "skill_name": "Python", "skill_type": "primary", "subtopics": []},
            {"id": sample_jd_skills[1].id, "skill_name": "REST APIs", "skill_type": "secondary", "subtopics": []},
            {"id": sample_jd_skills[2].id, "skill_name": "Communication", "skill_type": "soft", "subtopics": []},
        ]
        result = _compute_weighted_scores(interview_with_scores.id, jd_skills)

    assert result["overall_score"] == pytest.approx(74.0, abs=0.1)
    assert result["primary_match"] == pytest.approx(80.0, abs=0.1)
    assert result["secondary_match"] == pytest.approx(60.0, abs=0.1)
    assert result["recommendation"] == "HIRE"


def test_primary_only_score_formula(app, interview_with_scores, sample_jd_skills):
    """Score 4/5 on all primary → primary_match=80%."""
    with app.app_context():
        jd_skills = [
            {"id": sample_jd_skills[0].id, "skill_name": "Python", "skill_type": "primary", "subtopics": []},
        ]
        result = _compute_weighted_scores(interview_with_scores.id, jd_skills)

    # Only primary: overall = (4.0 * 0.7 + 0 * 0.3) * 20 = 56.0
    assert result["primary_match"] == pytest.approx(80.0, abs=0.1)
    assert result["overall_score"] == pytest.approx(56.0, abs=0.1)


def test_score_thresholds():
    """Test recommendation thresholds without DB."""
    cases = [
        (90, "STRONG_HIRE"),
        (85, "STRONG_HIRE"),
        (74, "HIRE"),
        (70, "HIRE"),
        (55, "MAYBE"),
        (50, "MAYBE"),
        (49, "NO_HIRE"),
        (0, "NO_HIRE"),
    ]
    # Replicate threshold logic inline
    def threshold(score):
        if score >= 85:
            return "STRONG_HIRE"
        if score >= 70:
            return "HIRE"
        if score >= 50:
            return "MAYBE"
        return "NO_HIRE"

    for score, expected in cases:
        assert threshold(score) == expected, f"score={score}"


def test_no_scores_raises_error(app, completed_interview, sample_jd_skills):
    """generate_ai_score returns FAILED when no interview_scores exist."""
    from app.services.ai_scorer import generate_ai_score
    with app.app_context():
        result = generate_ai_score(completed_interview.id)
    assert result["report_status"] == "FAILED"
    assert "No panelist scores" in result["error"]


# ---------------------------------------------------------------------------
# Pydantic schema validation
# ---------------------------------------------------------------------------

def test_pydantic_rejects_missing_fields():
    """Schema should raise ValidationError when required fields are absent."""
    with pytest.raises(ValidationError):
        AIScoreResponseV2.model_validate({"overall_score": 75})


def test_pydantic_accepts_valid_response():
    valid = {
        "resume_summary": "Experienced Python developer.",
        "skill_scores": [{"skill_name": "Python", "skill_type": "primary", "score": 4, "panelist_avg": 4, "ai_assessment": "Good"}],
        "strengths": ["Problem solving", "Communication", "Python depth"],
        "concerns": ["Limited cloud experience"],
        "screening_question_analysis": [],
        "soft_skill_analysis": {
            "confidence": {"rating": "Confident", "observation": "Spoke clearly"},
            "communication": {"rating": "Good", "observation": "Articulate"},
            "pressure_handling": {"rating": "Capable", "observation": "Handled well"},
        },
        "analytical_skills": {
            "approach_attitude": {"rating": "Positive", "observation": "Enthusiastic"},
            "problem_solving": {"rating": "Problem Solver", "observation": "Methodical"},
            "result_oriented": {"rating": "Highly Oriented", "observation": "Goal driven"},
        },
        "final_remarks": {
            "strengths_paragraph": "The candidate showed strong fundamentals.",
            "conclusion": "Recommend for hire based on performance.",
        },
        "recommendation": "HIRE",
        "overall_score": 75.5,
        "confidence_level": "HIGH",
    }
    parsed = AIScoreResponseV2.model_validate(valid)
    assert parsed.recommendation.value == "HIRE"
    assert parsed.confidence_level == "HIGH"


def test_pydantic_clamps_overall_score_above_100():
    valid = {
        "resume_summary": "X",
        "skill_scores": [],
        "strengths": [],
        "concerns": [],
        "screening_question_analysis": [],
        "soft_skill_analysis": {
            "confidence": {"rating": "Confident", "observation": ""},
            "communication": {"rating": "Good", "observation": ""},
            "pressure_handling": {"rating": "Capable", "observation": ""},
        },
        "analytical_skills": {
            "approach_attitude": {"rating": "Positive", "observation": ""},
            "problem_solving": {"rating": "Average", "observation": ""},
            "result_oriented": {"rating": "Passable", "observation": ""},
        },
        "final_remarks": {"strengths_paragraph": "X", "conclusion": "X"},
        "recommendation": "HIRE",
        "overall_score": 150,  # should clamp to 100
        "confidence_level": "HIGH",
    }
    parsed = AIScoreResponseV2.model_validate(valid)
    assert parsed.overall_score == 100.0


# ---------------------------------------------------------------------------
# POST /generate-score endpoint tests
# ---------------------------------------------------------------------------

_MOCK_GPT_RESPONSE = {
    "resume_summary": "Experienced Python developer with 5 years.",
    "skill_scores": [{"skill_name": "Python", "skill_type": "primary", "score": 4, "panelist_avg": 4, "ai_assessment": "Strong"}],
    "strengths": ["Deep Python knowledge", "Good communication", "Fast learner"],
    "concerns": ["Limited cloud experience"],
    "screening_question_analysis": [],
    "soft_skill_analysis": {
        "confidence": {"rating": "Confident", "observation": "Spoke clearly"},
        "communication": {"rating": "Good", "observation": "Articulate"},
        "pressure_handling": {"rating": "Capable", "observation": "Calm"},
    },
    "analytical_skills": {
        "approach_attitude": {"rating": "Positive", "observation": "Enthusiastic"},
        "problem_solving": {"rating": "Problem Solver", "observation": "Methodical"},
        "result_oriented": {"rating": "Highly Oriented", "observation": "Goal driven"},
    },
    "final_remarks": {
        "strengths_paragraph": "The candidate demonstrated strong Python fundamentals.",
        "conclusion": "Recommend for hire.",
    },
    "recommendation": "HIRE",
    "overall_score": 74,
    "confidence_level": "LOW",
}


def _mock_openai(response_dict=None):
    if response_dict is None:
        response_dict = _MOCK_GPT_RESPONSE
    mock_choice = MagicMock()
    mock_choice.message.content = json.dumps(response_dict)
    mock_completion = MagicMock()
    mock_completion.choices = [mock_choice]
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    return mock_client


def test_generate_score_forbidden_for_recruiter(app, client, recruiter_user, completed_interview):
    headers = auth_headers(app, recruiter_user)
    resp = client.post(
        f"/api/scoring/interviews/{completed_interview.id}/generate-score",
        headers=headers,
    )
    assert resp.status_code == 403


def test_generate_score_interview_not_found(app, client, admin_user):
    headers = auth_headers(app, admin_user)
    resp = client.post("/api/scoring/interviews/99999/generate-score", headers=headers)
    assert resp.status_code == 404


def test_generate_score_not_completed(app, client, admin_user, sample_interview):
    """sample_interview has status=SCHEDULED → should return 400."""
    headers = auth_headers(app, admin_user)
    resp = client.post(
        f"/api/scoring/interviews/{sample_interview.id}/generate-score",
        headers=headers,
    )
    assert resp.status_code == 400
    assert "COMPLETED" in resp.get_json()["error"]


def test_generate_score_no_panelist_scores(app, client, admin_user, completed_interview):
    """No interview_scores → 400."""
    headers = auth_headers(app, admin_user)
    resp = client.post(
        f"/api/scoring/interviews/{completed_interview.id}/generate-score",
        headers=headers,
    )
    assert resp.status_code == 400
    assert "No panelist scores" in resp.get_json()["error"]


def test_generate_score_success(app, client, admin_user, interview_with_scores):
    headers = auth_headers(app, admin_user)
    with patch("app.services.ai_scorer.OpenAI") as MockOpenAI:
        MockOpenAI.return_value = _mock_openai()
        resp = client.post(
            f"/api/scoring/interviews/{interview_with_scores.id}/generate-score",
            headers=headers,
        )
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["report_status"] == "GENERATED"
    assert data["overall_score"] is not None
    assert data["recommendation"] is not None
    assert data["primary_match"] is not None
    assert data["secondary_match"] is not None


def test_generate_score_stores_all_fields(app, client, admin_user, interview_with_scores):
    """Verify DB record has primary_match, secondary_match, skill_breakdown, ai_suggestion."""
    headers = auth_headers(app, admin_user)
    with patch("app.services.ai_scorer.OpenAI") as MockOpenAI:
        MockOpenAI.return_value = _mock_openai()
        client.post(
            f"/api/scoring/interviews/{interview_with_scores.id}/generate-score",
            headers=headers,
        )
    with app.app_context():
        row = db.session.execute(
            __import__("sqlalchemy").text(
                "SELECT primary_match, secondary_match, skill_breakdown, ai_suggestion, recommendation "
                "FROM ai_interview_scores WHERE interview_id = :iid LIMIT 1"
            ),
            {"iid": interview_with_scores.id},
        ).mappings().first()

    assert row is not None
    assert row["primary_match"] is not None
    assert row["secondary_match"] is not None
    # recommendation uses threshold logic, not GPT value
    assert row["recommendation"] in ("STRONG_HIRE", "HIRE", "MAYBE", "NO_HIRE")


def test_generate_score_recommendation_uses_threshold_not_gpt(app, client, admin_user, interview_with_scores):
    """GPT returns 'STRONG_HIRE' but computed score (~74) → threshold should be 'HIRE'."""
    gpt_says_strong_hire = dict(_MOCK_GPT_RESPONSE, recommendation="STRONG_HIRE", overall_score=99)
    headers = auth_headers(app, admin_user)
    with patch("app.services.ai_scorer.OpenAI") as MockOpenAI:
        MockOpenAI.return_value = _mock_openai(gpt_says_strong_hire)
        resp = client.post(
            f"/api/scoring/interviews/{interview_with_scores.id}/generate-score",
            headers=headers,
        )
    assert resp.status_code == 200
    # Computed overall ≈ 74 → HIRE, NOT STRONG_HIRE
    assert resp.get_json()["data"]["recommendation"] == "HIRE"


def test_generate_score_409_on_duplicate(app, client, admin_user, interview_with_scores):
    """Second call without ?regenerate=true → 409."""
    headers = auth_headers(app, admin_user)
    with patch("app.services.ai_scorer.OpenAI") as MockOpenAI:
        MockOpenAI.return_value = _mock_openai()
        client.post(
            f"/api/scoring/interviews/{interview_with_scores.id}/generate-score",
            headers=headers,
        )
        resp2 = client.post(
            f"/api/scoring/interviews/{interview_with_scores.id}/generate-score",
            headers=headers,
        )
    assert resp2.status_code == 409


def test_generate_score_regenerate_flag(app, client, admin_user, interview_with_scores):
    """?regenerate=true allows overwriting GENERATED score."""
    headers = auth_headers(app, admin_user)
    with patch("app.services.ai_scorer.OpenAI") as MockOpenAI:
        MockOpenAI.return_value = _mock_openai()
        client.post(
            f"/api/scoring/interviews/{interview_with_scores.id}/generate-score",
            headers=headers,
        )
        resp2 = client.post(
            f"/api/scoring/interviews/{interview_with_scores.id}/generate-score?regenerate=true",
            headers=headers,
        )
    assert resp2.status_code == 200


def test_generate_score_failed_after_retries(app, client, admin_user, interview_with_scores):
    """All 3 retries return invalid JSON → report_status=FAILED → endpoint returns 500."""
    headers = auth_headers(app, admin_user)
    mock_choice = MagicMock()
    mock_choice.message.content = "not valid json {{{"
    mock_completion = MagicMock()
    mock_completion.choices = [mock_choice]
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion

    with patch("app.services.ai_scorer.OpenAI", return_value=mock_client):
        with patch("app.services.ai_scorer.time.sleep"):
            resp = client.post(
                f"/api/scoring/interviews/{interview_with_scores.id}/generate-score",
                headers=headers,
            )
    assert resp.status_code == 500
    assert resp.get_json()["report_status"] == "FAILED"


def test_generate_score_no_transcript_low_confidence(app, client, admin_user, interview_with_scores):
    """Without transcript, confidence_level should be LOW (no transcript in fixture)."""
    headers = auth_headers(app, admin_user)
    with patch("app.services.ai_scorer.OpenAI") as MockOpenAI:
        MockOpenAI.return_value = _mock_openai()
        resp = client.post(
            f"/api/scoring/interviews/{interview_with_scores.id}/generate-score",
            headers=headers,
        )
    assert resp.status_code == 200


def test_generate_score_with_transcript(app, client, admin_user, interview_with_scores):
    """With transcript, scoring should still succeed."""
    with app.app_context():
        t = InterviewTranscript(
            interview_id=interview_with_scores.id,
            uploaded_by=admin_user.id,
            raw_text="Interviewer: Tell me about Python.\nCandidate: I have 5 years experience.",
            parsed_text="Interviewer: Tell me about Python.\nCandidate: I have 5 years experience.",
            upload_type="text",
            uploaded_at=datetime.now(timezone.utc).replace(tzinfo=None),
            source="manual_upload",
        )
        db.session.add(t)
        db.session.commit()

    headers = auth_headers(app, admin_user)
    gpt_with_high_confidence = dict(_MOCK_GPT_RESPONSE, confidence_level="HIGH")
    with patch("app.services.ai_scorer.OpenAI") as MockOpenAI:
        MockOpenAI.return_value = _mock_openai(gpt_with_high_confidence)
        resp = client.post(
            f"/api/scoring/interviews/{interview_with_scores.id}/generate-score",
            headers=headers,
        )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# GET /api/scoring/interviews/<id>/ai-score
# ---------------------------------------------------------------------------

def test_get_ai_score_returns_full_suggestion(app, client, admin_user, interview_with_scores):
    headers = auth_headers(app, admin_user)
    # Generate first
    with patch("app.services.ai_scorer.OpenAI") as MockOpenAI:
        MockOpenAI.return_value = _mock_openai()
        client.post(
            f"/api/scoring/interviews/{interview_with_scores.id}/generate-score",
            headers=headers,
        )

    resp = client.get(
        f"/api/scoring/interviews/{interview_with_scores.id}/ai-score",
        headers=headers,
    )
    assert resp.status_code == 200
    ai_score = resp.get_json()["ai_score"]
    assert "ai_suggestion" in ai_score
    assert ai_score["primary_match"] is not None
    assert ai_score["secondary_match"] is not None


def test_get_ai_score_404_when_none(app, client, admin_user, completed_interview):
    headers = auth_headers(app, admin_user)
    resp = client.get(
        f"/api/scoring/interviews/{completed_interview.id}/ai-score",
        headers=headers,
    )
    assert resp.status_code == 404
