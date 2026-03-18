# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Influencer Scout is an AI Agent Skills package for discovering TikTok KOLs, extracting contact info, finding similar creators, and sending bulk outreach emails. It's designed around one core principle: **the agent is the brain, scripts are the hands** — Python scripts never make AI API calls; the agent orchestrates and calls scripts via `uv run`.

## Setup

```bash
./setup.sh   # One-time initialization: installs uv, creates .env, runs Gmail OAuth
```

Prerequisites: `TIKHUB_API_KEY` in `.agent/.env`, and `credentials.json` in `.agent/credentials/` for Gmail.

## Running Scripts

All scripts are invoked via `uv run` (no `pip install` needed):

```bash
uv run .agent/skills/scout/scripts/cli.py scout <campaign> [keyword]
uv run .agent/skills/scout/scripts/cli.py lookup <handle>
uv run .agent/skills/scout/scripts/cli.py outreach <campaign> [--dry-run] [--test-email addr] [--handle @h]
uv run .agent/skills/scout/scripts/cli.py audit <handle> <campaign>
uv run .agent/skills/scout/scripts/cli.py promote <handle> <campaign>
uv run .agent/skills/scout/scripts/cli.py enrich <handle>
uv run .agent/skills/scout/scripts/cli.py dashboard <campaign>
uv run .agent/skills/scout/scripts/cli.py setup-gmail
```

No formal test suite — use `--dry-run` and `--test-email` flags for safe testing of outreach.

## Architecture

### Skills (`.agent/skills/`)

Three skills map directly to user-facing slash commands:

| Skill | Command | What it does |
|-------|---------|-------------|
| `scout/` | `/scout <campaign> [keyword]` | Search TikTok, audit creators against thresholds, enrich with contact info |
| `lookup/` | `/lookup <handle_or_url>` | Find similar creators; writes to "Similar Users" sheet only |
| `outreach/` | `/outreach <campaign>` | Send emails — always dry-run first, then confirm before sending |

Each skill is defined in `SKILL.md` (agent reads this to understand parameters and workflow) plus Python scripts that do the actual work.

### Python Modules (`.agent/skills/scout/scripts/`)

| Module | Role |
|--------|------|
| `cli.py` | Single entry point; dispatches to all commands |
| `scout.py` | Orchestrator: search → audit → enrich → write → dashboard |
| `search.py` | Queries TikHub API by keyword |
| `audit.py` | Fetches recent videos, checks view thresholds |
| `enrich.py` | Extracts bio, bio link, scrapes emails from link-in-bio |
| `lookup.py` | Finds similar creators via TikHub |
| `send_email.py` | Gmail API OAuth2, MIME multipart with attachments |
| `excel.py` | Manages all 5 sheets in `influencers.xlsx`; handles macOS file locks |
| `dashboard.py` | Generates self-contained `dashboard.html` |

### Data Store (`data/influencers.xlsx`)

Five sheets: **Influencers** (qualified, ready for outreach), **Candidates** (pre-audit queue), **Search Log**, **Similar Users** (lookup results, not auto-promoted), **Outreach** (send log).

### Campaign Configuration (`context/campaigns/<name>/`)

| File | Purpose |
|------|---------|
| `campaign.md` | YAML frontmatter: `persona`, `view_threshold`, `min_video_views`, `recent_video_count`, `max_candidates_per_keyword` |
| `keywords.md` | Markdown table with columns: keyword, status (`pending`/`searched`), source, date |
| `outreach.md` | Optional YAML frontmatter (`attachments:` list) + email template; `{{recipient_name}}` → `@handle` |
| `attachments/` | PDFs/files referenced in outreach.md frontmatter |

Use `context/campaigns/_example/` as the template for new campaigns.

## Keyword Auto-Generation

When `/scout <campaign>` is called with no keyword and no `pending` keywords exist, **the agent** (not the script) generates 5–10 new keywords based on the `persona` field in `campaign.md`, deduplicates against existing keywords (any status), and appends them to `keywords.md` with `source=ai`, `status=pending`.

## Permissions Model

`.claude/settings.json` explicitly denies agent access to `.agent/.env` and `.agent/credentials/**`. The agent can call scripts (which read these files internally) but cannot read secrets directly. Never bypass these deny rules.

## Key Implementation Notes

- `excel.py` uses macOS-specific code (`lsof` + AppleScript) to close Excel/Numbers before writing — safe to ignore on Linux
- Logs go to `data/logs/<command>_<timestamp>.log` (DEBUG level, one file per execution)
- `data/` is gitignored — contains PII (influencer emails) and generated files
- TikHub base URL: `https://api.tikhub.io/api/v1` with Bearer auth
- Gmail scope: `gmail.send` only (minimal permissions); token auto-refreshes
