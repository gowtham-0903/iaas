import logging
import os
from datetime import datetime
from typing import Any, List, Optional

import pytz
from dotenv import load_dotenv
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail


load_dotenv()

logger = logging.getLogger(__name__)

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


def _send_via_sendgrid(to_email: str, subject: str, **content_kwargs) -> bool:
    if not isinstance(to_email, str) or "@" not in to_email:
        logger.error("SendGrid skipped: invalid recipient '%s'", to_email)
        return False
    api_key, from_email = _get_sendgrid_config()
    if not api_key:
        return False
    try:
        message = Mail(from_email=from_email, to_emails=to_email.strip().lower(), subject=subject, **content_kwargs)
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


def _send_html_email(to_email: str, subject: str, html_content: str) -> bool:
    return _send_via_sendgrid(to_email, subject, html_content=html_content)


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


def send_interview_scheduled_to_panelist(panelist, candidate, interview, jd) -> bool:
    try:
        panelist_email = _field(panelist, "email")
        panelist_name = _field(panelist, "full_name", "Panelist")
        candidate_name = _field(candidate, "full_name", "Candidate")
        candidate_email = _field(candidate, "email", "—")
        jd_title = _field(jd, "title", "Interview")
        meeting_link = _field(interview, "meeting_link")
        duration_minutes = _field(interview, "duration_minutes", 60)
        tz_str = _field(interview, "timezone", "America/New_York")
        time_display = _format_local_time(_field(interview, "scheduled_at"), tz_str)

        lines = [
            f"Hello {panelist_name},",
            "",
            "You have been assigned to an interview.",
            f"Candidate: {candidate_name}",
            f"Candidate Email: {candidate_email}",
            f"JD Title: {jd_title}",
            f"Date & Time: {time_display}",
            "Mode: Microsoft Teams (Virtual)",
            f"Duration: {duration_minutes} minutes",
        ]

        if meeting_link:
            lines.extend(["", f"Your Teams meeting link: {meeting_link}"])

        lines.extend([
            "",
            "Please review the candidate profile and be prepared.",
            "Regards,",
            "MeedenLabs Team",
        ])

        subject = f"Interview Assignment — {jd_title}"
        return _send_plain_text_email(panelist_email, subject, "\n".join(lines))
    except Exception as exc:
        logger.exception("Failed to prepare panelist schedule email: %s", exc)
        return False


def send_interview_notification_to_additional_recipient(email: str, candidate, interview, jd) -> bool:
    try:
        candidate_name = _field(candidate, "full_name", "Candidate")
        candidate_email = _field(candidate, "email", "—")
        jd_title = _field(jd, "title", "Interview")
        meeting_link = _field(interview, "meeting_link")
        duration_minutes = _field(interview, "duration_minutes", 60)
        tz_str = _field(interview, "timezone", "America/New_York")
        time_display = _format_local_time(_field(interview, "scheduled_at"), tz_str)

        lines = [
            "Hello,",
            "",
            "You have been added as a recipient for the following interview.",
            f"Candidate: {candidate_name} ({candidate_email})",
            f"JD Title: {jd_title}",
            f"Date & Time: {time_display}",
            f"Duration: {duration_minutes} minutes",
            "Mode: Microsoft Teams (Virtual)",
        ]
        if meeting_link:
            lines.extend(["", f"Teams meeting link: {meeting_link}"])
        lines.extend(["", "Regards,", "MeedenLabs Team"])

        subject = f"Interview Notification — {jd_title}"
        return _send_plain_text_email(email, subject, "\n".join(lines))
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
