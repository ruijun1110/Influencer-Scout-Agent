# Influencer Scout — Product Requirements Document

## Overview

A portable skill package for AI coding agents that discovers TikTok influencers by keyword, extracts contact info, finds similar creators, and sends outreach emails. Platform-agnostic — works with Claude Code, Cursor, Codex, or any agent that can run shell commands. No web app, no server. Scripts and skills only.

---

## Architecture

```
┌─────────────────────────────────┐
│     AI Agent (any platform)     │
│  • Reads skill definitions      │
│  • Coordinates workflow          │
│  • Suggests keywords from persona│
│  • Confirms outreach before send │
│  • Bilingual via model natively  │
└──────────────┬──────────────────┘
               │ uv run cli.py <command>
┌──────────────▼──────────────────┐
│     cli.py (single entry point) │
│  • scout <campaign> [keyword]   │
│  • lookup <handle_or_url>       │
│  • outreach <campaign> [--dry]  │
│  • enrich <handle>              │
│  • dashboard [campaign]         │
└──┬───────────┬──────────────┬───┘
   │           │              │
   ▼           ▼              ▼
TikHub API   Gmail API    influencers.xlsx
```

**Principle:** Agent is the brain, scripts are the hands. No AI API calls inside scripts. All intelligence comes from the agent platform.

---

## Project Structure

```
influencer-scout/
├── .agent/
│   ├── skills/
│   │   ├── scout/
│   │   │   ├── SKILL.md
│   │   │   └── scripts/
│   │   │       ├── cli.py              ← single entry point (all commands)
│   │   │       ├── scout.py            ← keyword search orchestrator
│   │   │       ├── search.py           ← TikHub keyword search
│   │   │       ├── audit.py            ← TikHub profile audit
│   │   │       ├── enrich.py           ← bio + link scraping + email extraction
│   │   │       ├── lookup.py           ← similar creator lookup
│   │   │       ├── send_email.py       ← Gmail API send
│   │   │       ├── excel.py            ← xlsx read/write helpers
│   │   │       ├── dashboard.py        ← generate HTML dashboard
│   │   │       └── requirements.txt
│   │   ├── lookup/
│   │   │   └── SKILL.md
│   │   └── outreach/
│   │       └── SKILL.md
│   ├── .env.example
│   └── credentials/                    ← Gmail credentials.json (not in repo)
├── context/
│   ├── PROJECT.md
│   └── campaigns/
│       └── _example/
│           ├── campaign.md
│           ├── keywords.md
│           └── outreach.md
├── data/                               ← gitignored
│   ├── influencers.xlsx
│   └── dashboard.html
├── setup.sh
└── README.md
```

All scripts live inside `.agent/skills/scout/scripts/`. Shared across all skills via `cli.py`.

---

## Permissions

### Project-level — `.claude/settings.json`

```json
{
  "permissions": {
    "allow": [
      "Bash(uv run *)",
      "Bash(./setup.sh)",
      "Bash(cat data/*)",
      "Read",
      "Glob",
      "Grep"
    ],
    "deny": [
      "Bash(rm *)",
      "Bash(curl *)",
      "Read(.agent/.env)",
      "Read(.agent/credentials/*)"
    ],
    "ask": [
      "Edit(/context/campaigns/**)",
      "Write(/context/campaigns/**)",
      "Bash(git push *)"
    ]
  }
}
```

### Skill-level — `allowed-tools` in SKILL.md frontmatter

**Scout:**
```yaml
---
name: scout
description: Discover TikTok influencers by keyword for a campaign
argument-hint: <campaign> [keyword]
allowed-tools: Bash(uv run */cli.py scout *), Read(/context/campaigns/**), Edit(/context/campaigns/**/keywords.md)
---
```

**Lookup:**
```yaml
---
name: lookup
description: Find creators similar to a given TikTok profile
argument-hint: <handle_or_url>
allowed-tools: Bash(uv run */cli.py lookup *)
---
```

**Outreach:**
```yaml
---
name: outreach
description: Send outreach emails to qualified influencers in a campaign
argument-hint: <campaign>
allowed-tools: Bash(uv run */cli.py outreach *), Read(/context/campaigns/**/outreach.md), Read(/data/influencers.xlsx)
---
```

Outreach skill MUST run `--dry-run` first and present output to user before sending. Agent must not run without `--dry-run` until user explicitly confirms.

---

## Skills

### 1. Scout — `/scout <campaign> [keyword]`

Discovers TikTok influencers by keyword, audits their profiles, and extracts contact info.

**Flow:**
1. Agent reads `campaign.md` for persona and config
2. If `[keyword]` provided, agent appends it to `keywords.md`
3. Agent runs: `uv run cli.py scout <campaign> [keyword]`
4. Script pipeline: search → audit → enrich → write xlsx → generate dashboard
5. Agent summarizes results

