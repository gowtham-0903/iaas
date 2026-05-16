import base64
import logging
import os
from datetime import datetime
from typing import Any, List, Optional

import pytz
from dotenv import load_dotenv
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import (
    Attachment,
    Disposition,
    FileContent,
    FileName,
    FileType,
    Mail,
)


load_dotenv()

logger = logging.getLogger(__name__)

# Root of the uploads directory — two levels up from this file (iaas-backend/uploads/)
_UPLOADS_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "uploads")
_ATTACH_MIME = {
    ".pdf":  "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc":  "application/msword",
}


def _build_attachment(file_url: str, display_name: str):
    """Read a local uploads/ file and return a SendGrid Attachment. Returns None on failure."""
    if not file_url:
        return None
    try:
        # file_url is stored as "uploads/resumes/..." relative to iaas-backend/
        if file_url.startswith("uploads/"):
            abs_path = os.path.join(os.path.dirname(_UPLOADS_ROOT), file_url)
        else:
            abs_path = file_url
        if not os.path.isfile(abs_path):
            logger.warning("Attachment file not found: %s", abs_path)
            return None
        if os.path.getsize(abs_path) > 5 * 1024 * 1024:
            logger.warning("Attachment too large, skipping: %s", abs_path)
            return None
        with open(abs_path, "rb") as fh:
            encoded = base64.b64encode(fh.read()).decode()
        ext = os.path.splitext(abs_path)[1].lower()
        mime = _ATTACH_MIME.get(ext, "application/octet-stream")
        att = Attachment()
        att.file_content = FileContent(encoded)
        att.file_name = FileName(display_name)
        att.file_type = FileType(mime)
        att.disposition = Disposition("attachment")
        return att
    except Exception:
        logger.warning("Could not build attachment for %s", file_url, exc_info=True)
        return None

_SKILL_TYPE_ORDER = {"primary": 0, "secondary": 1, "soft": 2}

_INTERVIEW_GUIDELINES = [
    "Laptop/Desktop is mandatory – Mobile devices are strictly not allowed.",
    "Video must be enabled throughout the interview.",
    "Valid Government-issued Photo ID must be shown at the start of the interview.",
    "Stable internet connection is mandatory to avoid interruptions.",
    "Clear camera and proper lighting; your face must be clearly visible.",
    "Noise-free environment with clear audio.",
    "All background applications must be closed (music, downloads, screen recording, chat apps).",
    "No external assistance, screen sharing tools, or reference materials are permitted unless instructed.",
    "Professional attire and neutral background are mandatory.",
    "Please join 10 minutes prior to the scheduled time.",
]


