---
name: outreach
description: Send outreach emails to qualified TikTok influencers in a campaign. Reads influencers with emails from data/influencers.xlsx, fills the outreach template from the campaign's outreach.md with recipient name, and sends via Gmail API. Use when the user invokes /outreach with a campaign name or asks to send emails to discovered influencers. Requires Gmail OAuth credentials in .agent/credentials/.
argument-hint: <campaign-name>
allowed-tools: Read, Grep, Glob, Bash(uv run *)
---

# Outreach — Email Campaign

Campaign: **$ARGUMENTS**

## Pre-flight

1. Parse `$ARGUMENTS` as `<campaign-name>`
2. Verify `context/campaigns/<campaign>/outreach.md` exists — stop if not
3. Check `.agent/.env` contains non-empty `SENDER_EMAIL`
4. If `outreach.md` has an `attachments:` frontmatter list, verify each file exists under the campaign folder — warn the user about any missing files

## Step 1 — Dry Run (MANDATORY)

Always run dry-run first. Never skip this step.

```bash
uv run .agent/skills/scout/scripts/cli.py outreach <campaign> --dry-run
```

Present ALL draft emails to the user. Show each recipient's handle, email addresses, subject, filled body, and attachments (if any).

## Step 2 — Confirm

Ask the user to review and explicitly confirm they want to send. Do NOT proceed without clear confirmation.

## Step 3 — Send

Only after user confirms:

```bash
uv run .agent/skills/scout/scripts/cli.py outreach <campaign>
```

## Report

- How many emails were sent successfully
- Any failures
- Results logged to Outreach sheet in `data/influencers.xlsx`