**Pipeline detail:**
- **Search:** Query TikHub API for videos matching each keyword. Extract candidate creators.
- **Audit:** For each candidate, fetch recent videos via TikHub. Check view counts against thresholds.
- **Enrich:** For each qualified influencer, extract bio, bio link, and emails (see Enrich Pipeline below).
- **Write:** All data written to `data/influencers.xlsx`.

### 2. Lookup — `/lookup <handle_or_url>`

Finds creators similar to a given TikTok profile.

**Flow:**
1. Agent parses TikTok URL to extract handle (supports full URLs and short URLs)
2. Agent runs: `uv run cli.py lookup <handle>`
3. Script: resolve handle → fetch similar creators via TikHub → enrich each → write to Similar Users sheet
4. Agent presents results

### 3. Outreach — `/outreach <campaign>`

Sends outreach emails to qualified influencers with extracted emails.

**Flow:**
1. Agent runs: `uv run cli.py outreach <campaign> --dry-run`
2. Script reads Influencers sheet (filtered by campaign, has emails), fills recipient name into outreach template, outputs drafts
3. Agent shows drafts to user for confirmation
4. User confirms → agent runs without `--dry-run`
5. Script sends to ALL emails found per influencer (single email, all addresses in To field)
6. Script logs each send to Outreach sheet

**Template:** Only `{{recipient_name}}` is a variable. Everything else in `outreach.md` is a ready-to-use brief provided by the user.

---

## Enrich Pipeline

Runs automatically at the end of both scout and lookup. Also available standalone via `cli.py enrich <handle>`.

```
1. Fetch TikHub user profile → extract bio (signature) + bio_link
2. Regex extract emails from bio text
3. If bio_link exists and domain is fetchable:
   a. HTTP GET the page (follow redirects)
   b. Regex extract emails from HTML
   c. Filter out generic addresses (noreply@, support@, etc.)
4. Store all found emails comma-separated in "emails" column
```

**Fetchable:** Linktree, hoo.be, Stan.store, Carrd.co, personal websites
**Skip (blocked):** Beacons.ai (403), Instagram (auth required)

---

## Agent vs Script Responsibilities

| Task | Agent | Script |
|---|---|---|
| Suggest keywords | Reads persona, generates ideas, writes to keywords.md | — |
| Run scout | Calls `cli.py scout` | Search + audit + enrich + xlsx + dashboard |
| Run lookup | Parses URL, calls `cli.py lookup` | API + enrich + xlsx |
| Outreach | Calls `cli.py outreach --dry-run`, shows drafts, confirms | Fills recipient name in template + Gmail send + xlsx log |
| View results | Opens dashboard.html or reads xlsx | — |
| Bilingual | Handles natively via model | — |

---

## Data Model — Single xlsx

All data in `data/influencers.xlsx` with separate sheets.

### Candidates

| Column | Description |
|---|---|
| handle | TikTok username |
| triggering_video_url | Video that matched keyword search |
| triggering_play_count | View count of that video |
| keyword | Search keyword |
| campaign | Campaign name |
| audit_status | pending / qualified / rejected |

### Influencers

| Column | Description |
|---|---|
| handle | TikTok username |
| profile_url | TikTok profile URL |
| max_views | Highest views in recent videos |
| min_views | Lowest views in recent videos |
| median_views | Median views in recent videos |
| triggering_video_url | Original video that matched |
| triggering_play_count | View count of that video |
| keyword | Search keyword |
| campaign | Campaign name |
| scouted_date | Date found |
| bio | TikTok bio text |
| bio_link | Link-in-bio URL |
| emails | All extracted emails, comma-separated |
| notes | Optional notes |

### Search Log

| Column | Description |
|---|---|
| keyword | Search term |
| results_checked | Videos reviewed |
| candidates_found | Candidates before audit |
| qualified | Passed audit |
| duration_mins | Search duration |
| campaign | Campaign name |
| run_date | Date of search |

### Similar Users

| Column | Description |
|---|---|
| queried_handle | Original handle queried |
| similar_handle | Similar creator found |
| profile_url | Their TikTok URL |
| bio | Bio text |
| bio_link | Link-in-bio URL |
| emails | Extracted emails |
| lookup_date | Date of lookup |
| requested_by | Who triggered the lookup |

### Outreach

| Column | Description |
|---|---|
| handle | Creator handle |
| emails | Addresses sent to |
| subject | Email subject line |
| campaign | Campaign name |
| sent_at | Timestamp |
| status | sent / failed |

---

## Campaign Folder Format

Each campaign lives in `context/campaigns/<name>/`. Copy `_example/` to start.

### campaign.md

```yaml
persona: "Beauty brand targeting SEA micro-influencers"
view_threshold: 10000
min_video_views: 50000
recent_video_count: 10
max_candidates_per_keyword: 5
```

