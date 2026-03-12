# Influencer Scout

A portable skill package for AI coding agents that discovers TikTok influencers by keyword, extracts contact info, finds similar creators, and sends outreach emails.

Works with **Claude Code**, **Cursor**, **Codex**, or any agent that can run shell commands.

## Requirements

- [uv](https://docs.astral.sh/uv/) — installed automatically by `setup.sh`
- [TikHub API key](https://tikhub.io) — for TikTok search and profile data
- Gmail `credentials.json` — only needed for outreach, see [Gmail Setup](#3-gmail-setup-outreach-only)

## Installation

### 1. Clone and run setup

```bash
git clone <repo-url>
cd influencer-scout
./setup.sh
```

This installs `uv`, creates `.agent/.env` from the template, and wires the skills for your agent platform.

### 2. Add your TikHub API key

Edit `.agent/.env`:

```
TIKHUB_API_KEY=your_key_here
SENDER_EMAIL=you@gmail.com     # only needed for outreach
```

Get a key at [tikhub.io](https://tikhub.io).

### 3. Gmail setup (outreach only)

Place the `credentials.json` file at `.agent/credentials/credentials.json`, then re-run `setup.sh`. It will detect the file and open a browser window to complete OAuth automatically. Only needs to be done once.

### 4. Create your first campaign

```bash
cp -r context/campaigns/_example context/campaigns/my-campaign
```

Edit the three files inside:

**`campaign.md`** — persona and thresholds:
```yaml
persona: "Beauty brand targeting SEA micro-influencers"
view_threshold: 10000
min_video_views: 20000
recent_video_count: 10
max_candidates_per_keyword: 5
```

**`keywords.md`** — keyword tracking table:
```markdown
| keyword          | status  | source | date       |
|------------------|---------|--------|------------|
| skincare routine | pending | manual | 2026-03-10 |
```

**`outreach.md`** — email template:
```
Subject: Collaboration Opportunity

Hi {{recipient_name}},

I came across your content and loved your style...
```

## Usage

### /scout — find influencers

```
/scout my-campaign
/scout my-campaign "skincare routine"
```

Searches TikTok videos by keyword, audits creator view counts, extracts bio and emails, writes results to `data/influencers.xlsx`.

- Without a keyword: processes all `pending` keywords in `keywords.md`
- With a keyword: scouts that keyword only, no keyword generation

### /lookup — find similar creators

```
/lookup @username
/lookup https://www.tiktok.com/@username
```

Fetches similar creator recommendations, enriches each with bio and emails, saves to the Similar Users sheet.

### /outreach — send emails

```
/outreach my-campaign
```

Always previews drafts before sending. Confirm explicitly to proceed.

Test safely by redirecting all emails to yourself first:

```bash
uv run .agent/skills/scout/scripts/cli.py outreach my-campaign --test-email you@gmail.com --dry-run
```

## CLI Reference

All commands can also be run directly:

```bash
uv run .agent/skills/scout/scripts/cli.py scout <campaign> [keyword]
uv run .agent/skills/scout/scripts/cli.py lookup <handle_or_url>
uv run .agent/skills/scout/scripts/cli.py audit <handle_or_url> <campaign>
uv run .agent/skills/scout/scripts/cli.py promote <handle_or_url> <campaign>
uv run .agent/skills/scout/scripts/cli.py outreach <campaign> [--handle <handle>] [--dry-run] [--test-email EMAIL]
uv run .agent/skills/scout/scripts/cli.py enrich <handle>
uv run .agent/skills/scout/scripts/cli.py dashboard [campaign]
uv run .agent/skills/scout/scripts/cli.py setup-gmail
```
