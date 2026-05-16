"""
Tests for M4 Phase 3: QC report distribution.
- report_distributor.distribute_report() unit/integration tests
- POST /api/qc/interviews/<id>/distribute endpoint tests
- PUT /api/qc/interviews/<id>/review with approved=True triggers distribution
- GET /api/qc/interviews list with extended fields
"""

import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.extensions import db
from app.models.candidate import Candidate
from app.models.client import Client
from app.models.feedback_validation import FeedbackValidation
from app.models.interview_schedule import InterviewSchedule, PanelAssignment
from app.models.interview_scoring import AIInterviewScore, InterviewTranscript
from app.models.jd_recruiter_assignment import JDRecruiterAssignment
from app.models.job_description import JobDescription
from app.models.panelist import Panelist
from app.models.user import User, UserRole
from tests.conftest import auth_headers


# ---------------------------------------------------------------------------
# Helpers / Fixtures
# ---------------------------------------------------------------------------

def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture
def dist_client_entity(app):
    with app.app_context():
        c = Client(name="Dist Client", industry="Tech", contact_email="contact@distclient.com")
        db.session.add(c)
        db.session.commit()
        db.session.refresh(c)
        return c


@pytest.fixture
def dist_m_recruiter(app, dist_client_entity):
    with app.app_context():
        u = User(
            full_name="M Recruiter Boss",
            email="m_rec_boss@dist.com",
            role=UserRole.M_RECRUITER.value,
            client_id=dist_client_entity.id,
        )
        u.set_password("Test@1234")
        db.session.add(u)
        db.session.commit()
        db.session.refresh(u)
        return u


@pytest.fixture
def dist_sr_recruiter(app, dist_client_entity, dist_m_recruiter):
    with app.app_context():
        u = User(
            full_name="SR Recruiter",
            email="sr_rec@dist.com",
            role=UserRole.SR_RECRUITER.value,
            client_id=dist_client_entity.id,
            reports_to=dist_m_recruiter.id,
        )
        u.set_password("Test@1234")
        db.session.add(u)
        db.session.commit()
        db.session.refresh(u)
        return u


@pytest.fixture
def dist_recruiter(app, dist_client_entity, dist_sr_recruiter):
    with app.app_context():
        u = User(
            full_name="Recruiter A",
            email="rec_a@dist.com",
            role=UserRole.RECRUITER.value,
            client_id=dist_client_entity.id,
            reports_to=dist_sr_recruiter.id,
        )
        u.set_password("Test@1234")
        db.session.add(u)
        db.session.commit()
        db.session.refresh(u)
        return u


@pytest.fixture
def dist_recruiter2(app, dist_client_entity, dist_sr_recruiter):
    """Second recruiter under the same SR_RECRUITER — tests dedup."""
    with app.app_context():
        u = User(
            full_name="Recruiter B",
            email="rec_b@dist.com",
            role=UserRole.RECRUITER.value,
            client_id=dist_client_entity.id,
            reports_to=dist_sr_recruiter.id,
        )
        u.set_password("Test@1234")
        db.session.add(u)
        db.session.commit()
        db.session.refresh(u)
        return u


@pytest.fixture
def dist_jd(app, dist_client_entity, admin_user):
    with app.app_context():
        jd = JobDescription(
            client_id=dist_client_entity.id,
            title="Backend Engineer",
            job_code="JD-2026-DIST",
            raw_text="Python dev needed.",
            status="ACTIVE",
            created_by=admin_user.id,
        )
        db.session.add(jd)
        db.session.commit()
        db.session.refresh(jd)
        return jd


@pytest.fixture
def dist_candidate(app, dist_client_entity, dist_jd):
    with app.app_context():
        cand = Candidate(
            client_id=dist_client_entity.id,
            jd_id=dist_jd.id,
            full_name="Alice Dist",
            email="alice@dist.com",
            phone="+1111111111",
            status="INTERVIEWED",
        )
        db.session.add(cand)
        db.session.commit()
        db.session.refresh(cand)
        return cand


@pytest.fixture
def dist_panelist(app, admin_user):
    with app.app_context():
        p = Panelist(
            panel_id="PAN-DIST-001",
            name="Dist Panelist",
            skill="Python",
            email="panelist@dist.com",
            created_by=admin_user.id,
        )
        db.session.add(p)
        db.session.commit()
        db.session.refresh(p)
        return p


