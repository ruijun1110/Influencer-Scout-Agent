from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.core.auth import get_current_user, get_supabase
from app.core.campaign_access import ensure_user_owns_campaign
from app.core.config import get_settings
from app.services import gmail
from app.services.email_sender import send_smtp_batch, send_smtp_single

router = APIRouter()


async def run_outreach(task_id: str, campaign_id: str, creator_ids: list[str],
                       subject: str, body_template: str, user_id: str, supabase):
    """Background task: send outreach emails via Gmail or SMTP."""
    import logging
    _log = logging.getLogger(__name__)

    try:
        # 1. Read user's email config
        config = supabase.table("user_email_config").select("*").eq("user_id", user_id).execute()
        if not config.data:
            supabase.table("tasks").update({"status": "failed", "error": "Email not configured"}).eq("id", task_id).execute()
            return

        cfg = config.data[0]
        provider = cfg.get("provider")

        if provider == "gmail":
            await _run_outreach_gmail(task_id, campaign_id, creator_ids, subject, body_template, user_id, supabase, cfg, _log)
        elif provider == "smtp":
            await _run_outreach_smtp(task_id, campaign_id, creator_ids, subject, body_template, user_id, supabase, cfg, _log)
        else:
            supabase.table("tasks").update({"status": "failed", "error": f"Unsupported email provider: {provider}"}).eq("id", task_id).execute()

    except Exception as e:
        _log.exception("run_outreach: unexpected error for task %s", task_id)
        supabase.table("tasks").update({
            "status": "failed",
            "error": str(e)[:500],
        }).eq("id", task_id).execute()


def _log_outreach(supabase, campaign_id: str, creator_id: str, email: str,
                  subject: str, status: str, error: str | None = None):
    """Log a send attempt (success or failure) to outreach_log."""
    row = {
        "campaign_id": campaign_id,
        "creator_id": creator_id,
        "email": email,
        "subject": subject,
        "status": status,
        "sent_at": "now()",
    }
    if error:
        row["error"] = error[:500]
    supabase.table("outreach_log").insert(row).execute()


async def _run_outreach_gmail(task_id, campaign_id, creator_ids, subject, body_template,
                               user_id, supabase, cfg, _log):
    """Gmail send path."""
    token_data = cfg["credentials_encrypted"]
    try:
        service, updated = gmail.get_gmail_service_from_tokens(token_data)
        if updated:
            supabase.table("user_email_config").update({"credentials_encrypted": updated}).eq("user_id", user_id).execute()
    except Exception as e:
        _log.exception("run_outreach: Gmail service build failed")
        supabase.table("tasks").update({"status": "failed", "error": f"Gmail auth failed: {e}"}).eq("id", task_id).execute()
        return

    # Update task to running
    supabase.table("tasks").update({"status": "running", "total": len(creator_ids)}).eq("id", task_id).execute()

    sent = 0
    failed = 0
    for i, cid in enumerate(creator_ids):
        try:
            cr = supabase.table("creators").select("handle, emails").eq("id", cid).execute()
            if not cr.data or not cr.data[0].get("emails"):
                _log.warning("run_outreach: no email for creator %s", cid)
                failed += 1
                continue

            creator = cr.data[0]
            email = creator["emails"][0]
            rendered = body_template.replace("{{recipient_name}}", f"@{creator['handle']}")

            result = gmail.send_gmail(service, email, subject, rendered)

            if result["status"] == "sent":
                _log_outreach(supabase, campaign_id, cid, email, subject, "sent")
                sent += 1
            else:
                error_msg = result.get("error", "Unknown error")
                _log.warning("run_outreach: send failed for @%s (%s): %s",
                             creator["handle"], email, error_msg)
                _log_outreach(supabase, campaign_id, cid, email, subject, "failed", error_msg)
                failed += 1

        except Exception as e:
            _log.warning("run_outreach: failed to process creator %s: %s", cid, e)
            failed += 1

        # Progress every 5
        if (i + 1) % 5 == 0 or i + 1 == len(creator_ids):
            supabase.table("tasks").update({"progress": i + 1}).eq("id", task_id).execute()

    # Finalize
    final_status = "completed" if failed == 0 else ("partial" if sent > 0 else "failed")
    supabase.table("tasks").update({
        "status": final_status,
        "progress": len(creator_ids),
        "meta": {"result_count": sent, "failed_count": failed},
    }).eq("id", task_id).execute()


