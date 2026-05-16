"""
Shared pytest fixtures for the IAAS backend test suite.

Strategy:
- Single session-scoped Flask app + SQLite in-memory database.
- All tables are created once at session start and dropped at session end.
- An autouse function-scoped `clean_db` fixture truncates every table after
  each test so tests are fully isolated without the cost of recreating the schema.
- JWT uses header-based tokens (Authorization: Bearer <token>) so tests never
  need to manage cookies or CSRF tokens.
- Rate limiting is disabled so tests never hit 429 errors.
- External services (Teams, SendGrid, OpenAI) must be mocked per test via
  unittest.mock.patch.
"""

from datetime import datetime, timedelta, timezone

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy.pool import StaticPool

from app import create_app
from app.extensions import db as _db
from app.models.candidate import Candidate
from app.models.client import Client
from app.models.feedback_validation import FeedbackValidation
from app.models.interview_schedule import InterviewSchedule, PanelAssignment
from app.models.panelist import Panelist
from app.models.interview_scoring import AIInterviewScore, InterviewScore, InterviewTranscript
from app.models.jd_panelist_assignment import JDPanelistAssignment
from app.models.jd_recruiter_assignment import JDRecruiterAssignment
from app.models.jd_skill import JDSkill
from app.models.job_description import JobDescription
from app.models.operator_client_assignment import OperatorClientAssignment
from app.models.revoked_token import RevokedToken
from app.models.user import User, UserRole


# ---------------------------------------------------------------------------
# Test configuration — completely independent of the production Config class
# ---------------------------------------------------------------------------

class TestingConfig:
    TESTING = True
    PROPAGATE_EXCEPTIONS = True
    # SQLite in-memory with StaticPool ensures all connections share the same DB
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "connect_args": {"check_same_thread": False},
        "poolclass": StaticPool,
    }
    SQLALCHEMY_EXPIRE_ON_COMMIT = False
    JWT_SECRET_KEY = "test-secret-key-pytest-only"
    # Use headers instead of cookies — simpler for test clients
    JWT_TOKEN_LOCATION = ["headers"]
    JWT_HEADER_NAME = "Authorization"
    JWT_HEADER_TYPE = "Bearer"
    JWT_COOKIE_SECURE = False
    JWT_COOKIE_CSRF_PROTECT = False
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=15)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=7)
    JWT_ACCESS_CSRF_HEADER_NAME = "X-CSRF-TOKEN"
    JWT_REFRESH_CSRF_HEADER_NAME = "X-CSRF-TOKEN"
    CORS_ORIGINS = ["http://localhost:5173"]
    OPENAI_API_KEY = "test-openai-key"
    # Disable Flask-Limiter so tests never get 429s
    RATELIMIT_ENABLED = False
    RATELIMIT_STORAGE_URI = "memory://"
    ENV = "testing"


# ---------------------------------------------------------------------------
# Session-scoped app + database
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def app():
    application = create_app(TestingConfig)
    with application.app_context():
        _db.create_all()
        yield application
        _db.drop_all()


@pytest.fixture(scope="function")
def client(app):
    with app.test_client() as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# Clean slate between tests
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def clean_db(app):
    """Truncate all tables after every test to ensure isolation."""
    yield
    with app.app_context():
        _db.session.rollback()
        for table in reversed(_db.metadata.sorted_tables):
            _db.session.execute(table.delete())
        _db.session.commit()


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def auth_headers(app, user):
    """Return Authorization headers for the given User object."""
    with app.app_context():
        token = create_access_token(
            identity=str(user.id),
            additional_claims={"role": user.role, "client_id": user.client_id},
        )
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Entity fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_client(app):
    with app.app_context():
        entity = Client(
            name="Acme Corp",
            industry="Technology",
            contact_email="contact@acme.com",
        )
        _db.session.add(entity)
        _db.session.commit()
        _db.session.refresh(entity)
        return entity


