import logging

from fastapi import FastAPI

# Show INFO from our app (e.g. tikhub.*) in the same terminal as Uvicorn.
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s | %(name)s | %(message)s",
)
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import get_settings
from app.api import scout, keywords, outreach, api_keys

settings = get_settings()

app = FastAPI(title="Influencer Scout API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scout.router, prefix="/api/scout", tags=["scout"])
app.include_router(keywords.router, prefix="/api/keywords", tags=["keywords"])
app.include_router(outreach.router, prefix="/api/outreach", tags=["outreach"])
app.include_router(api_keys.router, prefix="/api/api-keys", tags=["api-keys"])


@app.get("/health")
async def health():
    return {"status": "ok"}