async def _run_outreach_smtp(task_id, campaign_id, creator_ids, subject, body_template,
                              user_id, supabase, cfg, _log):
    """SMTP send path using async batch sender."""
    creds = cfg.get("credentials_encrypted")
    if not creds or not creds.get("host"):
        supabase.table("tasks").update({"status": "failed", "error": "SMTP not configured"}).eq("id", task_id).execute()
        return

    host = creds["host"]
    port = int(creds.get("port", 587))
    username = creds["username"]
    password = creds["password"]
    from_email = cfg.get("from_email") or creds.get("username")

    # Update task to running
    supabase.table("tasks").update({"status": "running", "total": len(creator_ids)}).eq("id", task_id).execute()

    # Build messages list
    messages = []
    creator_map = {}  # index -> (creator_id, email, handle)
    skipped = 0

    for cid in creator_ids:
        try:
            cr = supabase.table("creators").select("handle, emails").eq("id", cid).execute()
            if not cr.data or not cr.data[0].get("emails"):
                _log.warning("run_outreach: no email for creator %s", cid)
                skipped += 1
                continue

            creator = cr.data[0]
            email = creator["emails"][0]
            rendered = body_template.replace("{{recipient_name}}", f"@{creator['handle']}")

            idx = len(messages)
            messages.append({"to": email, "subject": subject, "body": rendered})
            creator_map[idx] = (cid, email, creator["handle"])
        except Exception as e:
            _log.warning("run_outreach: failed to look up creator %s: %s", cid, e)
            skipped += 1

    if not messages:
        status = "failed" if skipped > 0 else "completed"
        supabase.table("tasks").update({
            "status": status,
            "progress": len(creator_ids),
            "meta": {"result_count": 0, "failed_count": skipped},
            **({"error": "No valid email addresses found"} if skipped > 0 else {}),
        }).eq("id", task_id).execute()
        return

    # Progress callback
    def on_progress(count: int):
        supabase.table("tasks").update({"progress": skipped + count}).eq("id", task_id).execute()

    # Send batch
    results = await send_smtp_batch(
        host=host, port=port, username=username, password=password,
        from_email=from_email, messages=messages, delay=1.5,
        on_progress=on_progress,
    )

    # Log results
    sent = 0
    failed = skipped
    for idx, result in enumerate(results):
        cid, email, handle = creator_map[idx]
        if result["status"] == "sent":
            _log_outreach(supabase, campaign_id, cid, email, subject, "sent")
            sent += 1
        else:
            error_msg = result.get("error", "Unknown error")
            _log.warning("run_outreach: SMTP send failed for @%s (%s): %s", handle, email, error_msg)
            _log_outreach(supabase, campaign_id, cid, email, subject, "failed", error_msg)
            failed += 1

    # Finalize
    final_status = "completed" if failed == 0 else ("partial" if sent > 0 else "failed")
    supabase.table("tasks").update({
        "status": final_status,
        "progress": len(creator_ids),
        "meta": {"result_count": sent, "failed_count": failed},
    }).eq("id", task_id).execute()


class SendRequest(BaseModel):
    campaign_id: str
    creator_ids: list[str]
    subject: str
    body: str
    dry_run: bool = True


@router.post("/send")
async def send_outreach(
    body: SendRequest,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_user),
    supabase=Depends(get_supabase),
):
    """Send outreach emails as a background task."""
    ensure_user_owns_campaign(supabase, user.id, body.campaign_id)

    if body.dry_run:
        # Preview mode — return filled templates without sending
        creators = []
        for cid in body.creator_ids:
            result = supabase.table("creators").select("*").eq("id", cid).execute()
            if result.data:
                creator = result.data[0]
                creators.append({
                    "creator_id": cid,
                    "handle": creator["handle"],
                    "email": creator["emails"][0] if creator.get("emails") and len(creator["emails"]) > 0 else None,
                    "subject": body.subject,
                    "body": body.body.replace("{{recipient_name}}", f"@{creator['handle']}"),
                })
        return {"preview": creators}

    # Real send — create task
    task = supabase.table("tasks").insert({
        "campaign_id": body.campaign_id,
        "user_id": user.id,
        "type": "outreach_batch",
        "status": "queued",
        "total": len(body.creator_ids),
    }).execute()

    if not task.data:
        raise HTTPException(status_code=500, detail="Failed to create outreach task")
    task_id = task.data[0]["id"]

    background_tasks.add_task(run_outreach, task_id, body.campaign_id, body.creator_ids,
                              body.subject, body.body, user.id, supabase)
    return {"task_id": task_id}