@pytest.fixture
def admin_user(app):
    with app.app_context():
        user = User(full_name="Admin User", email="admin@test.com", role=UserRole.ADMIN.value)
        user.set_password("Admin@1234")
        _db.session.add(user)
        _db.session.commit()
        _db.session.refresh(user)
        return user


@pytest.fixture
def m_recruiter_user(app, sample_client):
    with app.app_context():
        user = User(
            full_name="M Recruiter",
            email="m_recruiter@test.com",
            role=UserRole.M_RECRUITER.value,
            client_id=sample_client.id,
        )
        user.set_password("Test@1234")
        _db.session.add(user)
        _db.session.commit()
        _db.session.refresh(user)
        return user


@pytest.fixture
def sr_recruiter_user(app, sample_client):
    with app.app_context():
        user = User(
            full_name="SR Recruiter",
            email="sr_recruiter@test.com",
            role=UserRole.SR_RECRUITER.value,
            client_id=sample_client.id,
        )
        user.set_password("Test@1234")
        _db.session.add(user)
        _db.session.commit()
        _db.session.refresh(user)
        return user


@pytest.fixture
def recruiter_user(app, sample_client):
    with app.app_context():
        user = User(
            full_name="Recruiter User",
            email="recruiter@test.com",
            role=UserRole.RECRUITER.value,
            client_id=sample_client.id,
        )
        user.set_password("Test@1234")
        _db.session.add(user)
        _db.session.commit()
        _db.session.refresh(user)
        return user


@pytest.fixture
def panelist_user(app, sample_client):
    with app.app_context():
        user = User(
            full_name="Panelist User",
            email="panelist@test.com",
            role=UserRole.PANELIST.value,
            client_id=sample_client.id,
        )
        user.set_password("Test@1234")
        _db.session.add(user)
        _db.session.commit()
        _db.session.refresh(user)
        return user


@pytest.fixture
def qc_user(app):
    with app.app_context():
        user = User(full_name="QC User", email="qc@test.com", role=UserRole.QC.value)
        user.set_password("Test@1234")
        _db.session.add(user)
        _db.session.commit()
        _db.session.refresh(user)
        return user


@pytest.fixture
def operator_user(app, sample_client):
    with app.app_context():
        user = User(
            full_name="Operator User",
            email="operator@test.com",
            role=UserRole.OPERATOR.value,
            client_id=sample_client.id,
        )
        user.set_password("Test@1234")
        _db.session.add(user)
        _db.session.commit()
        _db.session.refresh(user)
        return user


@pytest.fixture
def client_user(app, sample_client):
    with app.app_context():
        user = User(
            full_name="Client User",
            email="clientuser@test.com",
            role=UserRole.CLIENT.value,
            client_id=sample_client.id,
        )
        user.set_password("Test@1234")
        _db.session.add(user)
        _db.session.commit()
        _db.session.refresh(user)
        return user


@pytest.fixture
def sample_jd(app, sample_client, admin_user):
    with app.app_context():
        jd = JobDescription(
            client_id=sample_client.id,
            title="Senior Python Developer",
            job_code="JD-2026-0001",
            raw_text="We need a senior Python developer with 5+ years of Flask and SQLAlchemy experience.",
            status="ACTIVE",
            created_by=admin_user.id,
        )
        _db.session.add(jd)
        _db.session.commit()
        _db.session.refresh(jd)
        return jd


@pytest.fixture
def sample_jd_skills(app, sample_jd):
    with app.app_context():
        skills = [
            JDSkill(jd_id=sample_jd.id, skill_name="Python", skill_type="primary", subtopics=["Flask", "SQLAlchemy"]),
            JDSkill(jd_id=sample_jd.id, skill_name="REST APIs", skill_type="secondary", subtopics=[]),
            JDSkill(jd_id=sample_jd.id, skill_name="Communication", skill_type="soft", subtopics=[]),
        ]
        _db.session.add_all(skills)
        _db.session.commit()
        for s in skills:
            _db.session.refresh(s)
        return skills


