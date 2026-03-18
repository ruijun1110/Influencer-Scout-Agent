# PRD: Scout Redesign — Multi-Source Discovery, Batches, Presets

## Goal

Redesign the scout system from a keyword-pipeline model to a flexible multi-source discovery system with configurable filter presets, batch tracking, and richer creator metrics. Store all data; filter at display time.

---

## Current Database Schema (Reference)

```sql
campaigns (
  id uuid PK,
  name text,
  persona text,
  min_followers integer,          -- TO BE REMOVED
  min_avg_views integer,          -- TO BE REMOVED
  recent_video_count integer,     -- TO BE REMOVED
  max_results_per_keyword integer,-- TO BE REMOVED
  owner_id uuid → auth.users,
  created_at timestamptz
)

keywords (
  id uuid PK,
  campaign_id uuid → campaigns,
  keyword text,
  status text,          -- TO BE REMOVED (pending|searched|paused)
  source text,          -- manual|ai
  result_count integer, -- TO BE REMOVED
  created_at timestamptz
)

creators (
  id uuid PK,
  handle text UNIQUE,
  profile_url text,
  cover_url text,
  followers integer,
  avg_views integer,
  bio text,
  bio_link text,
  emails text[],
  sec_uid text,
  tier text,
  created_at timestamptz,
  updated_at timestamptz
)

campaign_creators (
  id uuid PK,
  campaign_id uuid → campaigns,
  creator_id uuid → creators,
  status text,              -- unreviewed|approved|rejected
  source_type text,         -- search|similar
  source_keyword text,
  source_creator_id uuid,
  source_handle text,
  created_at timestamptz,
  updated_at timestamptz,
  UNIQUE(campaign_id, creator_id)
)

tasks (
  id uuid PK,
  campaign_id uuid → campaigns,
  user_id uuid → auth.users,
  type text,                -- scout|similar|outreach_batch
  status text,              -- queued|running|completed|failed|partial
  progress integer,
  total integer,
  meta jsonb,
  error text,
  created_at timestamptz,
  updated_at timestamptz
)

outreach_log (
  id uuid PK,
  campaign_id uuid → campaigns,
  creator_id uuid → creators,
  email text,
  subject text,
  body text,
  status text,              -- sent|failed|pending
  error text,
  sent_at timestamptz,
  created_at timestamptz
)

user_email_config (
  id uuid PK,
  user_id uuid → auth.users UNIQUE,
  provider text,            -- smtp|gmail|outlook
  credentials_encrypted jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
```

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Filter timing | Display-time only | API cost is per-call not per-result; re-filtering is free; thresholds change |
| Preset scope | Per-campaign | Different campaigns target different creator profiles |
| Keyword model | Flat dictionary (no status) | Keywords serve discover page for scouting + filtering; no pipeline |
| Batch tracking | `scout_batches` table | Groups creators by scout run; enables batch-level filtering |
| Creator storage | Store ALL available metrics | Maximize value per API call; enable future filtering without re-scouting |
| Preset at scout time | Stored as snapshot on batch | Records what criteria the user intended, but does NOT exclude results |
| Presets at display time | Applied as live filter on discover page | User can switch presets to see different slices |
| "Show all" toggle | Bypasses preset filter, dims non-matching | Users never lose data; non-matching creators visually distinct |

---

## TikHub API Usage Plan

### Endpoints Used

| # | Endpoint | When | Data Captured |
|---|----------|------|---------------|
| 1 | `GET /api/v1/tiktok/ads/search_creators` | Keyword scout (creator source) | nick_name, user_id, avatar_url, country_code, follower_cnt, liked_cnt, tt_link, tcm_id, tcm_link, items[]{item_id, cover_url, tt_link, vv, liked_cnt, create_time} |
| 2 | `GET /api/v1/tiktok/web/fetch_search_video` | Keyword scout (video source) | Per video: author{uniqueId, secUid}, stats{playCount, diggCount, shareCount, commentCount}, video{id, desc, createTime, hashtags} |
| 3 | `GET /api/v1/tiktok/web/fetch_user_profile` | Enrich (all sources) | user{uniqueId, secUid, signature, bioLink, avatarLarger, verified, privateAccount, region}, stats{followerCount, followingCount, heartCount, videoCount, diggCount} |
| 4 | `GET /api/v1/tiktok/app/v3/fetch_user_post_videos` | Enrich (video source only, when items[] not available) | Per video: stats{playCount, diggCount, shareCount, commentCount}, createTime |
| 5 | `GET /api/v1/tiktok/app/v3/fetch_similar_user_recommendations` | Similar creator source | List of user dicts with unique_id |
| 6 | HTTP scrape of bio_link URL | Email extraction (all sources) | Emails via regex |

