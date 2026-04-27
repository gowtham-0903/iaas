import logging
import os
from datetime import datetime
from typing import Any, Optional

from dotenv import load_dotenv
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail


load_dotenv()

logger = logging.getLogger(__name__)


def _field(obj: Any, key: str, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _normalize_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _send_plain_text_email(to_email: str, subject: str, body_text: str) -> bool:
    try:
        api_key = os.getenv("SENDGRID_API_KEY", "").strip()
        from_email = os.getenv("SENDGRID_FROM_EMAIL", "").strip()
        if not api_key or not from_email:
            logger.error("SendGrid email skipped: SENDGRID_API_KEY or SENDGRID_FROM_EMAIL not configured")
            return False
        if not isinstance(to_email, str) or not to_email.strip():
            logger.error("SendGrid email skipped: invalid recipient email")
            return False

        message = Mail(
            from_email=from_email,
            to_emails=to_email.strip().lower(),
            subject=subject,
            plain_text_content=body_text,
        )
        client = SendGridAPIClient(api_key)
        response = client.send(message)
        return 200 <= int(response.status_code) < 300
    except Exception as exc:
        logger.exception("Failed sending SendGrid email: %s", exc)
        return False


def send_interview_scheduled_to_candidate(candidate, interview, jd) -> bool:
    try:
        candidate_email = _field(candidate, "email")
        candidate_name = _field(candidate, "full_name", "Candidate")
        jd_title = _field(jd, "title", "Interview")
        mode = (_field(interview, "mode", "virtual") or "virtual").replace("_", " ")
        meeting_link = _field(interview, "meeting_link")
        panelists = _field(interview, "panelists", []) or []
        interviewer_count = len(panelists)
        duration_minutes = _field(interview, "duration_minutes", 60)

        scheduled_at = _normalize_datetime(_field(interview, "scheduled_at"))
        date_text = scheduled_at.strftime("%Y-%m-%d") if scheduled_at else "TBD"
        time_text = scheduled_at.strftime("%H:%M") if scheduled_at else "TBD"

        lines = [
            f"Dear {candidate_name},",
            "",
            f"Your interview for {jd_title} has been scheduled.",
            f"Date: {date_text}",
            f"Time: {time_text}",
            f"Mode: {mode}",
            f"Duration: {duration_minutes} minutes",
            f"Interviewer count: {interviewer_count}",
        ]

        if str(mode).lower() == "virtual" and meeting_link:
            lines.append(f"Meeting link: {meeting_link}")

        lines.extend(
            [
                "",
                "Please be available a few minutes before the scheduled time.",
                "Regards,",
                "IAAS Recruitment Team",
            ]
        )

        subject = f"Interview Scheduled — {jd_title}"
        return _send_plain_text_email(candidate_email, subject, "\n".join(lines))
    except Exception as exc:
        logger.exception("Failed to prepare candidate schedule email: %s", exc)
        return False


def send_interview_scheduled_to_panelist(panelist, candidate, interview, jd) -> bool:
    try:
        panelist_email = _field(panelist, "email")
        panelist_name = _field(panelist, "full_name", "Panelist")
        candidate_name = _field(candidate, "full_name", "Candidate")
        jd_title = _field(jd, "title", "Interview")
        mode = (_field(interview, "mode", "virtual") or "virtual").replace("_", " ")
        meeting_link = _field(interview, "meeting_link")
        duration_minutes = _field(interview, "duration_minutes", 60)

        scheduled_at = _normalize_datetime(_field(interview, "scheduled_at"))
        date_text = scheduled_at.strftime("%Y-%m-%d") if scheduled_at else "TBD"
        time_text = scheduled_at.strftime("%H:%M") if scheduled_at else "TBD"

        lines = [
            f"Hello {panelist_name},",
            "",
            "You have been assigned to an interview.",
            f"Candidate: {candidate_name}",
            f"JD Title: {jd_title}",
            f"Date: {date_text}",
            f"Time: {time_text}",
            f"Mode: {mode}",
            f"Duration: {duration_minutes} minutes",
        ]

        if meeting_link:
            lines.append(f"Meeting link: {meeting_link}")

        lines.extend([
            "",
            "Please review the candidate profile and be prepared.",
            "Regards,",
            "IAAS Recruitment Team",
        ])

        subject = f"Interview Assignment — {jd_title}"
        return _send_plain_text_email(panelist_email, subject, "\n".join(lines))
    except Exception as exc:
        logger.exception("Failed to prepare panelist schedule email: %s", exc)
        return False


def send_interview_scheduled_to_recruiter(recruiter, candidate, interview, jd) -> bool:
    try:
        recruiter_email = _field(recruiter, "email")
        recruiter_name = _field(recruiter, "full_name", "Recruiter")
        candidate_name = _field(candidate, "full_name", "Candidate")
        jd_title = _field(jd, "title", "Interview")
        panelists = _field(interview, "panelists", []) or []
        panelist_count = len(panelists)

        scheduled_at = _normalize_datetime(_field(interview, "scheduled_at"))
        date_text = scheduled_at.strftime("%Y-%m-%d") if scheduled_at else "TBD"
        time_text = scheduled_at.strftime("%H:%M") if scheduled_at else "TBD"

        lines = [
            f"Hello {recruiter_name},",
            "",
            "An interview has been scheduled.",
            f"Candidate: {candidate_name}",
            f"JD: {jd_title}",
            f"Date: {date_text}",
            f"Time: {time_text}",
            f"Panelists assigned: {panelist_count}",
            "",
            "Regards,",
            "IAAS Recruitment Team",
        ]

        subject = f"Interview Scheduled for {candidate_name}"
        return _send_plain_text_email(recruiter_email, subject, "\n".join(lines))
    except Exception as exc:
        logger.exception("Failed to prepare recruiter schedule email: %s", exc)
        return False
