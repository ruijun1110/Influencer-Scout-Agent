# Database Design

## Overview

PostgreSQL via Supabase. 10 tables with RLS enabled on all. UUID primary keys with `gen_random_uuid()`. All tables have `created_at timestamptz DEFAULT now()`.

## Entity Relationship

```
profiles (auth sync)
  ├── campaigns (owner_id → profiles.id)
  │     ├── campaign_creators (campaign_id → campaigns.id)
  │     │     └── creators (creator_id → creators.id)  [shared pool]
  │     ├── keywords (campaign_id → campaigns.id)
  │     ├── scout_batches (campaign_id → campaigns.id)
  │     │     ├── tasks (task_id → tasks.id)
  │     │     └── scout_presets (preset_id → scout_presets.id)
  │     ├── scout_presets (campaign_id → campaigns.id)
  │     └── outreach_log (campaign_id → campaigns.id, creator_id → creators.id)
  ├── tasks (user_id → profiles.id)
  └── user_email_config (user_id → profiles.id)
```

## Tables

### `profiles`
Auth sync table. Row created automatically when a user signs up (via Supabase trigger).

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid PK | NO | = auth.users.id |
| email | text | NO | |
| display_name | text | YES | |
| role | text | NO | DEFAULT 'member'. CHECK: admin, member |
| created_at | timestamptz | NO | |

### `campaigns`
One campaign per influencer outreach initiative.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid PK | NO | |
| name | text | NO | |
| persona | text | YES | Target influencer description (used for AI keyword generation) |
| owner_id | uuid FK→profiles | NO | |
| created_at | timestamptz | NO | |

### `creators`
**Shared pool** — one row per TikTok handle across all campaigns. Updated on every scout run via upsert (`ON CONFLICT handle`).

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid PK | NO | |
| handle | text UNIQUE | NO | TikTok @handle |
| profile_url | text | YES | Full TikTok profile URL |
| cover_url | text | YES | Profile avatar URL |
| followers | integer | YES | DEFAULT 0 |
| avg_views | integer | YES | DEFAULT 0. Computed from recent videos |
| bio | text | YES | |
| bio_link | text | YES | Link-in-bio URL |
| emails | text[] | YES | DEFAULT '{}'. Extracted from bio + bio_link scraping |
| tier | text | YES | |
| sec_uid | text | YES | TikHub internal ID (needed for similar user API) |
| nickname | text | YES | |
| country_code | text | YES | ISO 3166-1 alpha-2 |
| total_likes | bigint | YES | DEFAULT 0 |
| video_count | integer | YES | DEFAULT 0 |
| following_count | integer | YES | DEFAULT 0 |
| verified | boolean | YES | DEFAULT false |
| engagement_rate | numeric | YES | DEFAULT 0. `sum(likes) / sum(views)` across recent videos |
| median_views | integer | YES | DEFAULT 0 |
| tcm_id | text | YES | TikTok Creator Marketplace ID |
| tcm_link | text | YES | TCM profile link |
| raw_videos | jsonb | YES | DEFAULT '[]'. Top 3 videos: `[{video_id, desc, play_count, digg_count, cover_url}]` |
| raw_profile | jsonb | YES | DEFAULT '{}'. Full TikHub profile response (debug) |
| created_at | timestamptz | NO | |

**Design decision:** Creators are a shared pool (not per-campaign) because the same influencer may appear in multiple campaigns. Campaign-specific data (status, source, preview) lives in `campaign_creators`.

### `campaign_creators`
Join table linking creators to campaigns. One creator per campaign (unique on `campaign_id + creator_id`).

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid PK | NO | |
| campaign_id | uuid FK→campaigns | NO | |
| creator_id | uuid FK→creators | NO | |
| status | text | NO | DEFAULT 'unreviewed'. CHECK: unreviewed, approved, rejected |
| source_type | text | NO | 'search' or 'similar' |
| source_keyword | text | YES | Keyword that found this creator |
| source_handle | text | YES | Handle of seed creator (for similar source) |
| source_creator_id | uuid FK→creators | YES | Creator ID of seed (for similar source) |
| batch_id | uuid | YES | Links to scout_batches.id |
| preview_image_url | text | YES | Video thumbnail for discover card |
| trigger_video_url | text | YES | TikTok video URL for click-to-play |
| created_at | timestamptz | NO | |
| updated_at | timestamptz | NO | |

**Unique constraint:** `cc_campaign_creator_unique` on `(campaign_id, creator_id)` — prevents duplicate creator in same campaign. Backend uses `ON CONFLICT` upsert.

### `keywords`
Search keywords per campaign.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid PK | NO | |
| campaign_id | uuid FK→campaigns | NO | |
| keyword | text | NO | |
| source | text | NO | DEFAULT 'manual'. Values: manual, ai |
| created_at | timestamptz | NO | |

### `tasks`
Async task tracking for scout runs and outreach batches. Realtime-enabled (Supabase postgres_changes).

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid PK | NO | |
| campaign_id | uuid FK→campaigns | NO | |
| user_id | uuid FK→profiles | NO | |
| type | text | NO | CHECK: scout, similar, outreach_batch |
| status | text | NO | DEFAULT 'queued'. CHECK: queued, running, completed, failed, partial |
| progress | integer | YES | DEFAULT 0. Current item count |
| total | integer | YES | DEFAULT 0. Total items to process |
| error | text | YES | Error message on failure |
| meta | jsonb | YES | DEFAULT '{}'. `{source_type, source_params, result_count}` |
| created_at | timestamptz | NO | |
| updated_at | timestamptz | NO | |

