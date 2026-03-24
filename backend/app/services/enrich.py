import logging
import re
from urllib.parse import urlparse

import httpx

log = logging.getLogger(__name__)

# Aligned with .claude/skills/scout/scripts/enrich.py
EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")

GENERIC_PREFIXES = {
    "noreply",
    "no-reply",
    "support",
    "info",
    "hello",
    "help",
    "admin",
    "webmaster",
    "postmaster",
    "mailer-daemon",
    "abuse",
    "contact",
    "sales",
    "billing",
    "privacy",
    "security",
}

SKIP_DOMAINS = {
    "beacons.ai",
    "instagram.com",
    "facebook.com",
    "twitter.com",
    "x.com",
}

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; InfluencerScout/1.0)",
}


def is_fetchable_url(url: str) -> bool:
    """Return False for link-in-bio hosts we skip scraping (matches CLI skill)."""
    if not url:
        return False
    if not url.startswith("http"):
        url = "https://" + url
    try:
        domain = urlparse(url).netloc.lower().lstrip("www.")
        return domain not in SKIP_DOMAINS
    except Exception:
        return False


def filter_emails(emails: list[str]) -> list[str]:
    """Remove generic/service addresses and deduplicate (matches CLI skill)."""
    seen: set[str] = set()
    filtered: list[str] = []
    for email in emails:
        email = email.lower().strip()
        if email in seen:
            continue
        prefix = email.split("@", 1)[0]
        if prefix in GENERIC_PREFIXES:
            continue
        if email.endswith((".png", ".jpg", ".gif", ".svg", ".webp")):
            continue
        seen.add(email)
        filtered.append(email)
    return filtered


async def extract_emails_from_url(url: str) -> list[str]:
    """Scrape a URL and extract email addresses from the page content."""
    if not url or not is_fetchable_url(url):
        return []
    if not url.startswith("http"):
        url = "https://" + url
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            headers=DEFAULT_HEADERS,
        ) as client:
            resp = await client.get(url, timeout=10)
            if resp.status_code != 200:
                return []
            return EMAIL_REGEX.findall(resp.text)
    except Exception as e:
        log.debug("Failed to extract emails from %s: %s", url, e)
        return []


def extract_emails_from_bio(bio: str) -> list[str]:
    """Extract email addresses from bio text."""
    if not bio:
        return []
    return EMAIL_REGEX.findall(bio)
