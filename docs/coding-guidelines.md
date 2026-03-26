# Coding Guidelines

Best practices and conventions for this project. Follow these when making changes or adding features.

## General Principles

- **Keep it simple.** Don't abstract or optimize prematurely. Three similar lines > one premature abstraction.
- **Read before writing.** Always understand existing patterns before modifying code.
- **No over-engineering.** Only build what's needed now.

## Frontend (React + TypeScript)

### Data Fetching

**Use React Query for all server state:**
```tsx
const { data, isLoading } = useQuery({
  queryKey: ["campaign-creators", campaign.id, statusFilter],
  queryFn: async () => { /* supabase or apiCall */ }
})
```

**Direct Supabase for simple CRUD** (RLS handles auth):
```tsx
await supabase.from("keywords").insert({ campaign_id, keyword, source: "manual" })
```

**`apiCall()` for operations needing server logic** (scout, keyword generation, email):
```tsx
await apiCall("/api/scout/run", { method: "POST", body: JSON.stringify({...}) })
```

### Cache Invalidation

**Always invalidate after mutations.** Use the shared helper:
```tsx
import { invalidateCampaignData } from "@/lib/invalidation"
invalidateCampaignData(queryClient, campaignId, ["creators", "keywords", "presets"])
```

Scopes: `"creators"`, `"keywords"`, `"presets"`, `"batches"`, `"campaign"`

**Cross-tab consistency:** If a mutation in one tab affects data shown in another tab, invalidate the relevant scope. E.g., adding a keyword in KeywordsTab should invalidate `["keywords"]` so DiscoverTab's keyword filter updates.

### Optimistic Updates

Use for instant UI feedback on simple mutations:
```tsx
const updateMutation = useMutation({
  mutationFn: async () => { /* supabase update */ },
  onMutate: async () => {
    await queryClient.cancelQueries({ queryKey: [...] })
    queryClient.setQueriesData({ queryKey: [...] }, (old) => /* optimistic state */)
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: [...] }),
})
```

### i18n

**All user-facing strings must use `t("key")`:**
```tsx
const { t } = useLanguage()
toast.success(t("settings.gmailConnected"))
```

- Add keys to both EN and ZH sections in `lib/i18n.tsx`
- Dynamic values: `t("discover.followers", { count: formatNumber(n) })`
- Never hardcode English strings in toasts, labels, or error messages

### Toast Notifications

```tsx
import { toast } from "sonner"
toast.success(t("key"))     // Green checkmark
toast.error(t("key"))       // Red error
toast.warning(t("key"))     // Yellow warning
```

- Position: `top-center` (set in `<Toaster>`)
- Always use `t()` for messages
- For caught errors: `toast.error(e instanceof Error ? e.message : t("fallback.key"))`

### Image Error Handling

TikTok CDN URLs expire. Always add fallback:
```tsx
const [imgError, setImgError] = useState(false)
{src && !imgError ? (
  <img src={src} onError={() => setImgError(true)} />
) : (
  <PlaceholderIcon />
)}
```

### Component Patterns

- **Props over global state.** Pass data down, lift state to the nearest common parent.
- **Mutations track loading per-item** when needed (e.g., `findingSimilarId` to disable the right button).
- **Dialogs use `max-h-[80dvh] overflow-y-auto`** to prevent overflowing the screen.
- **Sticky action buttons** at bottom of scrollable panels: `sticky bottom-0 bg-gradient-to-t from-background`.

### localStorage Persistence

For user preferences that should survive page reload:
```tsx
const [viewMode, setViewMode] = useState<"card" | "table">(() => {
  return localStorage.getItem("key") === "table" ? "table" : "card"
})
// On change:
localStorage.setItem("key", value)
```

Used for: view mode, table column visibility, language preference.

## Backend (FastAPI + Python)

### Endpoint Patterns

```python
@router.post("/endpoint")
async def handler(
    body: RequestModel,
    user=Depends(get_current_user),      # JWT auth
    supabase=Depends(get_supabase),      # User's Supabase client (RLS-enforced)
    background_tasks: BackgroundTasks,    # For async work
):
```

- **Always require auth:** `Depends(get_current_user)`
- **Use user's Supabase client** for data operations (RLS applies automatically)
- **Long operations → BackgroundTasks** (scout runs, email sending)

### Database Access