class TestEmailRequest(BaseModel):
    to_email: str = ""  # If empty, sends to the connected Gmail address
    subject: str = "Test Email from Influencer Scout"
    body: str = "This is a test email to verify Gmail integration is working."


@router.post("/gmail/test-send")
async def gmail_test_send(
    body: TestEmailRequest,
    user=Depends(get_current_user),
    supabase=Depends(get_supabase),
):
    """Send a single test email to verify Gmail connection works."""
    import logging
    _log = logging.getLogger(__name__)

    # Get user's Gmail tokens
    try:
        result = supabase.table("user_email_config").select(
            "provider, credentials_encrypted"
        ).eq("user_id", user.id).execute()
    except Exception as e:
        raise HTTPException(400, f"Failed to read email config: {e}")

    rows = result.data if result and result.data else []
    if not rows or rows[0].get("provider") != "gmail":
        raise HTTPException(400, "Gmail not connected. Connect in Settings first.")

    token_data = rows[0].get("credentials_encrypted", {})
    if not token_data.get("access_token"):
        raise HTTPException(400, "Gmail tokens missing. Reconnect in Settings.")

    # Resolve recipient — default to the connected Gmail address
    to_email = body.to_email or rows[0].get("gmail_email", "")
    if not to_email:
        raise HTTPException(400, "No recipient email. Reconnect Gmail to detect your email address.")

    # Build Gmail service and send
    try:
        service, updated = gmail.get_gmail_service_from_tokens(token_data)
        if updated:
            supabase.table("user_email_config").update({
                "credentials_encrypted": updated,
            }).eq("user_id", user.id).execute()
    except Exception as e:
        _log.exception("Gmail service build failed")
        raise HTTPException(500, f"Failed to connect to Gmail: {e}")

    result = gmail.send_gmail(service, to_email, body.subject, body.body)
    if result["status"] == "sent":
        return {"status": "sent", "message_id": result.get("message_id")}
    else:
        raise HTTPException(500, result.get("error", "Send failed"))


@router.post("/smtp/test-send")
async def smtp_test_send(
    body: TestEmailRequest,
    user=Depends(get_current_user),
    supabase=Depends(get_supabase),
):
    """Send a single test email via SMTP."""
    # Get user's SMTP config
    try:
        result = supabase.table("user_email_config").select(
            "provider, credentials_encrypted, from_email"
        ).eq("user_id", user.id).execute()
    except Exception as e:
        raise HTTPException(400, f"Failed to read email config: {e}")

    rows = result.data if result and result.data else []
    if not rows or rows[0].get("provider") != "smtp":
        raise HTTPException(400, "SMTP not configured. Set up SMTP in Settings first.")

    creds = rows[0].get("credentials_encrypted", {})
    if not creds or not creds.get("host") or not creds.get("username") or not creds.get("password"):
        raise HTTPException(400, "SMTP credentials incomplete. Reconfigure in Settings.")

    from_email = rows[0].get("from_email") or creds["username"]
    to_email = body.to_email or from_email

    send_result = await send_smtp_single(
        host=creds["host"],
        port=int(creds.get("port", 587)),
        username=creds["username"],
        password=creds["password"],
        from_email=from_email,
        to_email=to_email,
        subject=body.subject,
        body=body.body,
    )

    if send_result["status"] == "sent":
        return {"status": "sent", "to": to_email}
    else:
        raise HTTPException(500, send_result.get("error", "SMTP send failed"))


