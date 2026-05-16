import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests


logger = logging.getLogger(__name__)

GRAPH_SCOPE = "https://graph.microsoft.com/.default"
GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"
_token_cache = {"token": None, "expires_at": 0.0}

# Matches VTT timestamp lines like: 00:00:01.000 --> 00:00:04.500
_VTT_TIMESTAMP_RE = re.compile(
    r"^\d{2}:\d{2}:\d{2}[.,]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[.,]\d{3}.*$"
)


def _required_env(name: str) -> str:
    """Raise ValueError (not RuntimeError) for missing Teams env vars so callers
    can catch it and return a 400 instead of crashing with a 500."""
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(
            f"Teams configuration is incomplete: environment variable '{name}' is not set. "
            "Please configure TEAMS_TENANT_ID, TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET, "
            "and TEAMS_ORGANIZER_USER_ID in your .env file."
        )
    return value


def get_access_token() -> str:
    if _token_cache["token"] and time.time() < _token_cache["expires_at"] - 60:
        return _token_cache["token"]

    tenant_id = _required_env("TEAMS_TENANT_ID")
    client_id = _required_env("TEAMS_CLIENT_ID")
    client_secret = _required_env("TEAMS_CLIENT_SECRET")

    response = requests.post(
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": GRAPH_SCOPE,
            "grant_type": "client_credentials",
        },
        timeout=30,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Teams token error: {response.text}")

    payload = response.json()
    _token_cache["token"] = payload["access_token"]
    _token_cache["expires_at"] = time.time() + float(payload.get("expires_in", 3600))
    return _token_cache["token"]


def create_teams_interview_event(
    subject: str,
    start_utc: datetime,
    duration_minutes: int,
    candidate_email: str,
    candidate_name: str,
    panelist_emails: list[str],
    panelist_names: list[str],
    notes: Optional[str] = None,
    extra_attendee_emails: Optional[list[str]] = None,
    extra_attendee_names: Optional[list[str]] = None,
) -> dict:
    organizer_user_id = _required_env("TEAMS_ORGANIZER_USER_ID")
    end_utc = start_utc + timedelta(minutes=duration_minutes)

    attendees = [
        {
            "emailAddress": {
                "address": candidate_email,
                "name": candidate_name or candidate_email,
            },
            "type": "required",
        }
    ]

    for email, name in zip(panelist_emails, panelist_names):
        if email and "@" in email:
            attendees.append(
                {
                    "emailAddress": {
                        "address": email,
                        "name": name or email,
                    },
                    "type": "required",
                }
            )

    for email, name in zip(extra_attendee_emails or [], extra_attendee_names or []):
        if email and "@" in email:
            attendees.append(
                {
                    "emailAddress": {
                        "address": email,
                        "name": name or email,
                    },
                    "type": "optional",
                }
            )

    body_content = "Interview scheduled via IAAS platform."
    if notes:
        body_content = f"{body_content}\n\nNotes: {notes}"

    payload = {
        "subject": subject,
        "start": {
            "dateTime": start_utc.strftime("%Y-%m-%dT%H:%M:%S"),
            "timeZone": "UTC",
        },
        "end": {
            "dateTime": end_utc.strftime("%Y-%m-%dT%H:%M:%S"),
            "timeZone": "UTC",
        },
        "isOnlineMeeting": True,
        "onlineMeetingProvider": "teamsForBusiness",
        "body": {
            "contentType": "text",
            "content": body_content,
        },
        "attendees": attendees,
        "allowNewTimeProposals": False,
    }

    response = requests.post(
        f"{GRAPH_BASE_URL}/users/{organizer_user_id}/events",
        json=payload,
        headers={
            "Authorization": f"Bearer {get_access_token()}",
            "Content-Type": "application/json",
        },
        timeout=30,
    )
    if response.status_code not in (200, 201):
        raise RuntimeError(f"Teams event creation failed: {response.status_code} — {response.text}")

    data = response.json()
    return {
        "external_event_id": data["id"],
        "join_url": ((data.get("onlineMeeting") or {}).get("joinUrl")),
        "teams_meeting_id": data.get("onlineMeetingId"),
    }



def cancel_teams_interview_event(external_event_id: str) -> bool:
    if not external_event_id:
        return False

    try:
        organizer_user_id = _required_env("TEAMS_ORGANIZER_USER_ID")
        response = requests.delete(
            f"{GRAPH_BASE_URL}/users/{organizer_user_id}/events/{external_event_id}",
            headers={"Authorization": f"Bearer {get_access_token()}"},
            timeout=15,
        )
        return response.status_code == 204
    except Exception as exc:
        logger.exception("Teams cancel failed: %s", exc)
        return False


# ---------------------------------------------------------------------------
# M4 Phase 1 — Teams Transcript Fetch
# ---------------------------------------------------------------------------