**Never use raw SQL.** Always use Supabase PostgREST SDK:
```python
# Read
result = supabase.table("creators").select("*").eq("handle", handle).execute()

# Insert
supabase.table("creators").insert({...}).execute()

# Upsert (on conflict)
supabase.table("creators").upsert({...}, on_conflict="handle").execute()

# Update
supabase.table("creators").update({...}).eq("id", id).execute()
```

### Campaign Ownership

Check before any campaign mutation:
```python
from app.core.campaign_access import ensure_user_owns_campaign
ensure_user_owns_campaign(supabase, user.id, campaign_id)
```

### Error Handling in Background Tasks

```python
async def run_scout_batch(task_id, ...):
    try:
        # process items
    except Exception as e:
        logger.exception("Task %s failed", task_id)
        supabase.table("tasks").update({
            "status": "failed",
            "error": str(e)[:500],  # Truncate to avoid storing secrets
        }).eq("id", task_id).execute()
```

**Per-item resilience:** Catch errors per creator/keyword, log and continue:
```python
for keyword in keywords:
    try:
        raw = await tikhub.search_videos(keyword)
    except Exception as e:
        logger.warning("search failed for %r, skipping: %s", keyword, e)
        continue
```

### TikHub API Calls

**Always rate-limited.** The global `_rate_limiter` in `tikhub.py` ensures 1 req/s:
```python
await _rate_limiter.acquire()
resp = await client.get(url, params=params, headers=_headers(), timeout=30)
```

**Concurrent processing** with bounded concurrency:
```python
sem = asyncio.Semaphore(3)
async def process_one(item):
    async with sem:
        # TikHub calls (rate-limited internally)
        # Enrichment (not rate-limited, runs freely)
        # DB writes
await asyncio.gather(*[process_one(item) for item in items])
```

**Progress updates every 5 items** (not per-item) to reduce DB writes:
```python
processed += 1
if processed % 5 == 0 or processed == total:
    supabase.table("tasks").update({"progress": processed}).eq("id", task_id).execute()
```

### Pydantic Models

Define request/response models with sensible defaults:
```python
class ScoutRunRequest(BaseModel):
    campaign_id: str
    source_type: str
    source_params: dict
    preset_id: str | None = None
    filters: dict | None = None
    name: str | None = None
```

### Configuration

All settings in `core/config.py` via Pydantic `BaseSettings`:
```python
class Settings(BaseSettings):
    tikhub_api_key: str = ""
    google_client_id: str = ""
    # ...
    class Config:
        env_file = ".env"
```

Access via `get_settings()` (cached with `@lru_cache`).

## Database

### Migrations

- File naming: `sql/migrations/YYYYMMDD_description.sql`
- Use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Apply via Supabase MCP (`mcp__supabase__apply_migration`) or SQL Editor
- Never modify existing migrations — create new ones

### RLS Conventions

- Campaign-owned tables: use `owns_campaign(campaign_id)` function
- User-owned tables: use `user_id = auth.uid()`
- Shared tables (creators): `auth.uid() IS NOT NULL`
- Admin override: `OR is_admin()` on SELECT policies

### JSONB Columns

- Use for flexible/evolving schemas (filters, params, credentials)
- Always define the expected shape in documentation
- Access via Supabase: stored and retrieved as Python dicts automatically

### Upsert Safety

Always specify `on_conflict` to prevent duplicates:
```python
supabase.table("creators").upsert(data, on_conflict="handle").execute()
supabase.table("campaign_creators").upsert(data, on_conflict="campaign_id,creator_id").execute()
```

## Security

- **Never store secrets in DB** without encryption context. Gmail tokens are stored in `credentials_encrypted` JSONB, protected by RLS (only the owning user can read).
- **Never expose secrets in URLs.** Use one-time server-side refs for OAuth token exchange.
- **Sanitize error messages** before storing in tasks table (may contain API keys in exception text).
- **CORS** is configured in `main.py`. Only allow the frontend origin.
- **`.agent/.env` and `.agent/credentials/`** are denied in `.claude/settings.json`. Never bypass.

## Testing

No formal test suite. Manual verification approach:
- `--dry-run` for outreach testing
- "Send Test Email" button for Gmail verification
- Backend logs (`INFO`/`WARNING`/`ERROR`) for API debugging
- Supabase SQL Editor for direct data inspection
- Browser DevTools for frontend API call debugging