@router.post("/smtp/detect")
async def smtp_detect(
    body: dict,
    user=Depends(get_current_user),
):
    """Auto-detect SMTP settings from email domain via MX lookup."""
    import asyncio
    import dns.resolver

    email = body.get("email", "")
    domain = email.split("@")[-1].lower() if "@" in email else ""
    if not domain:
        raise HTTPException(400, "Invalid email address")

    # Look up MX records
    try:
        loop = asyncio.get_event_loop()
        mx_records = await loop.run_in_executor(None, lambda: dns.resolver.resolve(domain, "MX"))
        mx_hosts = [str(r.exchange).lower().rstrip(".") for r in mx_records]
    except Exception:
        return {"detected": False, "mx_hosts": []}

    # Match MX patterns to known SMTP settings
    smtp_config = _match_mx_to_smtp(mx_hosts)
    if smtp_config:
        return {"detected": True, "mx_hosts": mx_hosts, **smtp_config}
    return {"detected": False, "mx_hosts": mx_hosts}


def _match_mx_to_smtp(mx_hosts: list[str]) -> dict | None:
    """Match MX record patterns to known SMTP server settings."""
    for mx in mx_hosts:
        # Google Workspace / Gmail
        if "google.com" in mx or "googlemail.com" in mx:
            return {"host": "smtp.gmail.com", "port": 587, "hint": "Google Workspace — requires App Password if 2FA enabled"}

        # Microsoft 365 / Outlook
        if "outlook.com" in mx or "protection.outlook.com" in mx:
            return {"host": "smtp.office365.com", "port": 587, "hint": "Microsoft 365"}

        # AWS WorkMail — extract region from MX host
        if "amazonaws.com" in mx or "awsapps.com" in mx:
            # MX pattern: inbound-smtp.us-east-1.amazonaws.com or similar
            import re
            region_match = re.search(r"(us-east-1|us-west-2|eu-west-1|eu-central-1|ap-southeast-1|ap-southeast-2|ap-northeast-1)", mx)
            region = region_match.group(1) if region_match else "us-east-1"
            return {"host": f"smtp.mail.{region}.awsapps.com", "port": 465, "hint": "AWS WorkMail"}

        # Zoho
        if "zoho.com" in mx or "zoho.eu" in mx or "zoho.in" in mx:
            if "zoho.eu" in mx:
                return {"host": "smtp.zoho.eu", "port": 465, "hint": "Zoho Mail (EU)"}
            if "zoho.in" in mx:
                return {"host": "smtp.zoho.in", "port": 465, "hint": "Zoho Mail (IN)"}
            return {"host": "smtp.zoho.com", "port": 465, "hint": "Zoho Mail"}

        # Yahoo
        if "yahoo.com" in mx or "yahoodns.net" in mx:
            return {"host": "smtp.mail.yahoo.com", "port": 465, "hint": "Yahoo Mail — requires App Password"}

        # Fastmail
        if "fastmail" in mx or "messagingengine.com" in mx:
            return {"host": "smtp.fastmail.com", "port": 465, "hint": "Fastmail"}

        # ProtonMail Bridge (won't work without Bridge, but hint is useful)
        if "protonmail" in mx or "proton.me" in mx:
            return {"host": "127.0.0.1", "port": 1025, "hint": "ProtonMail — requires ProtonMail Bridge running locally"}

        # iCloud
        if "icloud.com" in mx or "apple.com" in mx:
            return {"host": "smtp.mail.me.com", "port": 587, "hint": "iCloud Mail — requires App Password"}

    return None


@router.get("/gmail/auth-url")
async def gmail_auth_url(
    user=Depends(get_current_user),
    return_url: str = Query("", description="Frontend URL to redirect back to after OAuth"),
):
    """Return Google OAuth consent URL for the current user."""
    settings = get_settings()
    if not settings.google_client_id:
        raise HTTPException(400, "Gmail OAuth not configured")
    state = gmail.sign_state(user.id, return_url=return_url)
    url = gmail.build_auth_url(state)
    return {"url": url}