def parse_vtt(vtt_text: str) -> str:
    """Parse a WebVTT string into clean dialogue lines.

    Strips the WEBVTT header, cue sequence numbers, and timestamp lines.
    Each cue block contributes one line formatted as::

        SpeakerName: dialogue text

    Consecutive cues from the same speaker are kept as separate lines.

    Args:
        vtt_text: Raw VTT content returned by the Graph API.

    Returns:
        A multi-line string of ``Speaker: text`` lines.
    """
    lines = vtt_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    dialogue_lines: list[str] = []
    skip_next_blank = False  # used to skip the blank line after WEBVTT header

    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # Skip empty lines
        if not line:
            i += 1
            continue

        # Skip WEBVTT header (first non-empty line)
        if line.upper().startswith("WEBVTT"):
            i += 1
            continue

        # Skip pure-digit cue sequence numbers (e.g. "1", "2", "42")
        if line.isdigit():
            i += 1
            continue

        # Skip timestamp lines: 00:00:01.000 --> 00:00:04.500 ...
        if _VTT_TIMESTAMP_RE.match(line):
            i += 1
            continue

        # Anything remaining is a cue payload line
        # Teams VTT format: "<v SpeakerName>dialogue text</v>" or plain text
        speaker_match = re.match(r"^<v\s+([^>]+)>(.*?)</v>$", line, re.IGNORECASE)
        if speaker_match:
            speaker = speaker_match.group(1).strip()
            text = speaker_match.group(2).strip()
            if speaker and text:
                dialogue_lines.append(f"{speaker}: {text}")
        else:
            # Plain text cue — no speaker tag
            if line:
                dialogue_lines.append(line)

        i += 1

    return "\n".join(dialogue_lines)


def fetch_meeting_transcript(teams_meeting_id: str, organizer_user_id: str) -> dict:
    """Fetch and parse the latest transcript for a Teams meeting.

    Step 1 — List transcripts::

        GET /users/{organizer_user_id}/onlineMeetings/{meetingId}/transcripts

    Step 2 — Download VTT content::

        GET /users/{organizer_user_id}/onlineMeetings/{meetingId}/
            transcripts/{transcriptId}/content?$format=text/vtt

    Args:
        teams_meeting_id: The onlineMeetingId stored in interview_schedules.
        organizer_user_id: TEAMS_ORGANIZER_USER_ID from env / caller.

    Returns:
        On success::

            {
                "vtt_raw": "<raw VTT string>",
                "parsed_text": "<clean dialogue>",
                "fetched_at": "<ISO 8601 UTC timestamp>",
            }

        When the transcript is not yet available (404 or empty list)::

            {
                "status": "not_ready",
                "message": "Transcript not yet available. Teams takes 5–10 minutes after meeting ends.",
            }

    Raises:
        ValueError: If any required TEAMS_* env var is missing.
        RuntimeError: If the Graph API returns an unexpected non-404 error.
    """
    # Validate env vars — raises ValueError with a clear message on missing vars
    _required_env("TEAMS_TENANT_ID")
    _required_env("TEAMS_CLIENT_ID")
    _required_env("TEAMS_CLIENT_SECRET")
    if not organizer_user_id or not organizer_user_id.strip():
        raise ValueError(
            "Teams configuration is incomplete: 'organizer_user_id' is empty. "
            "Ensure TEAMS_ORGANIZER_USER_ID is set in your .env file."
        )

    token = get_access_token()
    headers = {"Authorization": f"Bearer {token}"}

    # ---- Step 1: list transcripts ----------------------------------------
    list_url = (
        f"{GRAPH_BASE_URL}/users/{organizer_user_id}"
        f"/onlineMeetings/{teams_meeting_id}/transcripts"
    )
    list_resp = requests.get(list_url, headers=headers, timeout=30)

    if list_resp.status_code == 404:
        logger.info(
            "Teams transcript not ready for meeting %s (404 on list)",
            teams_meeting_id,
        )
        return {
            "status": "not_ready",
            "message": "Transcript not yet available. Teams takes 5–10 minutes after meeting ends.",
        }

    if list_resp.status_code != 200:
        raise RuntimeError(
            f"Teams transcript list failed: {list_resp.status_code} — {list_resp.text}"
        )

    transcripts = list_resp.json().get("value", [])
    if not transcripts:
        logger.info(
            "Teams transcript list is empty for meeting %s", teams_meeting_id
        )
        return {
            "status": "not_ready",
            "message": "Transcript not yet available. Teams takes 5–10 minutes after meeting ends.",
        }

    # Pick the latest transcript by createdDateTime
    def _parse_dt(ts: str) -> datetime:
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:
            return datetime.min.replace(tzinfo=timezone.utc)

    latest = max(transcripts, key=lambda t: _parse_dt(t.get("createdDateTime", "")))
    transcript_id = latest["id"]

    # ---- Step 2: download VTT content ------------------------------------
    content_url = (
        f"{GRAPH_BASE_URL}/users/{organizer_user_id}"
        f"/onlineMeetings/{teams_meeting_id}"
        f"/transcripts/{transcript_id}/content?$format=text/vtt"
    )
    content_resp = requests.get(content_url, headers=headers, timeout=60)

    if content_resp.status_code == 404:
        logger.info(
            "Teams transcript content not ready for meeting %s transcript %s",
            teams_meeting_id,
            transcript_id,
        )
        return {
            "status": "not_ready",
            "message": "Transcript not yet available. Teams takes 5–10 minutes after meeting ends.",
        }

    if content_resp.status_code != 200:
        raise RuntimeError(
            f"Teams transcript content fetch failed: "
            f"{content_resp.status_code} — {content_resp.text}"
        )

    vtt_raw = content_resp.text
    parsed_text = parse_vtt(vtt_raw)
    fetched_at = datetime.now(timezone.utc).isoformat()

    return {
        "vtt_raw": vtt_raw,
        "parsed_text": parsed_text,
        "fetched_at": fetched_at,
    }

