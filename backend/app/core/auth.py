from fastapi import Depends, HTTPException, Request
from supabase import create_client
from app.core.config import get_settings, Settings


def get_supabase(settings: Settings = Depends(get_settings)):
    """Get Supabase client with service role key (bypasses RLS)."""
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


async def get_current_user(request: Request, settings: Settings = Depends(get_settings)):
    """Verify Supabase JWT from Authorization header and return user ID."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")

    token = auth_header.split(" ", 1)[1]

    # Use a client-level auth verification
    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    try:
        user_response = client.auth.get_user(token)
        if not user_response or not user_response.user:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user_response.user
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
