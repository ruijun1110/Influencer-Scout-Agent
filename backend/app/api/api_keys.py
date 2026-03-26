import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.core.auth import get_current_user, get_supabase

logger = logging.getLogger(__name__)
router = APIRouter()


class SaveApiKeysRequest(BaseModel):
    tikhub_api_key: str


@router.get("")
async def get_api_keys(user=Depends(get_current_user), supabase=Depends(get_supabase)):
    """Get user's API key configuration (masked for display)."""
    try:
        result = supabase.table("user_api_keys").select("tikhub_api_key").eq("user_id", user.id).execute()
    except Exception:
        return {"tikhub_api_key": None, "configured": False}

    if not result.data:
        return {"tikhub_api_key": None, "configured": False}

    key = result.data[0].get("tikhub_api_key") or ""
    if not key:
        return {"tikhub_api_key": None, "configured": False}

    # Mask the key for display
    masked = key[:6] + "***" + key[-4:] if len(key) > 10 else "***"
    return {"tikhub_api_key": masked, "configured": True}


@router.post("")
async def save_api_keys(body: SaveApiKeysRequest, user=Depends(get_current_user), supabase=Depends(get_supabase)):
    """Save user's TikHub API key."""
    tikhub_key = body.tikhub_api_key.strip()
    if not tikhub_key:
        raise HTTPException(400, "API key cannot be empty")

    try:
        existing = supabase.table("user_api_keys").select("id").eq("user_id", user.id).execute()
        if existing.data:
            supabase.table("user_api_keys").update({
                "tikhub_api_key": tikhub_key,
            }).eq("user_id", user.id).execute()
        else:
            supabase.table("user_api_keys").insert({
                "user_id": user.id,
                "tikhub_api_key": tikhub_key,
            }).execute()
    except Exception as e:
        logger.exception("Failed to save API keys")
        raise HTTPException(500, f"Failed to save: {e}")

    return {"status": "saved"}
