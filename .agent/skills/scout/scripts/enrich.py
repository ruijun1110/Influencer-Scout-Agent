#!/usr/bin/env python3
from __future__ import annotations
"""
enrich.py — Bio extraction, link-in-bio scraping, and email extraction.

Runs automatically at the end of scout and lookup pipelines.
Also available standalone via: cli.py enrich <handle>
"""
import logging
import re

import httpx

log = logging.getLogger('scout.enrich')

BASE_URL = "https://api.tikhub.io/api/v1"

EMAIL_RE = re.compile(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}')

GENERIC_PREFIXES = {
    'noreply', 'no-reply', 'support', 'info', 'hello', 'help',
    'admin', 'webmaster', 'postmaster', 'mailer-daemon', 'abuse',
    'contact', 'sales', 'billing', 'privacy', 'security',
}

SKIP_DOMAINS = {'beacons.ai', 'instagram.com', 'facebook.com', 'twitter.com', 'x.com'}


def _is_fetchable(url: str) -> bool:
    """Check if a bio link domain is worth scraping."""
    try:
        from urllib.parse import urlparse
        domain = urlparse(url).netloc.lower().lstrip('www.')
        return domain not in SKIP_DOMAINS
    except Exception:
        return False


def _filter_emails(emails: list[str]) -> list[str]:
    """Remove generic/service addresses and deduplicate."""
    seen = set()
    filtered = []
    for email in emails:
        email = email.lower().strip()
        if email in seen:
            continue
        prefix = email.split('@')[0]
        if prefix in GENERIC_PREFIXES:
            continue
        # Skip image file extensions that regex might catch
        if email.endswith(('.png', '.jpg', '.gif', '.svg', '.webp')):
            continue
        seen.add(email)
        filtered.append(email)
    return filtered


def _fetch_profile(handle: str, api_key: str) -> dict:
    """Fetch TikHub user profile. Returns {bio, bio_link, sec_uid}."""
    log.debug("Fetching profile for @%s", handle)
    try:
        resp = httpx.get(
            f"{BASE_URL}/tiktok/web/fetch_user_profile",
            params={'uniqueId': handle},
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json().get('data', {})
        user = data.get('userInfo', {}).get('user', {})
        return {
            'bio': user.get('signature', ''),
            'bio_link': (user.get('bioLink', {}) or {}).get('link', ''),
            'sec_uid': user.get('secUid', ''),
        }
    except Exception as e:
        log.warning("Failed to fetch profile for @%s: %s", handle, e)
        return {'bio': '', 'bio_link': '', 'sec_uid': ''}


def _scrape_bio_link(url: str) -> list[str]:
    """Fetch bio link page and extract emails from HTML."""
    if not url or not _is_fetchable(url):
        return []
    try:
        # Ensure URL has scheme
        if not url.startswith('http'):
            url = 'https://' + url
        resp = httpx.get(
            url,
            follow_redirects=True,
            timeout=10,
            headers={'User-Agent': 'Mozilla/5.0 (compatible; InfluencerScout/1.0)'},
        )
        if resp.status_code != 200:
            return []
        return EMAIL_RE.findall(resp.text)
    except Exception as e:
        log.debug("Failed to scrape %s: %s", url, e)
        return []


def enrich_handle(handle: str, api_key: str) -> dict:
    """Enrich a single handle. Returns {bio, bio_link, emails: list[str]}."""
    profile = _fetch_profile(handle, api_key)
    bio = profile.get('bio', '')
    bio_link = profile.get('bio_link', '')

    # Collect emails from bio text
    all_emails = EMAIL_RE.findall(bio)

    # Scrape bio link page for more emails
    if bio_link:
        link_emails = _scrape_bio_link(bio_link)
        all_emails.extend(link_emails)

    emails = _filter_emails(all_emails)
    log.info("@%s bio_link=%r emails=%s", handle, bio_link, emails)

    return {
        'bio': bio,
        'bio_link': bio_link,
        'emails': emails,
    }


def enrich_handles(handles: list[str], api_key: str) -> dict[str, dict]:
    """Batch enrich multiple handles. Returns dict keyed by handle."""
    results = {}
    for handle in handles:
        results[handle] = enrich_handle(handle, api_key)
    return results