### Call Optimization

**Creator search path** (per keyword):
- 1 call to `search_creators` → up to 20 creators with recent videos included
- 1 call to `fetch_user_profile` per creator → bio, bio_link, sec_uid, full stats
- 1 scrape per creator → emails
- **Total: 1 + N + N calls per keyword** (N = creators found)
- **Eliminated**: `fetch_user_post_videos` — videos come from search_creators response

**Video search path** (per keyword):
- 1 call to `fetch_search_video` → up to 20 video items
- 1 call to `fetch_user_profile` per unique creator
- 1 call to `fetch_user_post_videos` per creator (for avg_views computation)
- 1 scrape per creator → emails
- **Total: 1 + N + N + N calls per keyword**

**Similar path** (per creator):
- 1 call to `fetch_similar_user_recommendations`
- 1 call to `fetch_user_profile` per similar creator
- 1 scrape per creator → emails
- **Total: 1 + N + N calls**

### Data Extraction: Capture Everything

From `search_creators` response, store ALL of:
```
tcm_id, user_id, nick_name, avatar_url, country_code,
follower_cnt, liked_cnt, tt_link, tcm_link,
items[] → compute avg_views, median_views, engagement_rate
items[] → store as raw_videos jsonb for per-video display
```

From `fetch_user_profile` response, store ALL of:
```
signature (→ bio), bioLink.link (→ bio_link), secUid (→ sec_uid),
avatarLarger (→ cover_url), verified, privateAccount, region,
stats.followerCount, stats.followingCount, stats.heartCount,
stats.videoCount, stats.diggCount
```

**Computed metrics** (stored on creators table):
```
avg_views = mean(items[].vv)  -- exclude outliers if needed in future
median_views = median(items[].vv)
engagement_rate = mean((items[].liked_cnt + estimated_comments) / items[].vv)
```

---

## Schema Changes

### New: `scout_presets`
```sql
CREATE TABLE scout_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Preset',
  is_default boolean NOT NULL DEFAULT false,
  filters jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- filters jsonb shape:
-- {
--   "followers":       { "min": 5000, "max": 100000 },
--   "avg_views":       { "min": 1000, "max": null },
--   "engagement_rate": { "min": 0.02, "max": null },
--   "total_likes":     { "min": null, "max": null },
--   "video_count":     { "min": 10,   "max": null },
--   "has_email":       true,
--   "country":         "US"
-- }
-- All fields optional. null min/max = no bound.
```