def _field(obj: Any, key: str, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _format_local_time(scheduled_at_raw: Any, tz_str: str) -> str:
    try:
        tz = pytz.timezone(tz_str or "America/New_York")
        if isinstance(scheduled_at_raw, str):
            dt = datetime.fromisoformat(scheduled_at_raw.replace("Z", "+00:00")).replace(tzinfo=None)
        else:
            dt = scheduled_at_raw
        if dt is None:
            return "TBD"
        utc_aware = pytz.utc.localize(dt)
        local = utc_aware.astimezone(tz)
        return local.strftime("%A, %B %d %Y at %I:%M %p %Z")
    except Exception:
        return str(scheduled_at_raw) if scheduled_at_raw else "TBD"


def _format_date_parts(scheduled_at_raw: Any, tz_str: str):
    """Returns (date_str, time_str, subject_dt_str)."""
    try:
        tz = pytz.timezone(tz_str or "America/New_York")
        if isinstance(scheduled_at_raw, str):
            dt = datetime.fromisoformat(scheduled_at_raw.replace("Z", "+00:00")).replace(tzinfo=None)
        else:
            dt = scheduled_at_raw
        if dt is None:
            return "TBD", "TBD", "TBD"
        utc_aware = pytz.utc.localize(dt)
        local = utc_aware.astimezone(tz)

        hour = local.hour % 12 or 12
        minute = local.strftime("%M")
        ampm = local.strftime("%p")
        tz_abbr = local.strftime("%Z")

        date_str = local.strftime("%B %d, %Y")               # December 13, 2025
        time_str = f"{hour}:{minute} {ampm} ({tz_abbr})"     # 3:00 PM (IST)
        subject_dt = f"{local.strftime('%b %d, %Y')} – {hour}:{minute} {ampm} {tz_abbr}"
        return date_str, time_str, subject_dt
    except Exception:
        return "TBD", "TBD", "TBD"


def _get_sendgrid_config():
    api_key = os.getenv("SENDGRID_API_KEY", "").strip()
    from_email = os.getenv("SENDGRID_FROM_EMAIL", "").strip()
    if not api_key:
        logger.error("SendGrid SENDGRID_API_KEY is not set in .env")
        return None, None
    if not api_key.startswith("SG."):
        logger.error("SendGrid SENDGRID_API_KEY looks invalid (must start with 'SG.'). Length: %d", len(api_key))
        return None, None
    if not from_email:
        logger.error("SendGrid SENDGRID_FROM_EMAIL is not set in .env")
        return None, None
    return api_key, from_email


def _send_via_sendgrid(to_email: str, subject: str, attachments: Optional[List] = None, **content_kwargs) -> bool:
    if not isinstance(to_email, str) or "@" not in to_email:
        logger.error("SendGrid skipped: invalid recipient '%s'", to_email)
        return False
    api_key, from_email = _get_sendgrid_config()
    if not api_key:
        return False
    try:
        message = Mail(from_email=from_email, to_emails=to_email.strip().lower(), subject=subject, **content_kwargs)
        if attachments:
            for att in attachments:
                if att is not None:
                    message.add_attachment(att)
        response = SendGridAPIClient(api_key).send(message)
        status = int(response.status_code)
        if 200 <= status < 300:
            logger.info("SendGrid OK %d → %s | %s", status, to_email, subject)
            return True
        logger.error("SendGrid %d for %s | body: %s", status, to_email, response.body)
        return False
    except Exception as exc:
        body = getattr(exc, "body", b"")
        status = getattr(exc, "status_code", "?")
        logger.error("SendGrid error %s for %s: %s | body: %s", status, to_email, exc, body)
        return False


def _send_plain_text_email(to_email: str, subject: str, body_text: str) -> bool:
    return _send_via_sendgrid(to_email, subject, plain_text_content=body_text)


def _send_html_email(to_email: str, subject: str, html_content: str, attachments: Optional[List] = None) -> bool:
    return _send_via_sendgrid(to_email, subject, attachments=attachments, html_content=html_content)


def _build_skills_rows_html(jd_skills: List[dict]) -> str:
    if not jd_skills:
        return ""

    sorted_skills = sorted(jd_skills, key=lambda s: _SKILL_TYPE_ORDER.get(s.get("skill_type", "soft"), 3))

    items = []
    for skill in sorted_skills:
        name = skill.get("skill_name", "")
        if not name:
            continue
        subtopics = skill.get("subtopics") or []
        sub_strs: List[str] = []
        if isinstance(subtopics, list):
            for s in subtopics:
                if isinstance(s, str) and s.strip():
                    sub_strs.append(s.strip())
                elif isinstance(s, dict):
                    label = s.get("name") or s.get("topic") or s.get("subtopic") or ""
                    if label:
                        sub_strs.append(str(label).strip())

        if sub_strs:
            items.append(f"<li><strong>{name}:</strong> {', '.join(sub_strs)}</li>")
        else:
            items.append(f"<li><strong>{name}</strong></li>")

    if not items:
        return ""

    list_html = "".join(items)
    return (
        "<tr><td style='padding:0 0 24px 0;'>"
        "<p style='font-size:14px;font-weight:700;color:#1a1a1a;margin:0 0 6px 0;'>"
        "Mandatory Focus Areas</p>"
        "<p style='font-size:13px;color:#374151;margin:0 0 10px 0;'>"
        "Please be prepared to discuss and demonstrate knowledge in the following areas:</p>"
        f"<ol style='margin:0;padding-left:22px;color:#374151;font-size:13px;line-height:1.9;'>{list_html}</ol>"
        "</td></tr>"
    )


def _build_candidate_invitation_html(
    candidate_name: str,
    jd_title: str,
    client_name: str,
    date_str: str,
    time_str: str,
    meeting_link: Optional[str],
    jd_skills: List[dict],
) -> str:
    skills_rows = _build_skills_rows_html(jd_skills)

    if meeting_link:
        meeting_rows = (
            "<tr><td style='padding:0 0 24px 0;'>"
            "<p style='font-size:14px;font-weight:700;color:#1a1a1a;margin:0 0 8px 0;'>Meeting Link:</p>"
            f"<a href='{meeting_link}' style='display:inline-block;background:#0078d4;color:#ffffff;"
            "text-decoration:none;font-size:13px;font-weight:600;padding:10px 22px;border-radius:6px;'>"
            "Join the Meeting Now</a>"
            "</td></tr>"
        )
    else:
        meeting_rows = (
            "<tr><td style='padding:0 0 24px 0;'>"
            "<p style='font-size:13px;color:#6b7280;margin:0;'>"
            "A Microsoft Teams meeting link will be shared with you separately.</p>"
            "</td></tr>"
        )

    guidelines_items = "".join(f"<li>{g}</li>" for g in _INTERVIEW_GUIDELINES)

    divider = "<tr><td style='padding:0 0 24px 0;'><hr style='border:none;border-top:1px solid #e5e7eb;margin:0;'></td></tr>"

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

        # ── Header ──
        "<tr><td style='background:#0078d4;padding:28px 36px;'>"
        "<p style='margin:0;color:#ffffff;font-size:11px;font-weight:600;"
        "letter-spacing:1px;text-transform:uppercase;opacity:0.85;'>"
        "Virtual Interview Invitation</p>"
        f"<h1 style='margin:6px 0 0 0;color:#ffffff;font-size:22px;font-weight:700;line-height:1.3;'>{jd_title}</h1>"
        "</td></tr>"

        # ── Body ──
        "<tr><td style='padding:32px 36px 0 36px;'>"
        "<table width='100%' cellpadding='0' cellspacing='0'>"

        # Greeting
        "<tr><td style='padding:0 0 16px 0;'>"
        f"<p style='margin:0 0 10px 0;font-size:14px;color:#1a1a1a;'>Dear <strong>{candidate_name}</strong>,</p>"
        f"<p style='margin:0;font-size:14px;color:#374151;line-height:1.7;'>Greetings from <strong>{client_name}</strong>.</p>"
        "</td></tr>"

        # Invitation intro
        "<tr><td style='padding:0 0 20px 0;'>"
        f"<p style='margin:0;font-size:14px;color:#374151;line-height:1.7;'>"
        f"You are invited to attend a <strong>Virtual LIVE Video Interview</strong> for the "
        f"<strong>{jd_title}</strong> position. This interview will primarily assess your "
        "hands-on expertise, problem-solving approach, and domain best practices.</p>"
        "</td></tr>"

        # Interview Details card
        "<tr><td style='padding:0 0 24px 0;'>"
        "<table width='100%' cellpadding='0' cellspacing='0'"
        " style='background:#f0f7ff;border-left:4px solid #0078d4;border-radius:4px;padding:18px 20px;'>"
        "<tr><td>"
        "<p style='margin:0 0 12px 0;font-size:12px;font-weight:700;color:#0078d4;"
        "text-transform:uppercase;letter-spacing:0.5px;'>Interview Details</p>"
        "<table cellpadding='0' cellspacing='0'>"
        "<tr>"
        "<td style='font-size:13px;color:#6b7280;padding:3px 16px 3px 0;min-width:80px;'>Position</td>"
        f"<td style='font-size:13px;color:#1a1a1a;font-weight:600;'>{jd_title}</td>"
        "</tr><tr>"
        "<td style='font-size:13px;color:#6b7280;padding:3px 16px 3px 0;'>Date</td>"
        f"<td style='font-size:13px;color:#1a1a1a;font-weight:600;'>{date_str}</td>"
        "</tr><tr>"
        "<td style='font-size:13px;color:#6b7280;padding:3px 16px 3px 0;'>Time</td>"
        f"<td style='font-size:13px;color:#1a1a1a;font-weight:600;'>{time_str}</td>"
        "</tr><tr>"
        "<td style='font-size:13px;color:#6b7280;padding:3px 16px 3px 0;'>Mode</td>"
        "<td style='font-size:13px;color:#1a1a1a;font-weight:600;'>Microsoft Teams – Live Video Interview</td>"
        "</tr>"
        "</table>"
        "</td></tr>"
        "</table>"
        "</td></tr>"

        # Meeting link
        + meeting_rows

        # Skills / Focus Areas
        + skills_rows

        # Divider
        + divider

        # Mandatory guidelines
        + (
            "<tr><td style='padding:0 0 24px 0;'>"
            "<p style='font-size:14px;font-weight:700;color:#1a1a1a;margin:0 0 6px 0;'>"
            "Mandatory Interview Guidelines</p>"
            "<p style='font-size:13px;color:#374151;margin:0 0 10px 0;'>"
            "Please ensure strict adherence to the following:</p>"
            f"<ol style='margin:0;padding-left:22px;color:#374151;font-size:13px;line-height:1.9;'>{guidelines_items}</ol>"
            "</td></tr>"
        )

        # Closing
        + (
            "<tr><td style='padding:0 0 32px 0;'>"
            "<p style='margin:0 0 14px 0;font-size:14px;color:#374151;line-height:1.7;'>"
            "Kindly accept the meeting invitation and ensure availability at the scheduled time. "
            "For any clarification prior to the interview, please reach out to our coordination "
            "team in advance.</p>"
            "<p style='margin:0;font-size:14px;font-weight:700;color:#1a1a1a;'>"
            "We wish you success in your interview.</p>"
            "</td></tr>"
        )

        + "</table>"  # close inner table
        + "</td></tr>"  # close body td

        # Footer
        + (
            "<tr><td style='background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 36px;'>"
            "<p style='margin:0;font-size:13px;color:#374151;line-height:1.8;'>"
            "Warm regards,<br>"
            "<strong>MeedenLabs Team</strong><br>"
            f"<em>on behalf of {client_name}</em>"
            "</p>"
            "</td></tr>"
        )

        + "</table>"   # close outer card table
        + "</td></tr></table>"  # close wrapper
        + "</body></html>"
    )


