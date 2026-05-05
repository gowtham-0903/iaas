import logging
import os
import time
from datetime import datetime, timedelta
from typing import Optional

import requests


logger = logging.getLogger(__name__)

GRAPH_SCOPE = "https://graph.microsoft.com/.default"
GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"
_token_cache = {"token": None, "expires_at": 0.0}


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required Teams configuration: {name}")
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