@pytest.fixture
def dist_interview(app, dist_candidate, dist_jd, dist_panelist, admin_user):
    """COMPLETED interview with transcript + AI score + approved FV."""
    with app.app_context():
        interview = InterviewSchedule(
            candidate_id=dist_candidate.id,
            jd_id=dist_jd.id,
            scheduled_at=datetime(2026, 10, 1, 10, 0),
            duration_minutes=60,
            mode="virtual",
            timezone="Asia/Kolkata",
            status="COMPLETED",
        )
        db.session.add(interview)
        db.session.commit()

        pa = PanelAssignment(interview_id=interview.id, panelist_id=dist_panelist.id)
        db.session.add(pa)

        transcript = InterviewTranscript(
            interview_id=interview.id,
            uploaded_by=admin_user.id,
            raw_text="Sample transcript.",
            upload_type="text",
            uploaded_at=_now(),
        )
        db.session.add(transcript)
        db.session.commit()

        ai_score = AIInterviewScore(
            interview_id=interview.id,
            transcript_id=transcript.id,
            overall_score=78.5,
            skill_scores=json.dumps([]),
            strengths=json.dumps(["Strong Python", "Good communication", "Fast learner"]),
            concerns=json.dumps(["Limited cloud experience"]),
            recommendation="HIRE",
            report_status="GENERATED",
            generated_at=_now(),
        )
        db.session.add(ai_score)

        fv = FeedbackValidation(
            interview_id=interview.id,
            validated_by=admin_user.id,
            status="VALIDATED",
            final_recommendation="HIRE",
            approved=True,
            validated_at=_now(),
            created_at=_now(),
        )
        db.session.add(fv)
        db.session.commit()
        db.session.refresh(interview)
        return interview


@pytest.fixture
def dist_interview_unapproved(app, dist_candidate, dist_jd, dist_panelist, admin_user):
    """Interview with FV not yet approved."""
    with app.app_context():
        interview = InterviewSchedule(
            candidate_id=dist_candidate.id,
            jd_id=dist_jd.id,
            scheduled_at=datetime(2026, 10, 2, 10, 0),
            duration_minutes=60,
            mode="virtual",
            timezone="Asia/Kolkata",
            status="COMPLETED",
        )
        db.session.add(interview)
        db.session.commit()

        transcript = InterviewTranscript(
            interview_id=interview.id,
            uploaded_by=admin_user.id,
            raw_text="Sample transcript.",
            upload_type="text",
            uploaded_at=_now(),
        )
        db.session.add(transcript)
        db.session.commit()

        ai_score = AIInterviewScore(
            interview_id=interview.id,
            transcript_id=transcript.id,
            overall_score=60.0,
            skill_scores=json.dumps([]),
            strengths=json.dumps([]),
            concerns=json.dumps([]),
            recommendation="MAYBE",
            report_status="GENERATED",
            generated_at=_now(),
        )
        db.session.add(ai_score)

        fv = FeedbackValidation(
            interview_id=interview.id,
            validated_by=admin_user.id,
            status="PENDING",
            final_recommendation="MAYBE",
            approved=False,
            created_at=_now(),
        )
        db.session.add(fv)
        db.session.commit()
        db.session.refresh(interview)
        return interview


def _assign_recruiter(app, jd_id, user_id):
    with app.app_context():
        existing = db.session.execute(
            __import__("sqlalchemy").text(
                "SELECT 1 FROM jd_recruiter_assignments WHERE jd_id=:j AND recruiter_id=:u LIMIT 1"
            ),
            {"j": jd_id, "u": user_id},
        ).first()
        if not existing:
            asgn = JDRecruiterAssignment(jd_id=jd_id, recruiter_id=user_id, assigned_by=user_id)
            db.session.add(asgn)
            db.session.commit()


# ---------------------------------------------------------------------------
# Unit tests — _resolve_recipients (via distribute_report internals)
# ---------------------------------------------------------------------------

def test_recipient_hierarchy_recruiter_sr_m(
    app, dist_interview, dist_recruiter, dist_sr_recruiter, dist_m_recruiter, dist_jd
):
    """Recruiter → SR_RECRUITER → M_RECRUITER all appear in recipient list."""
    _assign_recruiter(app, dist_jd.id, dist_recruiter.id)

    with app.app_context():
        from app.services.report_distributor import _resolve_recipients
        to_emails, cc_email = _resolve_recipients(dist_jd.id)

    emails_set = set(to_emails)
    assert dist_recruiter.email.lower() in emails_set
    assert dist_sr_recruiter.email.lower() in emails_set
    assert dist_m_recruiter.email.lower() in emails_set


