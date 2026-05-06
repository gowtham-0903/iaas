"""
Tests for /api/jds:
- CRUD, status transitions, job_code format, skill management
"""

import re
from unittest.mock import patch

import pytest

from app.extensions import db
from app.models.jd_skill import JDSkill
from app.models.job_description import JobDescription
from tests.conftest import auth_headers


JD_CODE_PATTERN = re.compile(r"^JD-\d{4}-\d{4}$")


# ---------------------------------------------------------------------------
# POST /api/jds
# ---------------------------------------------------------------------------

def test_create_jd_admin(app, client, admin_user, sample_client):
    headers = auth_headers(app, admin_user)
    resp = client.post(
        "/api/jds",
        json={
            "client_id": sample_client.id,
            "title": "Backend Engineer",
            "raw_text": "Looking for a backend engineer with Python skills.",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    data = resp.get_json()
    assert data["title"] == "Backend Engineer"
    assert data.get("status") == "DRAFT"


def test_create_jd_assigns_job_code(app, client, admin_user, sample_client):
    headers = auth_headers(app, admin_user)
    resp = client.post(
        "/api/jds",
        json={"client_id": sample_client.id, "title": "DevOps Lead"},
        headers=headers,
    )
    assert resp.status_code == 201
    job_code = resp.get_json().get("job_code", "")
    assert JD_CODE_PATTERN.match(job_code), f"Unexpected job_code format: {job_code}"


def test_create_jd_recruiter_forbidden(app, client, recruiter_user, sample_client):
    """RECRUITER must not create JDs."""
    headers = auth_headers(app, recruiter_user)
    resp = client.post(
        "/api/jds",
        json={"client_id": sample_client.id, "title": "Test JD"},
        headers=headers,
    )
    assert resp.status_code == 403


def test_create_jd_missing_title(app, client, admin_user, sample_client):
    headers = auth_headers(app, admin_user)
    resp = client.post(
        "/api/jds",
        json={"client_id": sample_client.id},
        headers=headers,
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/jds
# ---------------------------------------------------------------------------

def test_list_jds_admin(app, client, admin_user, sample_jd):
    headers = auth_headers(app, admin_user)
    resp = client.get("/api/jds", headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()
    jds = data if isinstance(data, list) else data.get("jds", [])
    assert any(j["title"] == "Senior Python Developer" for j in jds)


def test_list_jds_unauthenticated(client):
    resp = client.get("/api/jds")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/jds/<jd_id>
# ---------------------------------------------------------------------------

def test_get_jd_by_id(app, client, admin_user, sample_jd):
    headers = auth_headers(app, admin_user)
    resp = client.get(f"/api/jds/{sample_jd.id}", headers=headers)
    assert resp.status_code == 200
    assert resp.get_json()["title"] == "Senior Python Developer"


def test_get_jd_not_found(app, client, admin_user):
    headers = auth_headers(app, admin_user)
    resp = client.get("/api/jds/99999", headers=headers)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PUT /api/jds/<jd_id>/status
# ---------------------------------------------------------------------------

def test_update_jd_status_draft_to_active(app, client, admin_user, sample_client):
    with app.app_context():
        jd = JobDescription(
            client_id=sample_client.id,
            title="Draft JD",
            status="DRAFT",
            created_by=admin_user.id,
        )
        db.session.add(jd)
        db.session.commit()
        jd_id = jd.id

    headers = auth_headers(app, admin_user)
    resp = client.put(f"/api/jds/{jd_id}/status", json={"status": "ACTIVE"}, headers=headers)
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ACTIVE"


def test_update_jd_status_invalid(app, client, admin_user, sample_jd):
    headers = auth_headers(app, admin_user)
    resp = client.put(
        f"/api/jds/{sample_jd.id}/status",
        json={"status": "PUBLISHED"},
        headers=headers,
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Skill management: POST/PUT/DELETE /api/jds/<jd_id>/skills
# ---------------------------------------------------------------------------

def test_list_jd_skills(app, client, admin_user, sample_jd, sample_jd_skills):
    headers = auth_headers(app, admin_user)
    resp = client.get(f"/api/jds/{sample_jd.id}/skills", headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()
    skills = data if isinstance(data, list) else data.get("skills", [])
    assert len(skills) == 3


def test_add_skill_to_jd(app, client, admin_user, sample_jd):
    headers = auth_headers(app, admin_user)
    resp = client.post(
        f"/api/jds/{sample_jd.id}/skills",
        json={"skill_name": "Docker", "skill_type": "secondary", "subtopics": ["Compose"]},
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.get_json()["skill_name"] == "Docker"


def test_add_skill_missing_name(app, client, admin_user, sample_jd):
    headers = auth_headers(app, admin_user)
    resp = client.post(
        f"/api/jds/{sample_jd.id}/skills",
        json={"skill_type": "primary"},
        headers=headers,
    )
    assert resp.status_code == 400


def test_update_skill(app, client, admin_user, sample_jd, sample_jd_skills):
    skill = sample_jd_skills[0]
    headers = auth_headers(app, admin_user)
    resp = client.put(
        f"/api/jds/{sample_jd.id}/skills/{skill.id}",
        json={"skill_name": "Python Advanced"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.get_json()["skill_name"] == "Python Advanced"


def test_delete_skill(app, client, admin_user, sample_jd, sample_jd_skills):
    skill = sample_jd_skills[0]
    headers = auth_headers(app, admin_user)
    resp = client.delete(f"/api/jds/{sample_jd.id}/skills/{skill.id}", headers=headers)
    assert resp.status_code in (200, 204)


# ---------------------------------------------------------------------------
# AI extraction (mocked to avoid OpenAI calls)
# ---------------------------------------------------------------------------

@patch("app.blueprints.job_descriptions.OpenAI")
def test_extract_skills_calls_ai(mock_openai_cls, app, client, admin_user, sample_client):
    mock_client = mock_openai_cls.return_value
    mock_client.chat.completions.create.return_value.choices = [
        type("Choice", (), {
            "message": type("Message", (), {
                "content": '{"primary_skills":[{"skill_name":"Python","subtopics":["Flask"]}],"secondary_skills":[],"soft_skills":[]}'
            })()
        })()
    ]

    with app.app_context():
        jd = JobDescription(
            client_id=sample_client.id,
            title="AI Test JD",
            raw_text="Looking for a Python expert.",
            status="ACTIVE",
            created_by=admin_user.id,
        )
        db.session.add(jd)
        db.session.commit()
        jd_id = jd.id

    headers = auth_headers(app, admin_user)
    resp = client.post(f"/api/jds/{jd_id}/extract-skills", headers=headers)
    assert resp.status_code in (200, 201)
