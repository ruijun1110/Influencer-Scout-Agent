from fastapi import Depends, HTTPException, Request
from supabase import create_client
from supabase.lib.client_options import SyncClientOptions as ClientOptions

from app.core.config import Settings, get_settings


def _bearer_token(request: Request) -> str:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")
    return auth_header.split(" ", 1)[1].strip()


def _anon_supabase(settings: Settings):
    """Supabase client with only the publishable key (for Auth API / get_user)."""
    return create_client(
        settings.supabase_url,
        settings.supabase_publishable_key,
        options=ClientOptions(auto_refresh_token=False, persist_session=False),
    )


async def get_current_user(request: Request, settings: Settings = Depends(get_settings)):
    """Verify Supabase JWT from Authorization header and return the auth user."""
    token = _bearer_token(request)
    client = _anon_supabase(settings)
    try:
        user_response = client.auth.get_user(token)
        if not user_response or not user_response.user:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user_response.user
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def get_supabase(
    request: Request,
    settings: Settings = Depends(get_settings),
    _user=Depends(get_current_user),
):
    """PostgREST runs as the caller's JWT; RLS must allow required operations."""
    token = _bearer_token(request)
    base = ClientOptions(auto_refresh_token=False, persist_session=False)
    headers = dict(base.headers)
    headers["Authorization"] = f"Bearer {token}"
    return create_client(
        settings.supabase_url,
        settings.supabase_publishable_key,
        options=ClientOptions(
            auto_refresh_token=False,
            persist_session=False,
            headers=headers,
        ),
    )