### New: `scout_batches`
```sql
CREATE TABLE scout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source_type text NOT NULL,            -- 'keyword_creator'|'keyword_video'|'similar'
  source_params jsonb NOT NULL DEFAULT '{}',
  -- source_params shape:
  --   keyword sources: { "keywords": [...], "country": "US", "sort_by": "follower" }
  --   similar source:  { "creator_id": "uuid", "creator_handle": "@name" }
  preset_id uuid REFERENCES scout_presets(id) ON SET NULL,
  preset_snapshot jsonb,                -- frozen copy of preset filters at batch creation
  task_id uuid REFERENCES tasks(id),
  creator_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### Alter: `creators` — add metrics columns
```sql
ALTER TABLE creators
  ADD COLUMN IF NOT EXISTS nickname text,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS total_likes bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS following_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS engagement_rate numeric(6,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS median_views integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tcm_id text,
  ADD COLUMN IF NOT EXISTS tcm_link text,
  ADD COLUMN IF NOT EXISTS raw_videos jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS raw_profile jsonb DEFAULT '{}';
```

### Alter: `campaign_creators` — add batch_id
```sql
ALTER TABLE campaign_creators
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES scout_batches(id);
```

### Alter: `keywords` — simplify to dictionary
```sql
ALTER TABLE keywords
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS result_count;
-- Remaining: id, campaign_id, keyword, source, created_at
```

### Alter: `campaigns` — remove threshold fields
```sql
ALTER TABLE campaigns
  DROP COLUMN IF EXISTS min_followers,
  DROP COLUMN IF EXISTS min_avg_views,
  DROP COLUMN IF EXISTS recent_video_count,
  DROP COLUMN IF EXISTS max_results_per_keyword;
-- Remaining: id, name, persona, owner_id, created_at, updated_at
```

### Alter: `outreach_log` — add notes
```sql
ALTER TABLE outreach_log
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS note_tag text;
-- note_tag values: 'replied'|'bounced'|'interested'|'declined'|null
-- note: free-text for custom annotations
```

---

## Backend Changes

### Modified: `POST /api/scout/search` → unified scout endpoint
```
POST /api/scout/run
Body: {
  campaign_id: string,
  source_type: "keyword_creator" | "keyword_video" | "similar",
  source_params: {
    keywords?: string[],
    creator_id?: string,
    creator_handle?: string,
    country?: string,
    sort_by?: "follower" | "avg_views",
    max_results?: number
  },
  preset_id?: string
}
Response: { task_id: string, batch_id: string }
```

**Logic:**
1. Look up preset by preset_id (if provided), snapshot its filters
2. Create `scout_batches` row
3. Create `tasks` row
4. Launch background task
5. Return both IDs

### Modified: Background task `run_scout`
```
For keyword_creator:
  For each keyword in source_params.keywords:
    Call search_creators(keyword, country, sort_by, limit)
    For each creator in response:
      Compute avg_views, median_views, engagement_rate from items[]
      Call fetch_user_profile(handle) → bio, bio_link, sec_uid, full stats
      Scrape bio_link → emails
      Upsert creators with ALL fields
      Upsert campaign_creators with batch_id, source_type, source_keyword
    Update batch creator_count

For keyword_video:
  Same as current run_scout but:
    Fix: call parse_profile_fields_with_avg_views (not parse_profile_fields)
    Capture ALL video stats (digg, share, comment counts)
    Store raw_videos jsonb
    Link with batch_id

For similar:
  Same as current run_similar but:
    Link with batch_id
    Capture source_handle on campaign_creators
```

### New: TikHub service function
```python
async def search_creators(keyword, country="US", sort_by="follower", limit=20, page=1) -> list[dict]:
    resp = await client.get(
        f"{TIKHUB_BASE}/tiktok/ads/search_creators",
        params={"keyword": keyword, "page": page, "limit": limit,
                "sort_by": sort_by, "creator_country": country},
        headers=_headers(),
    )
    data = resp.json()
    inner = data.get("data", {})
    if isinstance(inner, dict):
        inner = inner.get("data", {})
    return inner.get("creators", [])
```

### New: Parse function for creator search results
```python
def parse_creator_search_result(creator: dict) -> dict:
    items = creator.get("items", [])
    views = [item.get("vv", 0) for item in items if item.get("vv", 0) > 0]
    likes = [item.get("liked_cnt", 0) for item in items]
    avg_v = round(sum(views) / len(views)) if views else 0
    median_v = sorted(views)[len(views)//2] if views else 0
    eng_rate = round(sum(likes) / sum(views), 4) if sum(views) > 0 else 0

    return {
        "handle": "",  # Not in search_creators — resolved via fetch_user_profile
        "nickname": creator.get("nick_name", ""),
        "cover_url": creator.get("avatar_url", ""),
        "country_code": creator.get("country_code", ""),
        "followers": creator.get("follower_cnt", 0),
        "total_likes": creator.get("liked_cnt", 0),
        "profile_url": creator.get("tt_link", ""),
        "tcm_id": creator.get("tcm_id", ""),
        "tcm_link": creator.get("tcm_link", ""),
        "avg_views": avg_v,
        "median_views": median_v,
        "engagement_rate": eng_rate,
        "raw_videos": items,
        "user_id_tikhub": creator.get("user_id", ""),
    }
```

### Presets: Direct Supabase (no backend routes)
Frontend manages presets via direct Supabase client calls (same pattern as current campaign settings, keyword management). No backend API needed.

### Removed endpoints
- `POST /api/scout/search` (replaced by `/api/scout/run`)
- `POST /api/scout/similar` (merged into `/api/scout/run`)

---

## Frontend Changes

### Settings Tab (`settings-tab.tsx`)

**Remove:**
- Campaign Name field (keep, it stays)
- Target Persona field (keep)
- Min Followers, Min Avg Views, Recent Video Count, Max Results per Keyword fields
- All related state and form logic

**Add: Scout Presets section**
- New `<Card>` titled "Scout Presets"
- List of presets: name, summary of ranges, is_default badge
- Each row: edit (inline or modal), delete, set as default
- "New Preset" button
- Preset editor form:
  - Name (text input)
  - Range inputs for each metric (min/max number inputs side by side):
    - Followers
    - Avg Views
    - Engagement Rate (%)
    - Total Likes
    - Video Count
  - Has Email toggle (yes/no/any)
  - Country dropdown (optional)
  - Is Default checkbox
  - Save / Cancel

### Keywords Tab (`keywords-tab.tsx`)

**Remove:**
- Status column from table
- Result count column from table
- Status badge rendering
- Scout button (play icon per keyword)
- "Scout all pending" button
- Pause/resume actions
- All status-related state and functions (`scouting`, `scoutKeyword`, `scoutAllPending`, `togglePause`)
- Status sort order logic

**Keep:**
- Keyword column
- Source column (manual/ai badge)
- Delete action
- Add keyword form
- AI generate keywords dialog
- Created_at for sort

**Result:** A simple dictionary table: Keyword | Source | Added | Delete

### Discover Tab — Filter Bar (`filter-bar.tsx`)

**Remove:**
- "Below threshold" toggle
- Current source filter (keyword dropdown)

**New props:**
```tsx
interface DiscoverFilterProps {
  statusFilter: string
  setStatusFilter: (v: string) => void
  sortBy: string
  setSortBy: (v: string) => void
  batchFilter: string
  setBatchFilter: (v: string) => void
  keywordFilter: string[]
  setKeywordFilter: (v: string[]) => void
  presetFilter: string
  setPresetFilter: (v: string) => void
  showAll: boolean
  setShowAll: (v: boolean) => void
  batches: { id: string; label: string }[]
  keywords: string[]
  presets: { id: string; name: string }[]
  totalCreators: number
  onOpenScout: () => void
}
```

**Layout:**
```
[Scout button] | {count} profiles
[Status ▾] [Sort by ▾] [Preset ▾] [Batch ▾] [Keywords tag-select] [☐ Show all]
```

- Status: All / Unreviewed / Approved / Rejected
- Sort by: Newest (default) / Followers / Avg Views
- Preset: dropdown of campaign presets (applies range filters client-side)
- Batch: dropdown of scout batches (label = "Mar 17 — keyword_creator: clean beauty, skincare")
- Keywords: multi-select tag filter (from keywords dictionary)
- Show all: checkbox — when checked, bypasses preset filter, non-matching creators rendered with dimmed style

### Discover Tab — Scout Dialog (redesign)

Replace current scout dialog with:

```
┌─ Scout for Creators ──────────────────────────────┐
│                                                     │
│  Source                                             │
│  ○ Keyword (Creator Marketplace)  ← default         │
│  ○ Keyword (Video Search)                           │
│  ○ Similar to Creator                               │
│                                                     │
│  ── Source Config ──                                │
│  [If keyword source:]                               │
│    Keywords: [tag multi-select from dictionary]      │
│    Country:  [US ▾]                                 │
│    Sort by:  [Followers ▾]                          │
│    Max results per keyword: [20]                    │
│                                                     │
│  [If similar source:]                               │
│    Creator: [@handle input]                         │
│                                                     │
│  ── Filter Preset ──                                │
│  Preset: [Micro-KOL ▾] [+ New Preset]              │
│  (Shows preset ranges inline, read-only summary)    │
│  Note: Preset is saved with batch for reference     │
│  but does NOT exclude results at scout time.        │
│                                                     │
│                           [Cancel] [Start Scouting] │
└─────────────────────────────────────────────────────┘
```

### Discover Tab — Creator Cards

**Existing fields** (keep): cover image, handle, followers, avg_views, status badge, source badge, approve/similar/reject buttons

**New badge area** below handle stats:
- Batch badge: e.g. "keyword_creator · Mar 17"
- Keyword tags: e.g. "#clean beauty"
- Preset badge: e.g. "Micro-KOL"
- For similar source: "~ similar @glowwithsara" (already implemented)

**Dimmed state:** When "Show all" is checked and a creator doesn't match the active preset, render with `opacity-40 grayscale` (similar to rejected style).

### Discover Tab — Table View (new)

Add a view toggle: Card View / Table View (icon buttons in filter bar area).

Table columns:
| Handle | Followers | Avg Views | Eng Rate | Total Likes | Videos | Emails | Status | Source | Batch | Preset |
|--------|-----------|-----------|----------|-------------|--------|--------|--------|--------|-------|--------|

- Sortable columns (click header)
- Status rendered as badge
- Emails as count badge (hover for list)
- Handle links to TikTok profile
- Row click opens detail sheet (same as card click)

### Discover Tab — Data Fetching

**Current:** Single `useQuery` fetches `campaign_creators` joined with `creators`.

**New:** Same pattern but:
- Also fetch `scout_batches` for the campaign (for batch filter dropdown)
- Also fetch `scout_presets` for the campaign (for preset filter dropdown)
- Client-side filtering: apply preset ranges on the fetched creator list
- Client-side sorting: by newest/followers/avg_views

### Outreach Tab

**Outreach log table — add Note column:**
- Displays: note_tag badge (if set) + note text (truncated)
- Click/hover: popover with:
  - Tag selector: replied / bounced / interested / declined / (none)
  - Free text textarea
  - Save button
- Update via direct Supabase call

### Campaign Interface Types

**Remove from Campaign type:**
```tsx
// Remove these fields
min_followers: number
min_avg_views: number
recent_video_count: number
max_results_per_keyword: number
```

**New types:**
```tsx
interface ScoutPreset {
  id: string
  campaign_id: string
  name: string
  is_default: boolean
  filters: {
    followers?: { min?: number; max?: number }
    avg_views?: { min?: number; max?: number }
    engagement_rate?: { min?: number; max?: number }
    total_likes?: { min?: number; max?: number }
    video_count?: { min?: number; max?: number }
    has_email?: boolean
    country?: string
  }
  created_at: string
  updated_at: string
}

interface ScoutBatch {
  id: string
  campaign_id: string
  source_type: "keyword_creator" | "keyword_video" | "similar"
  source_params: Record<string, unknown>
  preset_id: string | null
  preset_snapshot: ScoutPreset["filters"] | null
  task_id: string | null
  creator_count: number
  created_at: string
}

interface CreatorWithStatus {
  // existing fields...
  // new fields:
  nickname: string | null
  country_code: string | null
  total_likes: number
  video_count: number
  following_count: number
  verified: boolean
  engagement_rate: number
  median_views: number
  tcm_id: string | null
  tcm_link: string | null
  batch_id: string | null
}
```

---

## i18n Keys to Add

New translation keys needed for all new UI elements (both en and zh):
- Scout dialog: source type labels, source config labels
- Filter bar: sort by options, batch filter, keyword filter, show all, preset
- Settings: preset section header, preset form labels, range input labels
- Outreach: note, note_tag options
- Table view: column headers

---

## Migration Order

1. Database: Add `scout_presets`, `scout_batches` tables
2. Database: Add new columns to `creators`, `campaign_creators`, `outreach_log`
3. Database: Drop columns from `keywords`, `campaigns`
4. Backend: Add `search_creators` to tikhub service
5. Backend: Rewrite scout endpoint as unified `/api/scout/run`
6. Backend: Fix `avg_views` bug (use `parse_profile_fields_with_avg_views`)
7. Backend: Capture all metrics in scout background tasks
8. Frontend: Settings tab — remove threshold fields, add presets section
9. Frontend: Keywords tab — simplify to dictionary
10. Frontend: Discover tab — new filter bar, new scout dialog
11. Frontend: Discover tab — table view
12. Frontend: Outreach tab — notes column
13. Frontend: Update all types, mock data, i18n keys
14. Frontend: Update `campaign` interface everywhere it's used

---

## Bug Fixes Included

1. **`avg_views` always 0**: `run_scout` calls `parse_profile_fields` which sets `avg_views: 0`. Should call `parse_profile_fields_with_avg_views` or compute from video items.
2. **Discarded data**: Search results contain rich video stats (digg, share, comment counts) that are currently ignored. Now captured in `raw_videos` jsonb.
3. **Discarded profile stats**: `fetch_user_profile` returns heartCount, videoCount, followingCount, diggCount that are currently ignored. Now stored.
