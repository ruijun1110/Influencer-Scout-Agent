---
name: lookup
description: Find TikTok creators similar to a given profile. Accepts a TikTok handle or URL, resolves to a profile, fetches similar creator recommendations via TikHub API, enriches each with bio and email extraction, and writes results to the Similar Users sheet in data/influencers.xlsx. Use when the user invokes /lookup with a TikTok handle or URL, or asks to find similar creators.
argument-hint: <handle_or_url>
allowed-tools: Read, Grep, Glob, Bash(uv run *)
---

# Lookup — Similar Creator Discovery

Target: **$ARGUMENTS**

## Pre-flight

1. Parse `$ARGUMENTS` as a TikTok handle or URL
2. Check `.agent/.env` contains non-empty `TIKHUB_API_KEY`

## Run Lookup

```bash
uv run .agent/skills/scout/scripts/cli.py lookup <handle_or_url>
```

Capture stdout. If non-zero exit, report error and stop.

**Important:** Lookup only enriches and saves to the **Similar Users** sheet. It does NOT audit creators or add them to the Influencers sheet. Lookup is for discovery — use `/scout` to qualify and promote creators to the Influencers sheet.

## Report

Present the list of similar creators found, noting:
- How many similar creators were discovered
- Which ones have email addresses
- Results are in the **Similar Users** sheet of `data/influencers.xlsx`
