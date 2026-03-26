from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Repository root .env (same file Vite loads via envDir); cwd-independent.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    tikhub_api_key: str = ""
    tikhub_base_url: str = "https://api.tikhub.io/api/v1"
    anthropic_api_key: str = ""
    supabase_url: str = Field(
        ...,
        min_length=1,
        validation_alias=AliasChoices("SUPABASE_URL", "VITE_SUPABASE_URL"),
        description="Same project URL as VITE_SUPABASE_URL; use either env name.",
    )
    supabase_publishable_key: str = Field(
        ...,
        min_length=1,
        validation_alias=AliasChoices(
            "SUPABASE_PUBLISHABLE_KEY",
            "SUPABASE_ANON_KEY",
            "VITE_SUPABASE_PUBLISHABLE_KEY",
            "VITE_SUPABASE_ANON_KEY",
        ),
        description="Publishable or legacy anon key — same privilege as the browser client; PostgREST uses the user's JWT.",
    )
    cors_origins: str = "http://localhost:5173"

    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/outreach/gmail/callback"
    frontend_url: str = "http://localhost:5173"


@lru_cache
def get_settings() -> Settings:
    return Settings()