def send_interview_scheduled_to_candidate(
    candidate,
    interview,
    jd,
    jd_skills: Optional[List[dict]] = None,
    client_name: str = "",
) -> bool:
    try:
        candidate_email = _field(candidate, "email")
        candidate_name = _field(candidate, "full_name", "Candidate")
        jd_title = _field(jd, "title", "Interview")
        meeting_link = _field(interview, "meeting_link")
        tz_str = _field(interview, "timezone", "America/New_York")
        scheduled_at = _field(interview, "scheduled_at")

        date_str, time_str, subject_dt = _format_date_parts(scheduled_at, tz_str)
        resolved_client = client_name or "MeedenLabs"

        subject = f"Virtual Interview Invitation – {jd_title} | {resolved_client} | {candidate_name} | {subject_dt}"

        html = _build_candidate_invitation_html(
            candidate_name=candidate_name,
            jd_title=jd_title,
            client_name=resolved_client,
            date_str=date_str,
            time_str=time_str,
            meeting_link=meeting_link,
            jd_skills=jd_skills or [],
        )

        return _send_html_email(candidate_email, subject, html)
    except Exception as exc:
        logger.exception("Failed to prepare candidate schedule email: %s", exc)
        return False


_FEEDBACK_BASE_URL = "https://app.meedenlabs.com/feedback"
_APP_BASE_URL = os.getenv("APP_BASE_URL", "https://testiaas.meedenlabs.com")