@pytest.fixture
def sample_candidate(app, sample_client, sample_jd):
    with app.app_context():
        candidate = Candidate(
            client_id=sample_client.id,
            jd_id=sample_jd.id,
            full_name="Jane Doe",
            email="jane.doe@example.com",
            phone="+1234567890",
            status="APPLIED",
        )
        _db.session.add(candidate)
        _db.session.commit()
        _db.session.refresh(candidate)
        return candidate


@pytest.fixture
def sample_interview(app, sample_candidate, sample_jd, panelist_user):
    with app.app_context():
        interview = InterviewSchedule(
            candidate_id=sample_candidate.id,
            jd_id=sample_jd.id,
            scheduled_at=datetime(2026, 8, 1, 10, 0, 0),
            duration_minutes=60,
            mode="virtual",
            timezone="Asia/Kolkata",
            meeting_link="https://teams.microsoft.com/l/meetup-join/test-link",
            status="SCHEDULED",
        )
        _db.session.add(interview)
        _db.session.commit()
        _db.session.refresh(interview)

        assignment = PanelAssignment(
            interview_id=interview.id,
            panelist_id=panelist_user.id,
        )
        _db.session.add(assignment)
        _db.session.commit()
        _db.session.refresh(interview)
        return interview


@pytest.fixture
def panelist_entity(app, admin_user):
    """A Panelist model record (references panelists table, not users)."""
    with app.app_context():
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        p = Panelist(
            panel_id="PAN-TEST-001",
            name="Test Panelist",
            skill="Python",
            email="testpanelist@example.com",
            created_at=now,
            created_by=admin_user.id,
        )
        _db.session.add(p)
        _db.session.commit()
        _db.session.refresh(p)
        return p


@pytest.fixture
def feedback_interview(app, sample_candidate, sample_jd, panelist_entity):
    """An interview whose panel_assignment.panelist_id references the panelists table."""
    with app.app_context():
        interview = InterviewSchedule(
            candidate_id=sample_candidate.id,
            jd_id=sample_jd.id,
            scheduled_at=datetime(2026, 8, 1, 10, 0, 0),
            duration_minutes=60,
            mode="virtual",
            timezone="Asia/Kolkata",
            meeting_link="https://teams.microsoft.com/l/meetup-join/test-link",
            status="SCHEDULED",
        )
        _db.session.add(interview)
        _db.session.commit()
        _db.session.refresh(interview)

        assignment = PanelAssignment(
            interview_id=interview.id,
            panelist_id=panelist_entity.id,
        )
        _db.session.add(assignment)
        _db.session.commit()
        _db.session.refresh(interview)
        return interview


@pytest.fixture
def sample_reviewable_interview(app, sample_candidate, sample_jd, panelist_user, admin_user):
    """A COMPLETED interview with transcript and AI score — usable in QC tests."""
    with app.app_context():
        interview = InterviewSchedule(
            candidate_id=sample_candidate.id,
            jd_id=sample_jd.id,
            scheduled_at=datetime(2026, 8, 1, 10, 0, 0),
            duration_minutes=60,
            mode="virtual",
            timezone="Asia/Kolkata",
            meeting_link="https://teams.microsoft.com/test",
            status="COMPLETED",
        )
        _db.session.add(interview)
        _db.session.commit()

        assignment = PanelAssignment(interview_id=interview.id, panelist_id=panelist_user.id)
        _db.session.add(assignment)
        _db.session.commit()

        transcript = InterviewTranscript(
            interview_id=interview.id,
            uploaded_by=admin_user.id,
            raw_text="This is a sample transcript of the interview.",
            upload_type="text",
            uploaded_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        _db.session.add(transcript)
        _db.session.commit()

        ai_score = AIInterviewScore(
            interview_id=interview.id,
            transcript_id=transcript.id,
            overall_score=7.5,
            skill_scores=[],
            strengths=["Strong Python skills"],
            concerns=["Limited cloud experience"],
            recommendation="HIRE",
            report_status="GENERATED",
            generated_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        _db.session.add(ai_score)
        _db.session.commit()
        _db.session.refresh(interview)
        return interview
