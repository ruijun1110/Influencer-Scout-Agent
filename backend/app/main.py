from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import get_settings
from app.api import scout, keywords, outreach

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


@app.get("/health")
async def health():
    return {"status": "ok"}