def _build_panelist_invitation_html(
    panelist_name: str,
    candidate_name: str,
    candidate_email: str,
    jd_title: str,
    client_name: str,
    date_str: str,
    time_str: str,
    duration_minutes: int,
    meeting_link: Optional[str],
    jd_skills: List[dict],
    resume_url: Optional[str],
    feedback_link: Optional[str],
) -> str:
    """Build rich HTML invitation email for panelists."""
    skills_rows = _build_skills_rows_html(jd_skills)

    if meeting_link:
        meeting_rows = (
            "<tr><td style='padding:0 0 24px 0;'>"
            "<p style='font-size:14px;font-weight:700;color:#1a1a1a;margin:0 0 8px 0;'>Teams Meeting Link:</p>"
            f"<a href='{meeting_link}' style='display:inline-block;background:#0078d4;color:#ffffff;"
            "text-decoration:none;font-size:13px;font-weight:600;padding:10px 22px;border-radius:6px;'>"
            "Join the Meeting Now</a>"
            "</td></tr>"
        )
    else:
        meeting_rows = (
            "<tr><td style='padding:0 0 24px 0;'>"
            "<p style='font-size:13px;color:#6b7280;margin:0;'>"
            "A Microsoft Teams meeting link will be shared with you separately.</p>"
            "</td></tr>"
        )

    resume_rows = ""
    if resume_url:
        resume_rows = (
            "<tr><td style='padding:0 0 24px 0;'>"
            "<p style='font-size:14px;font-weight:700;color:#1a1a1a;margin:0 0 8px 0;'>Candidate Resume:</p>"
            f"<a href='{resume_url}' style='display:inline-block;background:#10b981;color:#ffffff;"
            "text-decoration:none;font-size:13px;font-weight:600;padding:10px 22px;border-radius:6px;'>"
            "Download Resume</a>"
            "</td></tr>"
        )

    feedback_rows = ""
    if feedback_link:
        feedback_rows = (
            "<tr><td style='padding:0 0 24px 0;'>"
            "<p style='font-size:14px;font-weight:700;color:#1a1a1a;margin:0 0 8px 0;'>After the Interview:</p>"
            "<p style='margin:0 0 10px 0;font-size:13px;color:#374151;line-height:1.6;'>"
            "Please submit your detailed feedback using the link below. "
            "Your evaluation will help us make the best hiring decision.</p>"
            f"<a href='{feedback_link}' style='display:inline-block;background:#f59e0b;color:#ffffff;"
            "text-decoration:none;font-size:13px;font-weight:600;padding:10px 22px;border-radius:6px;'>"
            "Submit Feedback</a>"
            "<p style='margin:12px 0 0 0;font-size:11px;color:#6b7280;'>"
            "(Link expires 7 days after the interview)</p>"
            "</td></tr>"
        )

    divider = "<tr><td style='padding:0 0 24px 0;'><hr style='border:none;border-top:1px solid #e5e7eb;margin:0;'></td></tr>"

    prep_notes = (
        "<tr><td style='padding:0 0 24px 0;'>"
        "<p style='font-size:14px;font-weight:700;color:#1a1a1a;margin:0 0 6px 0;'>"
        "Preparation Notes</p>"
        "<ul style='margin:0;padding-left:22px;color:#374151;font-size:13px;line-height:1.9;'>"
        "<li>Review the candidate resume and focus areas before the interview.</li>"
        "<li>Evaluate the candidate objectively on the mentioned skills.</li>"
        "<li>Take notes on strengths, areas for improvement, and overall fit.</li>"
        "<li>Join 5 minutes early to test your audio/video setup.</li>"
        "</ul>"
        "</td></tr>"
    )

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
        # ── Header ──
        "<tr><td style='background:#0078d4;padding:28px 36px;'>"
        "<p style='margin:0;color:#ffffff;font-size:11px;font-weight:600;"
        "letter-spacing:1px;text-transform:uppercase;opacity:0.85;'>"
        "Virtual Interview Assignment</p>"
        f"<h1 style='margin:6px 0 0 0;color:#ffffff;font-size:22px;font-weight:700;line-height:1.3;'>{jd_title}</h1>"
        "</td></tr>"
        # ── Body ──
        "<tr><td style='padding:32px 36px 0 36px;'>"
        "<table width='100%' cellpadding='0' cellspacing='0'>"
        # Greeting
        "<tr><td style='padding:0 0 16px 0;'>"
        f"<p style='margin:0 0 10px 0;font-size:14px;color:#1a1a1a;'>Dear <strong>{panelist_name}</strong>,</p>"
        f"<p style='margin:0;font-size:14px;color:#374151;line-height:1.7;'>"
        f"You have been assigned to evaluate a candidate for the <strong>{jd_title}</strong> position at <strong>{client_name}</strong>."
        "</p>"
        "</td></tr>"
        # Candidate info
        "<tr><td style='padding:0 0 20px 0;'>"
        "<table width='100%' cellpadding='0' cellspacing='0'"
        " style='background:#f0f7ff;border-left:4px solid #0078d4;border-radius:4px;padding:16px 18px;'>"
        "<tr><td>"
        "<p style='margin:0 0 8px 0;font-size:12px;font-weight:700;color:#0078d4;"
        "text-transform:uppercase;letter-spacing:0.5px;'>Candidate Information</p>"
        f"<p style='margin:0;font-size:14px;font-weight:600;color:#1a1a1a;'>{candidate_name}</p>"
        f"<p style='margin:2px 0 0 0;font-size:13px;color:#6b7280;'>{candidate_email}</p>"
        "</td></tr>"
        "</table>"
        "</td></tr>"
        # Interview details card
        "<tr><td style='padding:0 0 24px 0;'>"
        "<table width='100%' cellpadding='0' cellspacing='0'"
        " style='background:#f0f4ff;border-left:4px solid #0078d4;border-radius:4px;padding:18px 20px;'>"
        "<tr><td>"
        "<p style='margin:0 0 12px 0;font-size:12px;font-weight:700;color:#0078d4;"
        "text-transform:uppercase;letter-spacing:0.5px;'>Interview Details</p>"
        "<table cellpadding='0' cellspacing='0'>"
        "<tr>"
        "<td style='font-size:13px;color:#6b7280;padding:3px 16px 3px 0;min-width:100px;'>Position</td>"
        f"<td style='font-size:13px;color:#1a1a1a;font-weight:600;'>{jd_title}</td>"
        "</tr><tr>"
        "<td style='font-size:13px;color:#6b7280;padding:3px 16px 3px 0;'>Date</td>"
        f"<td style='font-size:13px;color:#1a1a1a;font-weight:600;'>{date_str}</td>"
        "</tr><tr>"
        "<td style='font-size:13px;color:#6b7280;padding:3px 16px 3px 0;'>Time</td>"
        f"<td style='font-size:13px;color:#1a1a1a;font-weight:600;'>{time_str}</td>"
        "</tr><tr>"
        "<td style='font-size:13px;color:#6b7280;padding:3px 16px 3px 0;'>Duration</td>"
        f"<td style='font-size:13px;color:#1a1a1a;font-weight:600;'>{duration_minutes} minutes</td>"
        "</tr><tr>"
        "<td style='font-size:13px;color:#6b7280;padding:3px 16px 3px 0;'>Mode</td>"
        "<td style='font-size:13px;color:#1a1a1a;font-weight:600;'>Microsoft Teams – Virtual</td>"
        "</tr>"
        "</table>"
        "</td></tr>"
        "</table>"
        "</td></tr>"
        # Meeting link
        + meeting_rows
        # Resume
        + resume_rows
        # Skills / Focus Areas
        + skills_rows
        # Divider
        + divider
        # Preparation notes
        + prep_notes
        # Divider
        + divider
        # Feedback submission
        + feedback_rows
        # Closing
        + (
            "<tr><td style='padding:0 0 32px 0;'>"
            "<p style='margin:0;font-size:13px;color:#6b7280;'>"
            "Thank you for taking the time to evaluate this candidate. "
            "Your feedback is crucial to our hiring decision."
            "</p>"
            "</td></tr>"
        )
        + "</table>"  # close inner table
        + "</td></tr>"  # close body td
        # Footer
        + (
            "<tr><td style='background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 36px;'>"
            "<p style='margin:0;font-size:13px;color:#374151;line-height:1.8;'>"
            "Warm regards,<br>"
            "<strong>MeedenLabs Team</strong>"
            "</p>"
            "</td></tr>"
        )
        + "</table>"   # close outer card table
        + "</td></tr></table>"  # close wrapper
        + "</body></html>"
    )


