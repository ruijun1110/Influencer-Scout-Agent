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
                "You are a TikTok search strategist. Your goal: generate search "
                "queries that will surface videos made by creators matching this persona.\n\n"
                f"Persona: {body.persona}\n\n"
                "TikTok video search matches against captions, hashtags, and audio "
                "titles — NOT creator bios. Think about what these creators actually "
                "write in their video captions and what hashtags they use.\n\n"
                "Generate 10 search queries following these rules:\n"
                "- 1-3 words each, the way TikTok users type in the search bar\n"
                "- Mix of: niche-specific terms (3-4), content format + topic combos "
                "(3-4), and trending TikTok-native terms in the niche (2-3)\n"
                "- Use community slang and TikTok-native vocabulary (GRWM, POV, haul, "
                "storytime, etc.) when relevant to the persona\n"
                "- Avoid generic terms that return millions of results (e.g. \"fashion\", \"food\")\n"
                "- Target mid-tail specificity: specific enough to find niche creators, "
                "broad enough to return results\n\n"
                f"Existing keywords (do not repeat): {existing}\n\n"
                "Return ONLY a JSON array of strings."
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
