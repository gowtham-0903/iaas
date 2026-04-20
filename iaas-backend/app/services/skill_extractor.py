import json
import os
import time

from openai import OpenAI


SYSTEM_PROMPT = (
    "You are a technical recruiter expert. Extract skills from job descriptions and return ONLY valid JSON. "
    "Use the same input text to produce the same normalized skills whenever possible."
)


def _build_user_prompt(jd_text: str) -> str:
    return (
        "Extract all skills from this job description. Return JSON with this exact structure and no extra text:\n"
        "{\n"
        '  "primary_skills": [\n'
        '    { "skill_name": "Python", "importance_level": "must-have", "subtopics": ["Django", "FastAPI"] }\n'
        "  ],\n"
        '  "secondary_skills": [\n'
        '    { "skill_name": "Docker", "importance_level": "nice-to-have", "subtopics": [] }\n'
        "  ],\n"
        '  "soft_skills": [\n'
        '    { "skill_name": "Leadership", "importance_level": "must-have", "subtopics": ["Team management", "Mentoring"] }\n'
        "  ]\n"
        "}\n"
        "Rules:\n"
        "- Use double quotes only.\n"
        "- Do not invent skills that are not supported by the job description.\n"
        "- Prefer the most explicit and repeated skills from the text.\n"
        "- Keep output concise and deduplicated.\n"
        "- Extract soft skills like Leadership, Communication, Mentoring, Teamwork, Problem Solving.\n"
        f"Job Description: {jd_text}"
    )


def _validate_result(payload):
    if not isinstance(payload, dict):
        return False
    if "primary_skills" not in payload or "secondary_skills" not in payload:
        return False
    # soft_skills is optional
    return True


def _normalize_result(payload):
    def normalize_item(item):
        return {
            "skill_name": (item.get("skill_name") or "").strip(),
            "importance_level": (item.get("importance_level") or "").strip() or None,
            "subtopics": sorted(
                {
                    str(subtopic).strip()
                    for subtopic in (item.get("subtopics") or [])
                    if str(subtopic).strip()
                }
            ),
        }

    normalized = {
        "primary_skills": [normalize_item(item) for item in payload.get("primary_skills") or []],
        "secondary_skills": [normalize_item(item) for item in payload.get("secondary_skills") or []],
        "soft_skills": [normalize_item(item) for item in payload.get("soft_skills") or []],
    }

    normalized["primary_skills"] = sorted(normalized["primary_skills"], key=lambda item: item["skill_name"].lower())
    normalized["secondary_skills"] = sorted(normalized["secondary_skills"], key=lambda item: item["skill_name"].lower())
    normalized["soft_skills"] = sorted(normalized["soft_skills"], key=lambda item: item["skill_name"].lower())
    return normalized


def extract_skills_from_text(jd_text: str) -> dict:
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))
    user_prompt = _build_user_prompt(jd_text)

    delays = [1, 2, 4]
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
            parsed = json.loads(content)
            if _validate_result(parsed):
                return _normalize_result(parsed)
        except Exception:
            pass

        if attempt < len(delays):
            time.sleep(delay)

    raise Exception("AI extraction failed after 3 attempts")