def send_interview_scheduled_to_panelist(
    panelist, candidate, interview, jd, feedback_token: str = "", jd_skills: Optional[List[dict]] = None
) -> bool:
    try:
        panelist_email = _field(panelist, "email")
        panelist_name = _field(panelist, "name") or _field(panelist, "full_name", "Panelist")
        candidate_name = _field(candidate, "full_name", "Candidate")
        candidate_email = _field(candidate, "email", "—")
        _raw_resume = _field(candidate, "resume_url")
        _candidate_id = _field(candidate, "id")
        candidate_resume_url = (
            f"{_APP_BASE_URL}/api/candidates/{_candidate_id}/resume"
            if _raw_resume and _candidate_id else None
        )
        jd_title = _field(jd, "title", "Interview")
        client_name = _field(jd.client, "name", "MeedenLabs") if hasattr(jd, "client") else "MeedenLabs"
        meeting_link = _field(interview, "meeting_link")
        duration_minutes = _field(interview, "duration_minutes", 60)
        tz_str = _field(interview, "timezone", "America/New_York")
        scheduled_at = _field(interview, "scheduled_at")

        date_str, time_str, subject_dt = _format_date_parts(scheduled_at, tz_str)

        feedback_link = ""
        if feedback_token:
            feedback_link = f"{_FEEDBACK_BASE_URL}/{feedback_token}"

        subject = f"Interview Assignment — {jd_title} | {candidate_name} | {subject_dt}"

        html = _build_panelist_invitation_html(
            panelist_name=panelist_name,
            candidate_name=candidate_name,
            candidate_email=candidate_email,
            jd_title=jd_title,
            client_name=client_name,
            date_str=date_str,
            time_str=time_str,
            duration_minutes=duration_minutes,
            meeting_link=meeting_link,
            jd_skills=jd_skills or [],
            resume_url=candidate_resume_url,
            feedback_link=feedback_link,
        )

        attachments = []
        if _raw_resume:
            ext = os.path.splitext(_raw_resume)[1] or ".pdf"
            safe = candidate_name.replace(" ", "_")
            att = _build_attachment(_raw_resume, f"Resume_{safe}{ext}")
            if att:
                attachments.append(att)
        jd_file_url = _field(jd, "file_url")
        if jd_file_url:
            ext = os.path.splitext(jd_file_url)[1] or ".pdf"
            safe_jd = jd_title.replace(" ", "_")[:40]
            att = _build_attachment(jd_file_url, f"JD_{safe_jd}{ext}")
            if att:
                attachments.append(att)

        return _send_html_email(panelist_email, subject, html, attachments=attachments or None)
    except Exception as exc:
        logger.exception("Failed to prepare panelist schedule email: %s", exc)
        return False