**Realtime:** Frontend subscribes to INSERT/UPDATE on this table via Supabase channel. Progress updates are batched (every 5 items, not per-item).

### `scout_batches`
Batch metadata for each scout run. Links to a task and preserves the preset configuration at execution time.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid PK | NO | |
| campaign_id | uuid FK→campaigns | NO | |
| source_type | text | NO | keyword_video, keyword_creator, similar |
| source_params | jsonb | NO | DEFAULT '{}'. `{keywords[], max_results, country}` |
| preset_id | uuid FK→scout_presets | YES | |
| preset_snapshot | jsonb | YES | Frozen copy of filters at execution time |
| task_id | uuid FK→tasks | YES | |
| creator_count | integer | NO | DEFAULT 0. Updated on completion |
| name | text | YES | User-provided or auto-generated batch name |
| dismissed_at | timestamptz | YES | Soft-delete for clearing completed/failed tasks from UI |
| created_at | timestamptz | NO | |

### `scout_presets`
Reusable filter configurations per campaign.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid PK | NO | |
| campaign_id | uuid FK→campaigns | NO | |
| name | text | NO | DEFAULT 'Preset' |
| is_default | boolean | NO | DEFAULT false |
| filters | jsonb | NO | DEFAULT '{}'. `{followers: {min, max}, avg_views: {min, max}, engagement_rate: {min, max}, has_email: bool, ...}` |
| created_at | timestamptz | NO | |
| updated_at | timestamptz | NO | |

### `outreach_log`
Audit trail for sent emails. Read-only from frontend (no INSERT/UPDATE RLS).

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid PK | NO | |
| campaign_id | uuid FK→campaigns | NO | |
| creator_id | uuid FK→creators | NO | |
| email | text | NO | Recipient email |
| subject | text | NO | |
| status | text | NO | DEFAULT 'pending'. Values: pending, sent, failed |
| error | text | YES | |
| sent_at | timestamptz | YES | |
| note | text | YES | User notes |
| note_tag | text | YES | |
| created_at | timestamptz | NO | |

### `user_email_config`
Per-user email provider config. One row per user (unique on `user_id`).

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid PK | NO | |
| user_id | uuid FK→profiles UNIQUE | NO | |
| provider | text | NO | CHECK: gmail, outlook, smtp |
| credentials_encrypted | jsonb | NO | DEFAULT '{}'. Gmail: `{access_token, refresh_token, expiry}`. SMTP: `{host, port, username, password}` |
| gmail_email | text | YES | Connected Gmail address |
| created_at | timestamptz | NO | |
| updated_at | timestamptz | YES | |

## Row Level Security (RLS)

All tables have RLS enabled. Two helper functions:
- `is_admin()` — checks `profiles.role = 'admin'` for `auth.uid()`
- `owns_campaign(cid)` — checks campaign ownership

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| **profiles** | own or admin | — | own | — |
| **campaigns** | own or admin | own | own | own |
| **campaign_creators** | owns_campaign or admin | owns_campaign | owns_campaign | owns_campaign |
| **creators** | authenticated | authenticated | authenticated | — |
| **keywords** | owns_campaign or admin | owns_campaign | owns_campaign | owns_campaign |
| **tasks** | own or admin | own | own (with_check) | — |
| **scout_batches** | authenticated (permissive) | authenticated | authenticated | — |
| **scout_presets** | authenticated (permissive) | authenticated | authenticated | — |
| **outreach_log** | owns_campaign or admin | — | — | — |
| **user_email_config** | own | own | own | own |

**Known issue:** `scout_batches` and `scout_presets` have overly permissive RLS (`qual: true`). Should be restricted to `owns_campaign(campaign_id)`. Low priority since all users currently share campaigns.

## Upsert Patterns

| Table | Conflict Column(s) | Used By |
|-------|-------------------|---------|
| `creators` | `handle` | `_enrich_and_upsert_creator()` — updates metrics on re-scout |
| `campaign_creators` | `(campaign_id, creator_id)` | Same — prevents duplicate creator per campaign |
| `user_email_config` | `user_id` | Gmail OAuth exchange — insert or update |

## JSONB Column Conventions

- `raw_videos`: Normalized top 3 array: `[{video_id, desc, play_count, digg_count, cover_url}]`
- `raw_profile`: Full TikHub response (debug only, not used by frontend)
- `source_params`: Varies by source type. Always `{keywords?: string[], max_results?: number, country?: string, creator_id?: string, creator_handle?: string}`
- `preset_snapshot`: Frozen copy of `filters` at batch creation time
- `filters`: `{followers?: {min, max}, avg_views?: {min, max}, engagement_rate?: {min, max}, total_likes?: {min, max}, video_count?: {min, max}, has_email?: boolean}`
- `meta` (tasks): `{source_type, source_params, result_count}`
- `credentials_encrypted`: Shape depends on `provider`. Gmail: `{access_token, refresh_token, expiry}`. SMTP: `{host, port, username, password}`

## Migration Naming

Files in `sql/migrations/` follow: `YYYYMMDD_description.sql`

Applied via Supabase SQL Editor or `mcp__supabase__apply_migration`.