### keywords.md

```markdown
| keyword | status | source | date |
|---|---|---|---|
| skincare routine | pending | manual | 2026-03-10 |
| beauty tips asia | searched | ai | 2026-03-10 |
```

Status flow: `pending` → `searched`

### outreach.md

```markdown
Subject: Collaboration Opportunity with BrandX

Hi {{recipient_name}},

I came across your TikTok content and loved your style. We're a leading
beauty brand in Southeast Asia and would love to explore a collaboration.

We'd love to send you our new skincare line to try. Would you be open to
a quick chat?

Best,
Jane from BrandX
```

Only `{{recipient_name}}` is templated. Everything else is written by the user as a ready-to-use brief.

---

## Config Resolution

```
campaign.md values → fallback to hardcoded defaults in scripts
```

Hardcoded defaults:
- `view_threshold`: 10,000
- `min_video_views`: 10,000
- `recent_video_count`: 10
- `max_candidates_per_keyword`: 5

No Config sheet in xlsx.

---

## TikHub API Endpoints

| Purpose | Endpoint |
|---|---|
| Keyword search | `GET /api/v1/tiktok/web/fetch_search_video` |
| User profile | `GET /api/v1/tiktok/web/fetch_user_profile?uniqueId=` |
| User posts | `GET /api/v1/tiktok/app/v3/fetch_user_post` |
| Similar users | `GET /api/v1/tiktok/app/v3/fetch_similar_user_recommendations` |
| Post detail | `GET /api/v1/tiktok/web/fetch_post_detail?itemId=` |

---

## Environment & Credentials

### .env (per user, gitignored)

```
TIKHUB_API_KEY=xxx
SENDER_EMAIL=you@gmail.com
```

### Gmail OAuth

- `credentials.json` — shared Google Cloud OAuth client. Distributed by admin, not committed to repo. Placed in `.agent/credentials/`.
- `token.json` — generated per user via browser OAuth flow. Stored locally, gitignored.

### No AI API key needed

The agent platform provides the model. Scripts make no AI calls.

---

## Setup Flow

```bash
./setup.sh

1. Detect platform
   → Claude Code: symlink .agent/skills/ into .claude/skills/
   → Other: print manual wiring instructions

2. Install uv (if missing)

3. Create .env from .env.example
   → Prompt for TIKHUB_API_KEY
   → Prompt for SENDER_EMAIL

4. Check Gmail credentials
   → If credentials.json missing: print instructions to get from admin
   → If present: run OAuth flow → generate token.json

5. Create data/ directory

6. Print "Ready! Try: /scout _example"
```

---

## CLI Reference

```bash
uv run .agent/skills/scout/scripts/cli.py scout <campaign> [keyword]
uv run .agent/skills/scout/scripts/cli.py lookup <handle_or_url>
uv run .agent/skills/scout/scripts/cli.py outreach <campaign> [--dry-run]
uv run .agent/skills/scout/scripts/cli.py enrich <handle>
uv run .agent/skills/scout/scripts/cli.py dashboard [campaign]
```

---

## Implementation Sequence

### Phase 1: Project Scaffolding
1. Create new project structure (`.agent/`, `context/`, `data/`)
2. Create `cli.py` entry point with subcommands
3. Port `excel.py` — updated schema, new sheets, no Config sheet
4. Create `.env.example`, `setup.sh` with platform detection
5. Create `_example` campaign folder with `campaign.md`, `keywords.md`, `outreach.md`

### Phase 2: Scout + Enrich
6. Port `search.py` — keyword search via TikHub
7. Port `audit.py` — profile audit via TikHub
8. Create `enrich.py` — bio extraction, link-in-bio scraping, email regex
9. Integrate enrich into scout pipeline (runs after audit)
10. Port `dashboard.py` — updated for new schema

### Phase 3: Lookup
11. Port `lookup.py` — similar creator lookup
12. Integrate enrich into lookup pipeline
13. Add URL-to-handle parsing
14. Write to unified xlsx (Similar Users sheet)

### Phase 4: Outreach
15. Create `setup_gmail.py` — interactive OAuth wizard
16. Create `send_email.py` — Gmail API send, recipient name fill
17. Create `outreach.py` — read xlsx, fill template, send, log
18. Implement `--dry-run` flag

### Phase 5: Skills + Polish
19. Write `SKILL.md` for scout, lookup, outreach
20. Update `setup.sh` — include Gmail setup step
21. Write `README.md` — setup instructions per platform
22. End-to-end test: scout → lookup → outreach

---

## Out of Scope (v1)

- Web app / hosted version
- WhatsApp / Telegram / Feishu bot
- Outreach tracking (open rates, reply detection)
- Follow-up automation
- Multi-user / shared database
- iMessage bot (deprecated)
- AI calls inside scripts