def send_feedback_reminder_email(
    panelist_email: str,
    panelist_name: str,
    candidate_name: str,
    jd_title: str,
    feedback_link: str,
) -> bool:
    try:
        lines = [
            f"Hello {panelist_name},",
            "",
            f"This is a reminder to submit your feedback for the recent interview with {candidate_name}.",
            f"Position: {jd_title}",
            "",
            "Please submit your feedback using the link below:",
            f"Feedback Link: {feedback_link}",
            "",
            "Note: This link expires 48 hours after the interview time and can only be used once.",
            "",
            "Regards,",
            "MeedenLabs Team",
        ]
        subject = f"Feedback Reminder — {jd_title} | {candidate_name}"
        return _send_plain_text_email(panelist_email, subject, "\n".join(lines))
    except Exception as exc:
        logger.exception("Failed to prepare feedback reminder email: %s", exc)
        return False


def send_interview_notification_to_additional_recipient(email: str, candidate, interview, jd, jd_skills: Optional[List[dict]] = None) -> bool:
    try:
        candidate_name = _field(candidate, "full_name", "Candidate")
        candidate_email = _field(candidate, "email", "—")
        _raw_resume = _field(candidate, "resume_url")
        _candidate_id = _field(candidate, "id")
        candidate_resume_url = (
            f"{_APP_BASE_URL}/api/candidates/{_candidate_id}/resume"
            if _raw_resume and _candidate_id else None
        )
        jd_title = _field(jd, "title", "Interview")
        client_name = _field(jd.client, "name", "MeedenLabs") if hasattr(jd, "client") else "MeedenLabs"
        meeting_link = _field(interview, "meeting_link")
        duration_minutes = _field(interview, "duration_minutes", 60)
        tz_str = _field(interview, "timezone", "America/New_York")
        scheduled_at = _field(interview, "scheduled_at")

        date_str, time_str, subject_dt = _format_date_parts(scheduled_at, tz_str)

        subject = f"Interview Notification — {jd_title} | {candidate_name} | {subject_dt}"

        html = _build_panelist_invitation_html(
            panelist_name="Hiring Team",
            candidate_name=candidate_name,
            candidate_email=candidate_email,
            jd_title=jd_title,
            client_name=client_name,
            date_str=date_str,
            time_str=time_str,
            duration_minutes=duration_minutes,
            meeting_link=meeting_link,
            jd_skills=jd_skills or [],
            resume_url=candidate_resume_url,
            feedback_link="",
        )

        attachments = []
        if _raw_resume:
            ext = os.path.splitext(_raw_resume)[1] or ".pdf"
            safe = candidate_name.replace(" ", "_")
            att = _build_attachment(_raw_resume, f"Resume_{safe}{ext}")
            if att:
                attachments.append(att)
        jd_file_url = _field(jd, "file_url")
        if jd_file_url:
            ext = os.path.splitext(jd_file_url)[1] or ".pdf"
            safe_jd = jd_title.replace(" ", "_")[:40]
            att = _build_attachment(jd_file_url, f"JD_{safe_jd}{ext}")
            if att:
                attachments.append(att)

        return _send_html_email(email, subject, html, attachments=attachments or None)
    except Exception as exc:
        logger.exception("Failed to send additional recipient interview email: %s", exc)
        return False