@router.get("/gmail/callback")
async def gmail_callback(code: str = Query(...), state: str = Query(...)):
    """Handle Google OAuth callback — exchange code, store tokens, redirect to frontend."""
    settings = get_settings()
    import logging
    logger = logging.getLogger(__name__)

    # Verify state — on failure redirect with error (never show raw JSON to user)
    try:
        state_data = gmail.verify_state(state)
    except ValueError as e:
        logger.warning("Gmail OAuth state verification failed: %s", e)
        return RedirectResponse(f"{settings.frontend_url}?gmail_error=invalid_state")

    return_url = state_data.get("ret") or settings.frontend_url
    separator = "&" if "?" in return_url else "?"

    # Exchange code for tokens
    try:
        token_data = gmail.exchange_code(code)
    except Exception as e:
        logger.exception("Gmail OAuth token exchange failed")
        return RedirectResponse(f"{return_url}{separator}gmail_error=exchange_failed")

    # gmail_email is already extracted from id_token in exchange_code()
    # No separate API call needed

    # Store tokens server-side, pass only a one-time ref via URL
    ref = gmail.store_tokens(token_data)
    return RedirectResponse(f"{return_url}{separator}gmail_ref={ref}")


@router.post("/gmail/exchange")
async def gmail_exchange(body: dict, user=Depends(get_current_user), supabase=Depends(get_supabase)):
    """Exchange a one-time ref — stores tokens in DB via user's JWT (RLS-safe)."""
    ref = body.get("gmail_ref", "")
    if not ref:
        raise HTTPException(400, "Missing gmail_ref")
    token_data = gmail.retrieve_tokens(ref)
    if token_data is None:
        raise HTTPException(400, "Invalid or expired reference")

    # Store tokens in user_email_config via the user's Supabase client (RLS passes)
    import logging
    _log = logging.getLogger(__name__)

    gmail_email = token_data.pop("gmail_email", "") or ""
    _log.info("gmail_exchange: user_id=%s, gmail_email=%s", user.id, gmail_email)

    # Check if row exists
    try:
        existing = supabase.table("user_email_config").select("id").eq("user_id", user.id).execute()
        has_row = bool(existing.data)
    except Exception as e:
        _log.warning("gmail_exchange: select failed: %s", e)
        has_row = False

    try:
        if has_row:
            result = supabase.table("user_email_config").update({
                "provider": "gmail",
                "credentials_encrypted": token_data,
                "gmail_email": gmail_email,
            }).eq("user_id", user.id).execute()
            _log.info("gmail_exchange: update result: %s", result.data)
        else:
            result = supabase.table("user_email_config").insert({
                "user_id": user.id,
                "provider": "gmail",
                "credentials_encrypted": token_data,
                "gmail_email": gmail_email,
            }).execute()
            _log.info("gmail_exchange: insert result: %s", result.data)
    except Exception as e:
        _log.exception("gmail_exchange: DB write failed")
        raise HTTPException(500, f"Failed to save Gmail config: {e}")

    return {"status": "connected", "email": gmail_email}


@router.get("/gmail/status")
async def gmail_status(user=Depends(get_current_user), supabase=Depends(get_supabase)):
    """Check if Gmail is connected for the current user."""
    try:
        result = supabase.table("user_email_config").select(
            "provider, gmail_email, updated_at"
        ).eq("user_id", user.id).execute()
    except Exception:
        return {"connected": False}

    rows = result.data if result and result.data else []
    if not rows or rows[0].get("provider") != "gmail":
        return {"connected": False}
    return {
        "connected": True,
        "email": rows[0].get("gmail_email"),
        "updated_at": rows[0].get("updated_at"),
    }


@router.post("/gmail/disconnect")
async def gmail_disconnect(user=Depends(get_current_user), supabase=Depends(get_supabase)):
    """Disconnect Gmail — revoke token and clear config."""
    result = supabase.table("user_email_config").select(
        "credentials_encrypted"
    ).eq("user_id", user.id).maybe_single().execute()

    if result.data and result.data.get("credentials_encrypted"):
        token = result.data["credentials_encrypted"].get("access_token")
        if token:
            import httpx
            try:
                async with httpx.AsyncClient() as client:
                    await client.post(
                        "https://oauth2.googleapis.com/revoke",
                        params={"token": token},
                    )
            except Exception:
                pass  # Best-effort revocation

    supabase.table("user_email_config").update({
        "provider": None,
        "credentials_encrypted": None,
        "gmail_email": None,
    }).eq("user_id", user.id).execute()

    return {"status": "disconnected"}
