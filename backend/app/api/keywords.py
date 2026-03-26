from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.core.auth import get_current_user
from app.core.config import get_settings, Settings

router = APIRouter()


class GenerateRequest(BaseModel):
    persona: str
    existing_keywords: list[str] = []


@router.post("/generate")
async def generate_keywords(
    body: GenerateRequest,
    user=Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    """Generate keyword suggestions using Claude API."""
    if not settings.anthropic_api_key:
        raise HTTPException(400, "Anthropic API key not configured on server")

    import anthropic

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    existing = ", ".join(body.existing_keywords) if body.existing_keywords else "none"

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": (
                f"Generate 8-10 TikTok search keywords for finding influencers "
                f"matching this persona: {body.persona}\n\n"
                f"Existing keywords (do not repeat): {existing}\n\n"
                f"Return ONLY a JSON array of keyword strings, nothing else. "
                f"Keywords should be short (1-3 words), specific to TikTok content."
            ),
        }],
    )

    import json
    import logging
    import re
    _log = logging.getLogger(__name__)

    raw_text = message.content[0].text.strip()
    _log.info("keyword generation raw response: %s", raw_text[:500])

    # Strip markdown code block wrapper if present (```json ... ``` or ``` ... ```)
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw_text)
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()

    try:
        keywords = json.loads(cleaned)
        if not isinstance(keywords, list):
            _log.warning("keyword generation: response is not a list: %s", type(keywords))
            keywords = []
        # Ensure all items are strings
        keywords = [str(k) for k in keywords if isinstance(k, str)]
    except (json.JSONDecodeError, IndexError) as e:
        _log.error("keyword generation: failed to parse JSON: %s — raw: %s", e, raw_text[:200])
        keywords = []

    return {"keywords": keywords}