def send_resume_upload_notification_to_operator(
    operator_email: str,
    operator_name: str,
    uploader_name: str,
    client_name: str,
    jd_title: str,
    job_code: str,
    candidate_count: int,
) -> bool:
    try:
        lines = [
            f"Hello {operator_name},",
            "",
            f"{candidate_count} new resume(s) have been uploaded and are ready for interview scheduling.",
            "",
            f"Client: {client_name}",
            f"Job Description: {jd_title}",
            f"Job Code: {job_code}",
            f"Uploaded by: {uploader_name}",
            f"Resumes ready: {candidate_count}",
            "",
            "Please log in to the portal to review the candidates and schedule interviews at your earliest convenience.",
            "",
            "Regards,",
            "MeedenLabs Team",
        ]
        subject = f"New Resumes Ready for Scheduling — {job_code}"
        return _send_plain_text_email(operator_email, subject, "\n".join(lines))
    except Exception as exc:
        logger.exception("Failed to prepare operator resume notification email: %s", exc)
        return False


def send_interview_scheduled_to_recruiter(recruiter, candidate, interview, jd) -> bool:
    try:
        recruiter_email = _field(recruiter, "email")
        recruiter_name = _field(recruiter, "full_name", "Recruiter")
        candidate_name = _field(candidate, "full_name", "Candidate")
        candidate_email = _field(candidate, "email", "—")
        jd_title = _field(jd, "title", "Interview")
        panelists = _field(interview, "panelists", []) or []
        panelist_emails = ", ".join(
            _field(p, "email", "") for p in panelists if _field(p, "email", "")
        )
        tz_str = _field(interview, "timezone", "America/New_York")
        time_display = _format_local_time(_field(interview, "scheduled_at"), tz_str)

        lines = [
            f"Hello {recruiter_name},",
            "",
            "An interview has been scheduled.",
            f"Candidate: {candidate_name}",
            f"Candidate Email: {candidate_email}",
            f"JD: {jd_title}",
            f"Date & Time: {time_display}",
            f"Panelists: {panelist_emails or 'None assigned'}",
            "Mode: Virtual (Teams)",
            "",
            "Regards,",
            "MeedenLabs Team",
        ]

        subject = f"Interview Scheduled for {candidate_name}"
        return _send_plain_text_email(recruiter_email, subject, "\n".join(lines))
    except Exception as exc:
        logger.exception("Failed to prepare recruiter schedule email: %s", exc)
        return False