def test_recipient_dedup_two_recruiters_same_sr(
    app, dist_interview, dist_recruiter, dist_recruiter2, dist_sr_recruiter, dist_m_recruiter, dist_jd
):
    """Two recruiters under same SR → SR appears only once (dedup)."""
    _assign_recruiter(app, dist_jd.id, dist_recruiter.id)
    _assign_recruiter(app, dist_jd.id, dist_recruiter2.id)

    with app.app_context():
        from app.services.report_distributor import _resolve_recipients
        to_emails, cc_email = _resolve_recipients(dist_jd.id)

    # SR should appear exactly once
    assert to_emails.count(dist_sr_recruiter.email.lower()) == 1


def test_client_contact_email_is_cc(app, dist_interview, dist_jd, dist_client_entity):
    with app.app_context():
        from app.services.report_distributor import _resolve_recipients
        _, cc_email = _resolve_recipients(dist_jd.id)

    assert cc_email == dist_client_entity.contact_email.lower()


def test_no_recruiter_assignments_falls_back_to_m_recruiter(
    app, dist_interview, dist_m_recruiter, dist_jd
):
    """No jd_recruiter_assignments → falls back to active M_RECRUITERs in client."""
    with app.app_context():
        from app.services.report_distributor import _resolve_recipients
        to_emails, _ = _resolve_recipients(dist_jd.id)
    # M_RECRUITER should be included via fallback
    assert dist_m_recruiter.email.lower() in to_emails


# ---------------------------------------------------------------------------
# distribute_report() — SendGrid failure is silent
# ---------------------------------------------------------------------------

def test_distribute_report_sendgrid_failure_silent(app, dist_interview):
    """SendGrid failure → distribute_report returns success=False but does NOT raise."""
    with app.app_context():
        from app.services.report_distributor import distribute_report
        with patch("app.services.report_distributor._send_report_email", return_value=False):
            result = distribute_report(dist_interview.id, qc_user_id=1)

    assert result["success"] is False
    assert "error" in result


def test_distribute_report_sets_distribution_triggered_on_failure(app, dist_interview):
    """distribution_triggered=True even when SendGrid fails."""
    with app.app_context():
        from app.services.report_distributor import distribute_report
        with patch("app.services.report_distributor._send_report_email", return_value=False):
            distribute_report(dist_interview.id, qc_user_id=1)

    with app.app_context():
        import sqlalchemy as sa
        row = db.session.execute(
            sa.text(
                "SELECT distribution_triggered FROM feedback_validations WHERE interview_id = :iid LIMIT 1"
            ),
            {"iid": dist_interview.id},
        ).mappings().first()

    assert row is not None
    assert bool(row["distribution_triggered"]) is True


def test_distribute_report_success_updates_ai_score(app, dist_interview):
    """Successful send → ai_interview_scores.report_distributed=True."""
    with app.app_context():
        from app.services.report_distributor import distribute_report
        with patch("app.services.report_distributor._send_report_email", return_value=True):
            result = distribute_report(dist_interview.id, qc_user_id=1)

    assert result["success"] is True

    with app.app_context():
        import sqlalchemy as sa
        row = db.session.execute(
            sa.text(
                "SELECT report_distributed FROM ai_interview_scores WHERE interview_id = :iid LIMIT 1"
            ),
            {"iid": dist_interview.id},
        ).mappings().first()

    assert row is not None
    assert bool(row["report_distributed"]) is True


# ---------------------------------------------------------------------------
# PUT /api/qc/interviews/<id>/review — distribution integration
# ---------------------------------------------------------------------------

def test_approve_triggers_distribution(app, client, qc_user, sample_reviewable_interview):
    """approved=True on PUT /review → distribute_report called."""
    headers = auth_headers(app, qc_user)
    with patch("app.blueprints.qc.distribute_report") as mock_dist:
        mock_dist.return_value = {"success": True, "emails_sent": ["a@b.com"], "cc_email": None}
        resp = client.put(
            f"/api/qc/interviews/{sample_reviewable_interview.id}/review",
            json={"final_recommendation": "HIRE", "qc_notes": "Good.", "approved": True},
            headers=headers,
        )
    assert resp.status_code == 200
    mock_dist.assert_called_once()


