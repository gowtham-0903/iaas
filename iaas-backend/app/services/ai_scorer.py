from __future__ import annotations
import json
import time
from datetime import datetime, timezone
from enum import Enum
from typing import Any, List

from openai import OpenAI
from pydantic import BaseModel, ValidationError
import sqlalchemy as sa

from app.extensions import db


SYSTEM_PROMPT = (
    "You are an expert technical interviewer evaluating "
    "a candidate based on an interview transcript. Return ONLY "
    "valid JSON."
)


class Recommendation(str, Enum):
    STRONG_HIRE = "STRONG_HIRE"
    HIRE = "HIRE"
    MAYBE = "MAYBE"
    NO_HIRE = "NO_HIRE"


class SkillScoreItem(BaseModel):
    skill_id: int
    skill_name: str
    score: float
    reasoning: str


class InterviewScoreResponse(BaseModel):
    overall_score: float
    skill_scores: List[SkillScoreItem]
    strengths: List[str]
    concerns: List[str]
    recommendation: Recommendation


def _build_user_prompt(transcript_text: str, jd_skills: List[dict]) -> str:
    primary_skills = [
        {"skill_id": item.get("id"), "skill_name": item.get("skill_name")}
        for item in jd_skills
        if (item.get("skill_type") or "").lower() == "primary"
    ]
    secondary_skills = [
        {"skill_id": item.get("id"), "skill_name": item.get("skill_name")}
        for item in jd_skills
        if (item.get("skill_type") or "").lower() == "secondary"
    ]

    return (
        "Evaluate this interview transcript and score the candidate against JD skills.\n\n"
        "JD Skills:\n"
        f"Primary: {json.dumps(primary_skills, ensure_ascii=True)}\n"
        f"Secondary: {json.dumps(secondary_skills, ensure_ascii=True)}\n\n"
        "Transcript:\n"
        f"{transcript_text}\n\n"
        "Instructions:\n"
        "1. Score each listed skill on a 1-10 scale using technical depth, communication clarity, and problem solving approach.\n"
        "2. Provide concise reasoning for each skill score.\n"
        "3. Identify top 3 strengths.\n"
        "4. Identify top 3 concerns.\n"
        "5. Provide an overall recommendation: STRONG_HIRE, HIRE, MAYBE, or NO_HIRE.\n"
        "6. Return ONLY valid JSON with this exact structure:\n"
        "{\n"
        "  \"overall_score\": float,\n"
        "  \"skill_scores\": [\n"
        "    {\"skill_id\": int, \"skill_name\": str, \"score\": float, \"reasoning\": str}\n"
        "  ],\n"
        "  \"strengths\": [\"string\", \"string\", \"string\"],\n"
        "  \"concerns\": [\"string\", \"string\", \"string\"],\n"
        "  \"recommendation\": \"STRONG_HIRE|HIRE|MAYBE|NO_HIRE\"\n"
        "}\n"
    )


def _save_ai_score(
    interview_id: int,
    transcript_id: int,
    report_status: str,
    parsed: Optional[InterviewScoreResponse],
    raw_response: str,
) -> None:
    generated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    insert_stmt = sa.text(
        """
        INSERT INTO ai_interview_scores
            (interview_id, transcript_id, overall_score, skill_scores, strengths, concerns,
             recommendation, ai_raw_response, generated_at, report_status)
        VALUES
            (:interview_id, :transcript_id, :overall_score, :skill_scores, :strengths, :concerns,
             :recommendation, :ai_raw_response, :generated_at, :report_status)
        ON DUPLICATE KEY UPDATE
            transcript_id = VALUES(transcript_id),
            overall_score = VALUES(overall_score),
            skill_scores = VALUES(skill_scores),
            strengths = VALUES(strengths),
            concerns = VALUES(concerns),
            recommendation = VALUES(recommendation),
            ai_raw_response = VALUES(ai_raw_response),
            generated_at = VALUES(generated_at),
            report_status = VALUES(report_status)
        """
    )

    payload = {
        "interview_id": interview_id,
        "transcript_id": transcript_id,
        "overall_score": parsed.overall_score if parsed else None,
        "skill_scores": json.dumps([item.model_dump() for item in parsed.skill_scores], ensure_ascii=True) if parsed else None,
        "strengths": json.dumps(parsed.strengths, ensure_ascii=True) if parsed else None,
        "concerns": json.dumps(parsed.concerns, ensure_ascii=True) if parsed else None,
        "recommendation": parsed.recommendation.value if parsed else None,
        "ai_raw_response": raw_response,
        "generated_at": generated_at,
        "report_status": report_status,
    }

    db.session.execute(insert_stmt, payload)
    db.session.commit()


def generate_interview_score(interview_id: int, transcript_text: str, jd_skills: List[dict]) -> dict:
    transcript_row = db.session.execute(
        sa.text(
            """
            SELECT id
            FROM interview_transcripts
            WHERE interview_id = :interview_id
            LIMIT 1
            """
        ),
        {"interview_id": interview_id},
    ).mappings().first()

    if transcript_row is None:
        return {"report_status": "FAILED", "error": "Transcript not found"}

    transcript_id = transcript_row["id"]
    client = OpenAI()
    user_prompt = _build_user_prompt(transcript_text, jd_skills)

    delays = [1, 2, 4]
    last_raw = ""

    for attempt, delay in enumerate(delays, start=1):
        try:
            completion = client.chat.completions.create(
                model="gpt-4o",
                temperature=0,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            )

            content = completion.choices[0].message.content or "{}"
            last_raw = content
            parsed_dict = json.loads(content)
            validated = InterviewScoreResponse.model_validate(parsed_dict)

            # Keep only top 3 strengths/concerns as requested.
            validated.strengths = validated.strengths[:3]
            validated.concerns = validated.concerns[:3]

            _save_ai_score(
                interview_id=interview_id,
                transcript_id=transcript_id,
                report_status="GENERATED",
                parsed=validated,
                raw_response=content,
            )

            return {
                "report_status": "GENERATED",
                "overall_score": validated.overall_score,
                "recommendation": validated.recommendation.value,
                "skill_scores_count": len(validated.skill_scores),
            }
        except (ValidationError, ValueError, KeyError, TypeError) as exc:
            last_raw = str(exc)
        except Exception as exc:
            last_raw = str(exc)

        if attempt < len(delays):
            time.sleep(delay)

    _save_ai_score(
        interview_id=interview_id,
        transcript_id=transcript_id,
        report_status="FAILED",
        parsed=None,
        raw_response=last_raw,
    )
    return {"report_status": "FAILED", "error": "AI scoring failed after retries"}
