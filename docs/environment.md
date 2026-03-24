# Environment Setup

## Prerequisites

- Node.js 18+ (frontend)
- Python 3.11+ with `uv` (backend)
- Supabase project (database + auth)
- TikHub API key
- Google Cloud project with Gmail API enabled (for email outreach)

## Backend (`backend/`)

Copy `.env.example` to `.env` and fill in:

```env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=eyJ...
TIKHUB_API_KEY=your_tikhub_api_key
ANTHROPIC_API_KEY=your_anthropic_key

# Gmail OAuth (optional — for email outreach)
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPx-xxx
GOOGLE_REDIRECT_URI=http://localhost:8000/api/outreach/gmail/callback
FRONTEND_URL=http://localhost:5173
```

Install and run:
```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Frontend (`web/`)

```bash
cd web
npm install
npm run dev   # http://localhost:5173
```

Environment (`.env`):
```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...
VITE_API_URL=http://localhost:8000
```

## Gmail OAuth Setup

1. Google Cloud Console → APIs & Services → Enable Gmail API
2. Credentials → Create OAuth 2.0 Client ID (Web Application type)
3. Authorized redirect URI: `http://localhost:8000/api/outreach/gmail/callback`
4. OAuth consent screen → Add scope: `https://www.googleapis.com/auth/gmail.send` (paste manually)
5. Add `openid` and `https://www.googleapis.com/auth/userinfo.email` scopes
6. Add test users while in "Testing" status

## Database Migrations

Migrations are in `sql/migrations/`. Apply via Supabase SQL Editor or MCP:
```sql
-- Run each migration file in order
```

## Ports

| Service | Port | URL |
|---------|------|-----|
| Frontend | 5173 | http://localhost:5173 |
| Backend | 8000 | http://localhost:8000 |
| Supabase | — | https://xxx.supabase.co |
