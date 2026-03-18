from fastapi import APIRouter, Depends
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
    try:
        keywords = json.loads(message.content[0].text)
    except (json.JSONDecodeError, IndexError):
        keywords = []

    return {"keywords": keywords}
