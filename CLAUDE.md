# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Influencer Scout is a tool for discovering TikTok KOLs, extracting contact info, finding similar creators, and sending bulk outreach emails. It has two interfaces:

1. **Web App** (primary) — React + FastAPI + Supabase
2. **CLI Agent Skills** (legacy) — Python scripts orchestrated by an AI agent

## Quick Start

```bash
./setup.sh          # One-time: installs deps, creates .env
cd backend && uv run uvicorn app.main:app --reload   # Backend on :8000
cd web && npm run dev                                  # Frontend on :5173
```

### Environment Variables

Backend `.env` (in `backend/`):
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=eyJ...
TIKHUB_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_CLIENT_ID=...apps.googleusercontent.com    # Gmail OAuth
GOOGLE_CLIENT_SECRET=GOCSPx-...                     # Gmail OAuth
```

Frontend uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (in `web/.env`).

## Web App Architecture

### Frontend (`web/src/`)

React + TypeScript + Vite + shadcn/ui + Tailwind + React Query + Supabase JS client.

| Path | Purpose |
|------|---------|
| `pages/campaign.tsx` | Campaign page — renders tab based on `?tab=` param |
| `components/campaign/discover-tab.tsx` | Creator discovery: scout dialog, card/table views, detail sheet |
| `components/campaign/keywords-tab.tsx` | Keyword management |
| `components/campaign/outreach-tab.tsx` | Email template editor + send flow |
| `components/campaign/settings-tab.tsx` | Campaign config, presets, Gmail OAuth |
| `components/task-tracker.tsx` | Task list with status tabs (active/completed/failed) |
| `hooks/use-tasks.ts` | Supabase realtime for tasks + polling + toast notifications |
| `lib/invalidation.ts` | Shared React Query cache invalidation |
| `lib/i18n.tsx` | Bilingual (EN/ZH) translations |
| `lib/api.ts` | `apiCall()` wrapper — injects Supabase JWT |

**Data flow patterns:**
- Simple CRUD → direct Supabase client (RLS enforced)
- Operations needing server logic (scout, keyword generation, email) → FastAPI backend via `apiCall()`
- Realtime updates → Supabase postgres_changes on `tasks` table
- Cache invalidation → `invalidateCampaignData()` after mutations across tabs

### Backend (`backend/app/`)

FastAPI + Supabase Python SDK (PostgREST) + httpx.

| Path | Purpose |
|------|---------|
| `api/scout.py` | POST `/api/scout/run` — dispatches background scout tasks |
| `api/keywords.py` | POST `/api/keywords/generate` — AI keyword generation |
| `api/outreach.py` | Email send + Gmail OAuth endpoints |
| `services/tikhub.py` | TikHub API client: search, profiles, videos, similar users |
| `services/enrich.py` | Bio link scraping, email extraction |
| `services/gmail.py` | Gmail OAuth flow, token management, email sending |
| `core/auth.py` | Supabase JWT validation, user extraction |
| `core/config.py` | Pydantic settings from `.env` |
| `core/campaign_access.py` | Campaign ownership checks |

**Key patterns:**
- All endpoints require `Depends(get_current_user)` (JWT auth)
- Data mutations require `Depends(get_supabase)` (user's JWT passed to PostgREST for RLS)
- Background tasks use `BackgroundTasks` for scout processing
- TikHub API calls are rate-limited at 1 req/s via `RateLimiter` class
- Scout processing uses `asyncio.gather` with `Semaphore(3)` for concurrent creator enrichment

### Database (Supabase / PostgreSQL)

| Table | Purpose |
|-------|---------|
| `campaigns` | Campaign ownership (owner_id → profiles.id) |
| `creators` | Shared creator pool (unique by handle) |
| `campaign_creators` | Links creators to campaigns with status, source, preview |
| `keywords` | Search keywords per campaign |
| `tasks` | Async task tracking (scout, similar, outreach) |
| `scout_batches` | Batch metadata with preset snapshots |
| `scout_presets` | Reusable filter configs per campaign |
| `outreach_log` | Email send audit log |
| `user_email_config` | Per-user email provider config (Gmail tokens, SMTP creds) |
| `profiles` | Auth sync table |

**RLS:** Enabled on all tables. Campaign-owned tables use `owns_campaign(campaign_id)` function. `creators` is a shared pool (any authenticated user can read/write).

**Migrations:** `sql/migrations/` — applied via Supabase MCP or SQL editor.

## TikHub API Integration

Base URL: `https://api.tikhub.io/api/v1`

| Endpoint | Rate Limit | Used For |
|----------|-----------|----------|
| `tiktok/app/v3/fetch_video_search_result` | ~1 req/s | Video search by keyword (supports `region` param) |
| `tiktok/ads/search_creators` | ~1 req/s | Creator Marketplace search (currently disabled) |
| `tiktok/web/fetch_user_profile` | ~1 req/s | Creator profile data |
| `tiktok/app/v3/fetch_user_post_videos` | ~1 req/s | Recent videos for avg_views + engagement_rate |
| `tiktok/app/v3/fetch_similar_user_recommendations` | ~1 req/s | Similar creator discovery |

**Rate limiting:** Global `RateLimiter(rps=1.0)` in `tikhub.py` enforces 1 request/second across all TikHub calls. Video search has additional fallback logic (web → app v3) with 429 retry handling.

**Video cover URLs are temporary** — TikTok CDN URLs expire. Frontend has `onError` fallbacks on all `<img>` tags.

## Gmail OAuth

Web flow (not CLI `InstalledAppFlow`):
1. Frontend calls `GET /api/outreach/gmail/auth-url` → gets Google consent URL
2. User consents at Google → redirected to `GET /api/outreach/gmail/callback`
3. Backend exchanges code for tokens, extracts email from ID token JWT
4. Tokens stored in server-side memory (2min TTL), frontend gets a one-time `gmail_ref`
5. Frontend calls `POST /api/outreach/gmail/exchange` with the ref
6. Backend retrieves tokens, stores in `user_email_config` via user's JWT (RLS-safe)

**Security:** Tokens never appear in URLs. HMAC-signed state for CSRF protection. One-time refs expire in 2 minutes.

## CLI Agent Skills (Legacy)

Still functional for terminal-based workflows. See `.agent/skills/*/SKILL.md`.

Scripts run via `uv run .agent/skills/scout/scripts/cli.py <command>`.

## Permissions Model

`.claude/settings.json` denies agent access to `.agent/.env` and `.agent/credentials/**`. Never bypass.

## Key Conventions

- **i18n:** All user-facing strings use `t("key")` from `lib/i18n.tsx`. Add both EN and ZH.
- **Toasts:** Always use `t()` for toast messages. Position: `top-center`.
- **Cache invalidation:** Use `invalidateCampaignData(queryClient, campaignId, scopes)` after mutations.
- **Error handling:** Background tasks catch per-item errors, log warnings, continue processing.
- **Progress updates:** Batch every 5 items (not per-item) to reduce DB writes.
- **No raw SQL:** All DB access via Supabase PostgREST SDK (parameterized, RLS-enforced).
- **`data/`** is gitignored — contains PII (influencer emails) and generated files.