def test_not_approved_does_not_trigger_distribution(app, client, qc_user, sample_reviewable_interview):
    """approved=False → distribute_report NOT called."""
    headers = auth_headers(app, qc_user)
    with patch("app.blueprints.qc.distribute_report") as mock_dist:
        client.put(
            f"/api/qc/interviews/{sample_reviewable_interview.id}/review",
            json={"final_recommendation": "MAYBE", "approved": False},
            headers=headers,
        )
    mock_dist.assert_not_called()


def test_distribution_failure_does_not_affect_200(app, client, qc_user, sample_reviewable_interview):
    """distribute_report raises → PUT /review still returns 200."""
    headers = auth_headers(app, qc_user)
    with patch("app.blueprints.qc.distribute_report", side_effect=RuntimeError("SendGrid down")):
        resp = client.put(
            f"/api/qc/interviews/{sample_reviewable_interview.id}/review",
            json={"final_recommendation": "HIRE", "approved": True},
            headers=headers,
        )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# POST /api/qc/interviews/<id>/distribute
# ---------------------------------------------------------------------------

def test_manual_distribute_forbidden_for_recruiter(app, client, recruiter_user, dist_interview):
    headers = auth_headers(app, recruiter_user)
    resp = client.post(f"/api/qc/interviews/{dist_interview.id}/distribute", headers=headers)
    assert resp.status_code == 403


def test_manual_distribute_not_found(app, client, qc_user):
    headers = auth_headers(app, qc_user)
    resp = client.post("/api/qc/interviews/99999/distribute", headers=headers)
    assert resp.status_code == 404


def test_manual_distribute_rejected_when_not_approved(app, client, qc_user, dist_interview_unapproved):
    headers = auth_headers(app, qc_user)
    resp = client.post(
        f"/api/qc/interviews/{dist_interview_unapproved.id}/distribute",
        headers=headers,
    )
    assert resp.status_code == 400
    assert "approval" in resp.get_json()["error"].lower()


def test_manual_distribute_success(app, client, qc_user, dist_interview):
    headers = auth_headers(app, qc_user)
    with patch("app.blueprints.qc.distribute_report") as mock_dist:
        mock_dist.return_value = {
            "success": True,
            "emails_sent": ["sr_rec@dist.com", "m_rec_boss@dist.com"],
            "cc_email": "contact@distclient.com",
        }
        resp = client.post(
            f"/api/qc/interviews/{dist_interview.id}/distribute",
            headers=headers,
        )
    assert resp.status_code == 200
    data = resp.get_json()
    assert "emails_sent" in data
    assert len(data["emails_sent"]) > 0


def test_manual_distribute_resend_second_time(app, client, qc_user, dist_interview):
    """Second call to /distribute still sends and updates distributed_at."""
    headers = auth_headers(app, qc_user)
    with patch("app.blueprints.qc.distribute_report") as mock_dist:
        mock_dist.return_value = {
            "success": True, "emails_sent": ["x@y.com"], "cc_email": None
        }
        resp1 = client.post(f"/api/qc/interviews/{dist_interview.id}/distribute", headers=headers)
        resp2 = client.post(f"/api/qc/interviews/{dist_interview.id}/distribute", headers=headers)

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert mock_dist.call_count == 2


# ---------------------------------------------------------------------------
# GET /api/qc/interviews — extended fields
# ---------------------------------------------------------------------------

def test_qc_list_has_extended_fields(app, client, qc_user, sample_reviewable_interview):
    headers = auth_headers(app, qc_user)
    resp = client.get("/api/qc/interviews", headers=headers)
    assert resp.status_code == 200
    interviews = resp.get_json()["interviews"]
    assert isinstance(interviews, list)
    if interviews:
        first = interviews[0]
        # All new fields must be present
        for field in ("ai_score_status", "overall_score", "ai_recommendation",
                      "panelist_count", "feedback_count", "transcript_available",
                      "report_distributed"):
            assert field in first, f"Missing field: {field}"


def test_qc_list_ai_score_status_null_for_no_score(app, client, qc_user, sample_reviewable_interview):
    """sample_reviewable_interview has report_status=GENERATED — check it comes through."""
    headers = auth_headers(app, qc_user)
    resp = client.get("/api/qc/interviews", headers=headers)
    assert resp.status_code == 200
    interviews = resp.get_json()["interviews"]
    if interviews:
        statuses = {i["ai_score_status"] for i in interviews}
        assert "GENERATED" in statuses


def test_qc_dashboard_returns_summary(app, client, qc_user, sample_reviewable_interview):
    headers = auth_headers(app, qc_user)
    resp = client.get("/api/qc/dashboard", headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()
    assert "pending_reviews" in data
    assert "recommendation_counts" in data
