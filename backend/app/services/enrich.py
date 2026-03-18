import logging
import re
import httpx

log = logging.getLogger(__name__)

EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")


async def extract_emails_from_url(url: str) -> list[str]:
    """Scrape a URL and extract email addresses from the page content."""
    if not url:
        return []
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(url, timeout=15)
            text = resp.text
            emails = list(set(EMAIL_REGEX.findall(text)))
            return emails
    except Exception as e:
        log.debug("Failed to extract emails from %s: %s", url, e)
        return []


def extract_emails_from_bio(bio: str) -> list[str]:
    """Extract email addresses from bio text."""
    if not bio:
        return []
    return list(set(EMAIL_REGEX.findall(bio)))
