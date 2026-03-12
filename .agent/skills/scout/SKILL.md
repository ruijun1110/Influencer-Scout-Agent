---
name: scout
description: Discover TikTok influencers by keyword for a campaign. Searches TikTok videos via TikHub API, audits creator profiles against view thresholds, extracts contact info (bio, bio link, emails), and writes results to data/influencers.xlsx. Use when the user invokes /scout with a campaign name, asks to find TikTok creators, or wants to run influencer scouting. Requires campaign folder in context/campaigns/ with campaign.md and keywords.md. TIKHUB_API_KEY must be set in .agent/.env.
argument-hint: <campaign-name> [keyword]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(uv run *)
---

# Scout — TikTok Influencer Discovery

Campaign: **$ARGUMENTS**

## Pre-flight

1. Parse `$ARGUMENTS` as `<campaign-name> [keyword]`
2. Verify `context/campaigns/<campaign-name>/campaign.md` exists — stop if not
3. Verify `context/campaigns/<campaign-name>/keywords.md` exists — stop if not

## Step 1 — Keyword Handling

Read `context/campaigns/<campaign>/campaign.md` (persona, thresholds) and `keywords.md` (existing keywords).

**If a keyword was provided in `$ARGUMENTS`:**
- Do NOT generate any keywords. Only scout that single keyword.
- If the keyword is not yet in keywords.md, the script will add it automatically.

**If no keyword was provided:**
- Check keywords.md for rows with `status=pending`.
- If pending keywords exist, proceed to Step 2 — process all of them.
- ONLY if there are zero pending keywords, generate 5-10 new keywords targeting the campaign persona. Compare against ALL existing rows (any status) — skip duplicates (case-insensitive). Append net-new keywords with `status=pending`, `source=ai`, `date=<today>`.

## Step 2 — Run Scout

```bash
uv run .agent/skills/scout/scripts/cli.py scout <campaign-name> [keyword]
```

Capture stdout. If non-zero exit, report error and stop.

## Step 3 — Report

Print the stdout summary, then add:
- Keywords searched
- Candidates found and audited
- Qualified influencers added to `data/influencers.xlsx`
- How many had emails extracted
- Errors encountered
