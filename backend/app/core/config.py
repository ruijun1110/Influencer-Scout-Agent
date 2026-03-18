from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    tikhub_api_key: str = ""
    anthropic_api_key: str = ""
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    cors_origins: str = "http://localhost:5173"

    class Config:
        env_file = "backend/.env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
