# /// script
# dependencies = ["httpx", "openpyxl", "python-dotenv", "google-auth-oauthlib", "google-api-python-client", "pyyaml"]
# ///
"""
cli.py — Single entry point for Influencer Scout.

Usage:
    uv run cli.py scout <campaign> [keyword]
    uv run cli.py lookup <handle_or_url>
    uv run cli.py audit <handle_or_url> <campaign>
    uv run cli.py promote <handle_or_url> <campaign>
    uv run cli.py outreach <campaign> [--handle <handle>] [--dry-run] [--test-email <addr>]
    uv run cli.py enrich <handle>
    uv run cli.py dashboard [campaign]
    uv run cli.py setup-gmail
"""
import argparse
import logging
import os
import re
import sys
from datetime import datetime
from pathlib import Path

# Add scripts dir to path for sibling imports
sys.path.insert(0, str(Path(__file__).parent))

# Load .env from repository root (same file as FastAPI / Vite)
_dotenv_path = Path(__file__).resolve().parents[4] / '.env'
if _dotenv_path.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_dotenv_path)
    except ImportError:
        for line in _dotenv_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, _, v = line.partition('=')
                os.environ.setdefault(k.strip(), v.strip())


def setup_logging(command: str):
    """Configure file-based logging for script runs.

    Logs are written to data/logs/<command>_<timestamp>.log.
    This is only called when scripts run via CLI, not by the agent.
    """
    _project_root = Path(__file__).resolve().parents[4]
    log_dir = _project_root / 'data' / 'logs'
    log_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    log_file = log_dir / f'{command}_{timestamp}.log'

    # Configure root 'scout' logger — all scripts use scout.* loggers
    logger = logging.getLogger('scout')
    logger.setLevel(logging.DEBUG)

    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter(
        '%(asctime)s %(name)s %(levelname)s %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    ))
    logger.addHandler(file_handler)

    logger.info("=== %s started ===", command)
    print(f"[log] {log_file}")


def get_api_key() -> str:
    key = os.environ.get('TIKHUB_API_KEY', '')
    if not key:
        print(
            "ERROR: TIKHUB_API_KEY is not set.\n"
            f"  Add your key to: {_dotenv_path}\n"
            "  Get a key at: https://tikhub.io",
            file=sys.stderr,
        )
        sys.exit(1)
    return key


def parse_handle(handle_or_url: str) -> str:
    """Extract TikTok handle from URL or raw handle string."""
    handle_or_url = handle_or_url.strip()

    # Raw handle: "username" or "@username"
    if not handle_or_url.startswith('http'):
        return handle_or_url.lstrip('@')

    # Full URL: tiktok.com/@username/...
    m = re.search(r'tiktok\.com/@([^/?]+)', handle_or_url)
    if m:
        return m.group(1)

    # Short URL: vm.tiktok.com/XXXX — follow redirect
    if 'vm.tiktok.com' in handle_or_url or '/t/' in handle_or_url:
        import httpx
        try:
            resp = httpx.get(handle_or_url, follow_redirects=True, timeout=10)
            m = re.search(r'tiktok\.com/@([^/?]+)', str(resp.url))
            if m:
                return m.group(1)
        except Exception:
            pass

    # Fallback: treat as handle
    return handle_or_url.split('/')[-1].lstrip('@')


def cmd_scout(args):
    import excel
    campaign = args.campaign
    keyword = args.keyword

    # Verify campaign exists
    campaign_dir = excel.PROJECT_ROOT / 'context' / 'campaigns' / campaign
    if not campaign_dir.exists():
        print(f"ERROR: campaign folder not found: {campaign_dir}", file=sys.stderr)
        sys.exit(1)
    if not (campaign_dir / 'campaign.md').exists():
        print(f"ERROR: missing campaign.md in {campaign_dir}", file=sys.stderr)
        sys.exit(1)
    if not (campaign_dir / 'keywords.md').exists():
        print(f"ERROR: missing keywords.md in {campaign_dir}", file=sys.stderr)
        sys.exit(1)

    import scout as scout_mod
    scout_mod.run_scout(campaign, keyword)


def cmd_lookup(args):
    handle = parse_handle(args.handle_or_url)
    api_key = get_api_key()

    import lookup as lookup_mod
    lookup_mod.run_lookup(handle, api_key)


def _run_audit_handle(handle: str, campaign: str, api_key: str, notes: str = ''):
    """Shared logic for audit and promote commands."""
    import excel
    import audit as audit_mod
    import enrich as enrich_mod
    import dashboard as dashboard_mod

    campaign_dir = excel.PROJECT_ROOT / 'context' / 'campaigns' / campaign
    if not (campaign_dir / 'campaign.md').exists():
        print(f"ERROR: campaign not found: {campaign}", file=sys.stderr)
        sys.exit(1)

    config = excel.load_config(campaign)
    print(f"Auditing @{handle} for campaign={campaign}")
    print(f"  min_video_views={config['min_video_views']}, recent_video_count={config['recent_video_count']}")

    result = audit_mod.audit_handle(handle, campaign, api_key, config, notes=notes)
    row = result.get('influencer_row', {})

    if row:
        print(f"  max={row.get('max_views')}, min={row.get('min_views')}, median={row.get('median_views')}")

    if not result.get('qualified'):
        print(f"  Result: NOT QUALIFIED — not added to Influencers sheet.")
        # Still track in Candidates so there's a record
        excel.append_candidates([{
            'handle': handle,
            'triggering_video_url': '',
            'triggering_play_count': '',
            'keyword': '',
            'campaign': campaign,
            'audit_status': 'not_qualified',
        }])
        excel.update_candidate_status(handle, campaign, 'not_qualified')
        return

    # Qualified — enrich then write
    print(f"  Result: QUALIFIED — enriching profile...")
    enriched = enrich_mod.enrich_handle(handle, api_key)
    row.update({
        'bio': enriched.get('bio', ''),
        'bio_link': enriched.get('bio_link', ''),
        'emails': ', '.join(enriched.get('emails', [])),
    })

    excel.append_influencer(row)
    excel.append_candidates([{
        'handle': handle,
        'triggering_video_url': '',
        'triggering_play_count': '',
        'keyword': '',
        'campaign': campaign,
        'audit_status': 'qualified',
    }])
    excel.update_candidate_status(handle, campaign, 'qualified')

    email_count = len(enriched.get('emails', []))
    print(f"  bio_link={'yes' if enriched.get('bio_link') else 'no'}, emails={email_count}")
    print(f"  Written to Influencers sheet.")

    try:
        dashboard_mod.generate()
    except Exception as e:
        print(f"[dashboard] warning: {e}")


def cmd_audit(args):
    """Audit any handle against a campaign's thresholds. Writes to Influencers if qualified."""
    handle = parse_handle(args.handle_or_url)
    api_key = get_api_key()
    _run_audit_handle(handle, args.campaign, api_key)


def cmd_promote(args):
    """Promote a creator from Similar Users into a campaign (audit + enrich + write to Influencers)."""
    handle = parse_handle(args.handle_or_url)
    api_key = get_api_key()
    _run_audit_handle(handle, args.campaign, api_key, notes='promoted from similar users')


def _parse_outreach_md(path: Path) -> tuple[dict, str]:
    """Parse outreach.md, returning (frontmatter dict, body text).

    Supports optional YAML frontmatter delimited by ---:

        ---
        attachments:
          - attachments/media_kit.pdf
        ---

        Subject: Hello ...
    """
    import yaml
    text = path.read_text()
    frontmatter = {}
    content = text
    if text.startswith('---'):
        parts = text.split('---', 2)
        if len(parts) >= 3:
            try:
                frontmatter = yaml.safe_load(parts[1]) or {}
            except Exception:
                pass
            content = parts[2]
    return frontmatter, content


def cmd_outreach(args):
    import excel
    campaign = args.campaign
    dry_run = args.dry_run
    test_email = args.test_email

    campaign_dir = excel.PROJECT_ROOT / 'context' / 'campaigns' / campaign
    outreach_path = campaign_dir / 'outreach.md'
    if not outreach_path.exists():
        print(f"ERROR: missing outreach.md in {campaign_dir}", file=sys.stderr)
        sys.exit(1)

    # Parse template (frontmatter + body)
    frontmatter, content = _parse_outreach_md(outreach_path)
    lines = content.strip().splitlines()
    subject = ''
    body_lines = []
    for i, line in enumerate(lines):
        if line.lower().startswith('subject:'):
            subject = line.split(':', 1)[1].strip()
            body_lines = lines[i + 1:]
            break
    body_template = '\n'.join(body_lines).strip()

    # Resolve attachment paths (relative to campaign dir)
    attachment_paths = []
    for rel in frontmatter.get('attachments') or []:
        abs_path = campaign_dir / rel
        if not abs_path.exists():
            print(f"WARNING: attachment not found, skipping: {abs_path}", file=sys.stderr)
        else:
            attachment_paths.append(abs_path)

    # Get influencers with emails for this campaign
    influencers = excel.get_influencers(campaign)
    influencers = [inf for inf in influencers if inf.get('emails')]

    # Filter to specific handle if requested
    if args.handle:
        target = args.handle.lstrip('@')
        influencers = [inf for inf in influencers if inf.get('handle') == target]
        if not influencers:
            print(f"ERROR: @{target} not found in Influencers sheet for campaign={campaign} (or has no email).",
                  file=sys.stderr)
            sys.exit(1)

    # Exclude already-sent (unless --handle targets them explicitly)
    if not args.handle:
        sent_handles = excel.get_sent_handles(campaign)
        influencers = [inf for inf in influencers if inf.get('handle') not in sent_handles]

    if not influencers:
        print("No influencers with emails to send outreach to.")
        return

    mode = '[DRY RUN] ' if dry_run else '[TEST → ' + test_email + '] ' if test_email else ''
    print(f"{mode}Outreach for campaign: {campaign}")
    print(f"  Template subject: {subject}")
    print(f"  Recipients: {len(influencers)}")
    if attachment_paths:
        print(f"  Attachments: {', '.join(p.name for p in attachment_paths)}")
    if test_email:
        print(f"  All emails redirected to: {test_email}")
    print()

    from datetime import datetime

    for inf in influencers:
        handle = inf.get('handle', '')
        emails = inf.get('emails', '')
        recipient_name = f'@{handle}'
        filled_body = body_template.replace('{{recipient_name}}', recipient_name)

        email_list = [e.strip() for e in emails.split(',') if e.strip()]
        actual_recipients = [test_email] if test_email else email_list

        print(f"--- {handle} ---")
        print(f"  To: {', '.join(email_list)}" + (f" → redirected to {test_email}" if test_email else ""))
        print(f"  Subject: {subject}")
        if attachment_paths:
            print(f"  Attachments: {', '.join(p.name for p in attachment_paths)}")
        print(f"  Body:\n{filled_body}\n")

        if dry_run:
            continue

        # Send
        import send_email
        result = send_email.send_email(
            to_addresses=actual_recipients,
            subject=subject,
            body=filled_body,
            sender_email=os.environ.get('SENDER_EMAIL', ''),
            attachments=attachment_paths or None,
        )

        excel.append_outreach_log({
            'handle': handle,
            'emails': emails,
            'subject': subject,
            'campaign': campaign,
            'sent_at': datetime.now().isoformat(timespec='seconds'),
            'status': result.get('status', 'failed'),
        })
        print(f"  Status: {result.get('status')}")
        if result.get('error'):
            print(f"  Error: {result['error']}")


def cmd_enrich(args):
    handle = args.handle.lstrip('@')
    api_key = get_api_key()

    import enrich as enrich_mod
    result = enrich_mod.enrich_handle(handle, api_key)
    print(f"Handle: @{handle}")
    print(f"Bio: {result.get('bio', '')}")
    print(f"Bio link: {result.get('bio_link', '')}")
    print(f"Emails: {', '.join(result.get('emails', []))}")


def cmd_dashboard(args):
    import dashboard as dashboard_mod
    dashboard_mod.generate(campaign=args.campaign)


def cmd_setup_gmail(args):
    import send_email
    send_email.setup_gmail_oauth()


def main():
    parser = argparse.ArgumentParser(prog='cli.py', description='Influencer Scout CLI')
    sub = parser.add_subparsers(dest='command', required=True)

    p_scout = sub.add_parser('scout', help='Discover TikTok influencers by keyword')
    p_scout.add_argument('campaign', help='Campaign name')
    p_scout.add_argument('keyword', nargs='?', default=None, help='Optional keyword to search')

    p_lookup = sub.add_parser('lookup', help='Find similar creators')
    p_lookup.add_argument('handle_or_url', help='TikTok handle or URL')

    p_audit = sub.add_parser('audit', help='Audit a single handle against a campaign threshold')
    p_audit.add_argument('handle_or_url', help='TikTok handle or URL')
    p_audit.add_argument('campaign', help='Campaign name')

    p_promote = sub.add_parser('promote', help='Promote a similar creator into a campaign (audit + enrich)')
    p_promote.add_argument('handle_or_url', help='TikTok handle or URL')
    p_promote.add_argument('campaign', help='Campaign name')

    p_outreach = sub.add_parser('outreach', help='Send outreach emails')
    p_outreach.add_argument('campaign', help='Campaign name')
    p_outreach.add_argument('--handle', default=None, help='Send to a specific handle only')
    p_outreach.add_argument('--dry-run', action='store_true', help='Preview without sending')
    p_outreach.add_argument('--test-email', default=None, help='Redirect all emails to this address')

    p_enrich = sub.add_parser('enrich', help='Enrich a single handle')
    p_enrich.add_argument('handle', help='TikTok handle')

    p_dash = sub.add_parser('dashboard', help='Generate HTML dashboard')
    p_dash.add_argument('campaign', nargs='?', default=None, help='Filter by campaign')

    sub.add_parser('setup-gmail', help='Run Gmail OAuth flow')

    args = parser.parse_args()
    setup_logging(args.command)
    cmds = {
        'scout': cmd_scout,
        'lookup': cmd_lookup,
        'audit': cmd_audit,
        'promote': cmd_promote,
        'outreach': cmd_outreach,
        'enrich': cmd_enrich,
        'dashboard': cmd_dashboard,
        'setup-gmail': cmd_setup_gmail,
    }
    cmds[args.command](args)


if __name__ == '__main__':
    main()
