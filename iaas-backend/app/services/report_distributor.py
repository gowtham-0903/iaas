"""report_distributor.py — M4 Phase 3 QC report distribution service.

Resolves the full recruiter hierarchy for a JD, builds a rich HTML email,
and sends it via SendGrid with the client contact as CC.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import sqlalchemy as sa

from app.extensions import db

logger = logging.getLogger(__name__)

_APP_BASE_URL = os.getenv("APP_BASE_URL", "https://testiaas.meedenlabs.com")

# Roles we stop walking at (do not include ADMIN in the chain — stop before)
_STOP_ROLES = {"ADMIN"}
# Recruiter-family roles that receive the report
_RECRUITER_ROLES = {"RECRUITER", "SR_RECRUITER", "M_RECRUITER"}


# ---------------------------------------------------------------------------
# Recipient resolution
# ---------------------------------------------------------------------------

def _resolve_recipients(jd_id: int) -> Tuple[List[str], Optional[str]]:
    """Return (to_emails, cc_email).

    to_emails: deduplicated recruiter hierarchy emails (RECRUITER → SR → M_RECRUITER)
    cc_email:  client.contact_email (or None)
    """
    # Get JD → client info
    jd_row = db.session.execute(
        sa.text(
            """
            SELECT j.id, j.client_id, cl.contact_email AS client_contact_email
            FROM job_descriptions j
            JOIN clients cl ON cl.id = j.client_id
            WHERE j.id = :jd_id LIMIT 1
            """
        ),
        {"jd_id": jd_id},
    ).mappings().first()

    cc_email: Optional[str] = None
    if jd_row and jd_row["client_contact_email"]:
        cc_email = jd_row["client_contact_email"].strip().lower() or None

    # Fetch all recruiters assigned to this JD
    recruiter_rows = db.session.execute(
        sa.text(
            """
            SELECT DISTINCT ra.recruiter_id
            FROM jd_recruiter_assignments ra
            WHERE ra.jd_id = :jd_id
            """
        ),
        {"jd_id": jd_id},
    ).mappings().all()

    collected_user_ids: set = set()

    # Walk the reports_to chain upward for each recruiter
    for row in recruiter_rows:
        user_id = row["recruiter_id"]
        depth = 0
        while user_id is not None and depth < 10:
            user_row = db.session.execute(
                sa.text(
                    "SELECT id, email, role, reports_to FROM users WHERE id = :uid AND is_active = 1 LIMIT 1"
                ),
                {"uid": user_id},
            ).mappings().first()

            if user_row is None:
                break

            role = user_row["role"]
            if role in _STOP_ROLES:
                break
            if role in _RECRUITER_ROLES:
                collected_user_ids.add(user_row["id"])

            reports_to = user_row["reports_to"]
            if reports_to is None:
                break
            user_id = reports_to
            depth += 1

    # If no recruiters assigned, fall back to all active M_RECRUITERs in the client
    if not collected_user_ids and jd_row:
        fallback_rows = db.session.execute(
            sa.text(
                """
                SELECT id FROM users
                WHERE role = 'M_RECRUITER'
                  AND client_id = :client_id
                  AND is_active = 1
                """
            ),
            {"client_id": jd_row["client_id"]},
        ).mappings().all()
        collected_user_ids = {r["id"] for r in fallback_rows}

    # Fetch emails
    if not collected_user_ids:
        return [], cc_email

    email_rows = db.session.execute(
        sa.text(
            "SELECT email FROM users WHERE id IN :uids AND is_active = 1"
        ).bindparams(sa.bindparam("uids", expanding=True)),
        {"uids": list(collected_user_ids)},
    ).mappings().all()

    to_emails = sorted({r["email"].strip().lower() for r in email_rows if r["email"]})
    return to_emails, cc_email


# ---------------------------------------------------------------------------
# Email HTML builder
# ---------------------------------------------------------------------------

def _badge_style(recommendation: str) -> Tuple[str, str]:
    """Return (background_color, label) for the recommendation badge."""
    mapping = {
        "STRONG_HIRE": ("#16a34a", "Strong Hire ✓"),
        "HIRE":        ("#2563eb", "Hire ✓"),
        "MAYBE":       ("#d97706", "Maybe"),
        "NO_HIRE":     ("#dc2626", "No Hire ✗"),
    }
    return mapping.get(recommendation, ("#6b7280", recommendation))


def _build_report_email_html(
    candidate_name: str,
    jd_title: str,
    jd_job_code: str,
    client_name: str,
    interview_date: str,
    overall_score: Optional[float],
    recommendation: str,
    strengths: List[str],
    concerns: List[str],
    interview_id: int,
) -> str:
    badge_color, badge_label = _badge_style(recommendation)
    score_display = f"{overall_score:.1f}/100" if overall_score is not None else "N/A"
    report_url = f"{_APP_BASE_URL}/report/{interview_id}"

    strengths_html = "".join(
        f"<li style='margin:0 0 6px 0;color:#374151;font-size:13px;'>{s}</li>"
        for s in (strengths or [])[:3]
    ) or "<li style='color:#9ca3af;font-size:13px;'>No strengths recorded</li>"

    concerns_html = "".join(
        f"<li style='margin:0 0 6px 0;color:#374151;font-size:13px;'>{c}</li>"
        for c in (concerns or [])[:2]
    ) or "<li style='color:#9ca3af;font-size:13px;'>No concerns recorded</li>"

    return (
        "<!DOCTYPE html>"
        "<html lang='en'><head><meta charset='UTF-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1.0'></head>"
        "<body style='margin:0;padding:0;background-color:#f3f4f6;"
        "font-family:Arial,Helvetica,sans-serif;'>"
        "<table width='100%' cellpadding='0' cellspacing='0'"
        " style='background-color:#f3f4f6;padding:32px 16px;'><tr><td align='center'>"
        "<table width='600' cellpadding='0' cellspacing='0'"
        " style='background:#ffffff;border-radius:8px;"
        "box-shadow:0 2px 8px rgba(0,0,0,0.07);overflow:hidden;max-width:600px;'>"

        # Header
        "<tr><td style='background:#1e3a5f;padding:28px 36px;'>"
        "<p style='margin:0;color:#ffffff;font-size:11px;font-weight:600;"
        "letter-spacing:1px;text-transform:uppercase;opacity:0.85;'>"
        "IAAS — Interview Report</p>"
        f"<h1 style='margin:6px 0 0 0;color:#ffffff;font-size:20px;font-weight:700;line-height:1.3;'>"
        f"Interview Report Ready — {jd_title}</h1>"
        "</td></tr>"

        # Body
        "<tr><td style='padding:32px 36px 0 36px;'>"
        "<table width='100%' cellpadding='0' cellspacing='0'>"

        # Candidate info card
        "<tr><td style='padding:0 0 24px 0;'>"
        "<table width='100%' cellpadding='0' cellspacing='0'"
        " style='background:#f0f7ff;border-left:4px solid #1e3a5f;border-radius:4px;padding:18px 20px;'>"
        "<tr><td>"
        "<p style='margin:0 0 12px 0;font-size:12px;font-weight:700;color:#1e3a5f;"
        "text-transform:uppercase;letter-spacing:0.5px;'>Candidate Details</p>"
        "<table cellpadding='0' cellspacing='0'>"
        "<tr>"
        "<td style='font-size:13px;color:#6b7280;padding:3px 16px 3px 0;min-width:110px;'>Candidate</td>"
        f"<td style='font-size:13px;color:#1a1a1a;font-weight:600;'>{candidate_name}</td>"
        "</tr><tr>"
        "<td style='font-size:13px;color:#6b7280;padding:3px 16px 3px 0;'>Position</td>"
        f"<td style='font-size:13px;color:#1a1a1a;font-weight:600;'>{jd_title}</td>"
        "</tr><tr>"
        "<td style='font-size:13px;color:#6b7280;padding:3px 16px 3px 0;'>Job Code</td>"
        f"<td style='font-size:13px;color:#1a1a1a;font-weight:600;'>{jd_job_code}</td>"
        "</tr><tr>"
        "<td style='font-size:13px;color:#6b7280;padding:3px 16px 3px 0;'>Client</td>"
        f"<td style='font-size:13px;color:#1a1a1a;font-weight:600;'>{client_name}</td>"
        "</tr><tr>"
        "<td style='font-size:13px;color:#6b7280;padding:3px 16px 3px 0;'>Interview Date</td>"
        f"<td style='font-size:13px;color:#1a1a1a;font-weight:600;'>{interview_date}</td>"
        "</tr>"
        "</table>"
        "</td></tr></table>"
        "</td></tr>"

        # Score + recommendation row
        "<tr><td style='padding:0 0 24px 0;'>"
        "<table width='100%' cellpadding='0' cellspacing='0'><tr>"
        # Score box
        "<td style='width:50%;padding-right:8px;'>"
        "<table width='100%' cellpadding='0' cellspacing='0'"
        " style='background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:16px;text-align:center;'>"
        "<tr><td>"
        "<p style='margin:0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;'>Overall Score</p>"
        f"<p style='margin:6px 0 0 0;font-size:28px;font-weight:700;color:#1a1a1a;'>{score_display}</p>"
        "</td></tr></table>"
        "</td>"
        # Recommendation badge
        "<td style='width:50%;padding-left:8px;'>"
        "<table width='100%' cellpadding='0' cellspacing='0'"
        f" style='background:{badge_color};border-radius:6px;padding:16px;text-align:center;'>"
        "<tr><td>"
        "<p style='margin:0;font-size:11px;color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:0.5px;'>Recommendation</p>"
        f"<p style='margin:6px 0 0 0;font-size:18px;font-weight:700;color:#ffffff;'>{badge_label}</p>"
        "</td></tr></table>"
        "</td>"
        "</tr></table>"
        "</td></tr>"

        # Strengths
        "<tr><td style='padding:0 0 20px 0;'>"
        "<p style='font-size:14px;font-weight:700;color:#1a1a1a;margin:0 0 8px 0;'>Key Strengths</p>"
        f"<ul style='margin:0;padding-left:20px;'>{strengths_html}</ul>"
        "</td></tr>"

        # Concerns
        "<tr><td style='padding:0 0 24px 0;'>"
        "<p style='font-size:14px;font-weight:700;color:#1a1a1a;margin:0 0 8px 0;'>Concerns</p>"
        f"<ul style='margin:0;padding-left:20px;'>{concerns_html}</ul>"
        "</td></tr>"

        # CTA
        "<tr><td style='padding:0 0 32px 0;'>"
        f"<a href='{report_url}' style='display:inline-block;background:#1e3a5f;color:#ffffff;"
        "text-decoration:none;font-size:13px;font-weight:600;padding:12px 28px;border-radius:6px;'>"
        "View Full Report →</a>"
        "</td></tr>"

        "</table>"  # inner table
        "</td></tr>"  # body row

        # Footer
        "<tr><td style='background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 36px;'>"
        "<p style='margin:0;font-size:12px;color:#6b7280;line-height:1.8;'>"
        "This report has been reviewed and approved by QC. "
        "Log in to IAAS to view the complete assessment.<br>"
        "<strong>MeedenLabs — IAAS Platform</strong>"
        "</p>"
        "</td></tr>"

        "</table>"  # card
        "</td></tr></table>"  # wrapper
        "</body></html>"
    )


# ---------------------------------------------------------------------------
# SendGrid multi-recipient send
# ---------------------------------------------------------------------------

def _send_report_email(
    to_emails: List[str],
    cc_email: Optional[str],
    subject: str,
    html_content: str,
) -> bool:
    """Send HTML email to multiple TO recipients with optional CC via SendGrid."""
    from sendgrid import SendGridAPIClient
    from sendgrid.helpers.mail import Mail, To, Cc

    api_key = os.getenv("SENDGRID_API_KEY", "").strip()
    from_email = os.getenv("SENDGRID_FROM_EMAIL", "").strip()

    if not api_key or not api_key.startswith("SG."):
        logger.error("distribute_report: SENDGRID_API_KEY not configured")
        return False
    if not from_email:
        logger.error("distribute_report: SENDGRID_FROM_EMAIL not configured")
        return False
    if not to_emails:
        logger.warning("distribute_report: no recipients resolved — email not sent")
        return False

    valid_to = [e for e in to_emails if "@" in e]
    if not valid_to:
        logger.warning("distribute_report: all recipient emails invalid")
        return False

    try:
        message = Mail(
            from_email=from_email,
            subject=subject,
            html_content=html_content,
        )
        for email in valid_to:
            message.to = To(email)
        if cc_email and "@" in cc_email:
            message.cc = Cc(cc_email)

        response = SendGridAPIClient(api_key).send(message)
        status = int(response.status_code)
        if 200 <= status < 300:
            logger.info("distribute_report: SendGrid OK %d → %s", status, valid_to)
            return True
        logger.error("distribute_report: SendGrid %d | body: %s", status, response.body)
        return False
    except Exception as exc:
        body = getattr(exc, "body", b"")
        logger.error("distribute_report: SendGrid error: %s | body: %s", exc, body)
        return False


# ---------------------------------------------------------------------------
# Main distribute_report function
# ---------------------------------------------------------------------------

def distribute_report(interview_id: int, qc_user_id: int) -> Dict:
    """Resolve recipients, send report email, update DB tracking columns.

    Returns a dict with:
        success: bool
        emails_sent: list of TO emails
        cc_email: str or None
        error: str (only on failure)
    """
    # Gather interview + candidate + JD + client + ai_score
    row = db.session.execute(
        sa.text(
            """
            SELECT
                s.id AS interview_id,
                s.scheduled_at,
                s.jd_id,
                c.full_name AS candidate_name,
                j.title AS jd_title,
                j.job_code,
                cl.name AS client_name,
                cl.contact_email AS client_contact_email,
                ai.id AS ai_score_id,
                ai.overall_score,
                ai.recommendation,
                ai.strengths,
                ai.concerns,
                fv.id AS fv_id
            FROM interview_schedules s
            JOIN candidates c ON c.id = s.candidate_id
            JOIN job_descriptions j ON j.id = s.jd_id
            JOIN clients cl ON cl.id = c.client_id
            LEFT JOIN ai_interview_scores ai ON ai.interview_id = s.id
            LEFT JOIN feedback_validations fv ON fv.interview_id = s.id
            WHERE s.id = :iid LIMIT 1
            """
        ),
        {"iid": interview_id},
    ).mappings().first()

    if not row:
        return {"success": False, "error": "Interview not found", "emails_sent": [], "cc_email": None}

    # Resolve recipients
    to_emails, cc_email = _resolve_recipients(row["jd_id"])

    # Build email
    overall_score = float(row["overall_score"]) if row["overall_score"] is not None else None
    recommendation = row["recommendation"] or "N/A"

    import json as _json

    def _parse(val):
        if val is None:
            return []
        if isinstance(val, list):
            return val
        try:
            return _json.loads(val)
        except Exception:
            return []

    strengths = _parse(row["strengths"])
    concerns = _parse(row["concerns"])

    scheduled_at = row["scheduled_at"]
    if hasattr(scheduled_at, "strftime"):
        interview_date = scheduled_at.strftime("%B %d, %Y")
    else:
        interview_date = str(scheduled_at) if scheduled_at else "N/A"

    subject = (
        f"Interview Report Ready — {row['candidate_name']} "
        f"| {row['jd_title']} | {row['job_code']}"
    )

    html = _build_report_email_html(
        candidate_name=row["candidate_name"],
        jd_title=row["jd_title"],
        jd_job_code=row["job_code"],
        client_name=row["client_name"],
        interview_date=interview_date,
        overall_score=overall_score,
        recommendation=recommendation,
        strengths=strengths,
        concerns=concerns,
        interview_id=interview_id,
    )

    # Send
    send_ok = _send_report_email(
        to_emails=to_emails,
        cc_email=cc_email,
        subject=subject,
        html_content=html,
    )

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    all_emails = to_emails + ([cc_email] if cc_email else [])

    # Update feedback_validations tracking — always set distribution_triggered=True
    try:
        if row["fv_id"]:
            db.session.execute(
                sa.text(
                    """
                    UPDATE feedback_validations
                    SET distribution_triggered = 1,
                        distributed_at = :now,
                        distributed_to = :emails
                    WHERE id = :fv_id
                    """
                ),
                {
                    "now": now,
                    "emails": _json.dumps(all_emails),
                    "fv_id": row["fv_id"],
                },
            )

        # Update ai_interview_scores if email send succeeded
        if send_ok and row["ai_score_id"]:
            db.session.execute(
                sa.text(
                    """
                    UPDATE ai_interview_scores
                    SET report_distributed = 1, distributed_at = :now
                    WHERE id = :aid
                    """
                ),
                {"now": now, "aid": row["ai_score_id"]},
            )

        db.session.commit()
    except Exception:
        logger.exception("distribute_report: DB update failed for interview %s", interview_id)
        db.session.rollback()

    if send_ok:
        return {
            "success": True,
            "emails_sent": to_emails,
            "cc_email": cc_email,
        }
    else:
        return {
            "success": False,
            "error": "SendGrid delivery failed — distribution_triggered set, check logs",
            "emails_sent": [],
            "cc_email": cc_email,
        }
