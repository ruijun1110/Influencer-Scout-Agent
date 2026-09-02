"""Async SMTP batch email sender using aiosmtplib."""

import asyncio
import imaplib
import logging
import re
from datetime import datetime, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Callable

import aiosmtplib

_log = logging.getLogger(__name__)


def _derive_imap_host(smtp_host: str) -> str | None:
    """Derive IMAP host from SMTP host for known providers."""
    patterns: list[tuple[str, str]] = [
        (r"smtp\.mail\.([\w-]+)\.awsapps\.com", r"imap.mail.\1.awsapps.com"),  # AWS WorkMail
        (r"smtp\.gmail\.com", "imap.gmail.com"),
        (r"smtp\.office365\.com", "outlook.office365.com"),
        (r"smtp\.zoho\.(com|eu|in)", r"imap.zoho.\1"),
        (r"smtp\.mail\.yahoo\.com", "imap.mail.yahoo.com"),
        (r"smtp\.fastmail\.com", "imap.fastmail.com"),
        (r"smtp\.mail\.me\.com", "imap.mail.me.com"),
    ]
    for pattern, replacement in patterns:
        m = re.match(pattern, smtp_host, re.IGNORECASE)
        if m:
            return re.sub(pattern, replacement, smtp_host, flags=re.IGNORECASE)
    return None


def _save_to_sent_folder(
    imap_host: str,
    username: str,
    password: str,
    mime_msg: str,
) -> None:
    """Append a sent message to the IMAP Sent folder. Best-effort, never raises."""
    try:
        imap = imaplib.IMAP4_SSL(imap_host, 993)
        imap.login(username, password)

        # Find the Sent folder — providers name it differently
        _, folder_list = imap.list()
        sent_folder = None
        for folder_bytes in (folder_list or []):
            if not isinstance(folder_bytes, bytes):
                continue
            folder_str = folder_bytes.decode("utf-8", errors="replace")
            # Extract folder name (after last ")
            parts = folder_str.split('"')
            name = parts[-1].strip() if len(parts) >= 2 else folder_str.split()[-1]
            name_lower = name.lower()
            if name_lower in ("sent", "sent items", "sent mail", "[gmail]/sent mail"):
                sent_folder = name
                break

        if not sent_folder:
            _log.warning("IMAP: could not find Sent folder on %s", imap_host)
            imap.logout()
            return

        now = datetime.now(timezone.utc)
        imap.append(sent_folder, "\\Seen", imaplib.Time2Internaldate(now), mime_msg.encode("utf-8"))
        imap.logout()
    except Exception as e:
        _log.warning("IMAP save to Sent failed: %s", e)


def _classify_error(code: int) -> str:
    """Classify SMTP error codes into hard/soft/transient."""
    if 550 <= code <= 554:
        return "hard_bounce"
    if 450 <= code <= 452:
        return "soft_bounce"
    return "transient"


def _build_message(from_email: str, to: str, subject: str, body: str) -> MIMEMultipart:
    """Build a multipart email with plain text primary (best for cold outreach deliverability)."""
    msg = MIMEMultipart("alternative")
    msg["From"] = from_email
    msg["To"] = to
    msg["Subject"] = subject
    # Plain text first (primary for cold outreach)
    msg.attach(MIMEText(body, "plain", "utf-8"))
    # Simple HTML version
    html_body = body.replace("\n", "<br>\n")
    msg.attach(MIMEText(f"<html><body><p>{html_body}</p></body></html>", "html", "utf-8"))
    return msg


async def send_smtp_batch(
    host: str,
    port: int,
    username: str,
    password: str,
    from_email: str,
    messages: list[dict],  # [{to, subject, body}]
    delay: float = 1.5,
    on_progress: Callable[[int], None] | None = None,
    save_to_sent: bool = True,
) -> list[dict]:
    """Send a batch of emails via SMTP with rate limiting and error tracking.

    Returns list of [{to, status: "sent"|"failed", error?: str, error_type?: str, code?: int}]
    """
    results: list[dict] = []
    use_tls = (port == 465)
    smtp = aiosmtplib.SMTP(hostname=host, port=port, use_tls=use_tls, start_tls=not use_tls)

    # Derive IMAP host for saving to Sent folder
    imap_host = _derive_imap_host(host) if save_to_sent else None

    try:
        await smtp.connect()
        await smtp.login(username, password)
    except Exception as e:
        _log.error("SMTP connection/login failed: %s", e)
        # All messages fail if we can't connect
        return [{"to": m["to"], "status": "failed", "error": f"Connection failed: {e}", "error_type": "transient"} for m in messages]

    for i, msg_data in enumerate(messages):
        to = msg_data["to"]
        result = {"to": to, "status": "failed"}

        for attempt in range(2):  # Single retry on disconnect
            try:
                mime_msg = _build_message(from_email, to, msg_data["subject"], msg_data["body"])
                mime_str = mime_msg.as_string()
                await smtp.sendmail(from_email, to, mime_str)
                result = {"to": to, "status": "sent"}

                # Save to IMAP Sent folder (best-effort, in background thread)
                if imap_host:
                    loop = asyncio.get_event_loop()
                    loop.run_in_executor(None, _save_to_sent_folder, imap_host, username, password, mime_str)

                break
            except aiosmtplib.SMTPResponseException as e:
                error_type = _classify_error(e.code)
                result = {"to": to, "status": "failed", "error": str(e.message), "error_type": error_type, "code": e.code}
                if error_type == "hard_bounce":
                    break  # Don't retry hard bounces
            except (aiosmtplib.SMTPServerDisconnected, ConnectionError) as e:
                if attempt == 0:
                    _log.warning("SMTP disconnected, reconnecting for %s", to)
                    try:
                        smtp = aiosmtplib.SMTP(hostname=host, port=port, use_tls=use_tls, start_tls=not use_tls)
                        await smtp.connect()
                        await smtp.login(username, password)
                        continue  # Retry with new connection
                    except Exception as reconnect_err:
                        result = {"to": to, "status": "failed", "error": f"Reconnect failed: {reconnect_err}", "error_type": "transient"}
                        break
                else:
                    result = {"to": to, "status": "failed", "error": f"Disconnected: {e}", "error_type": "transient"}
            except Exception as e:
                result = {"to": to, "status": "failed", "error": str(e), "error_type": "transient"}
                break

        results.append(result)

        # Progress callback every 5 messages
        if on_progress and ((i + 1) % 5 == 0 or i + 1 == len(messages)):
            on_progress(i + 1)

        # Rate limiting between sends
        if i < len(messages) - 1:
            await asyncio.sleep(delay)

    try:
        await smtp.quit()
    except Exception:
        pass  # Best-effort quit

    return results


async def send_smtp_single(
    host: str,
    port: int,
    username: str,
    password: str,
    from_email: str,
    to_email: str,
    subject: str,
    body: str,
) -> dict:
    """Send a single email via SMTP. Returns {status, error?, code?}."""
    results = await send_smtp_batch(
        host=host, port=port, username=username, password=password,
        from_email=from_email,
        messages=[{"to": to_email, "subject": subject, "body": body}],
        delay=0,
    )
    return results[0]
