"""Campaign ownership checks for service-role Supabase calls."""

from fastapi import HTTPException


def ensure_user_owns_campaign(supabase, user_id: str, campaign_id: str) -> None:
    """Raise 403 if campaign is missing or not owned by user_id."""
    result = (
        supabase.table("campaigns")
        .select("id")
        .eq("id", campaign_id)
        .eq("owner_id", user_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(
            status_code=403,
            detail="Forbidden: campaign not found or access denied",
        )
