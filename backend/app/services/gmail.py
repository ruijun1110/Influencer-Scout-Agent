"""Gmail OAuth and sending service for the web app."""

import base64
import hashlib
import hmac
import json
import logging
import time
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders

from app.core.config import get_settings

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]




def _client_config() -> dict:
    settings = get_settings()
    return {
        "web": {
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [settings.google_redirect_uri],
        }
    }


def build_auth_url(state: str) -> str:
    """Generate Google OAuth consent URL (manual construction, no PKCE)."""
    from urllib.parse import urlencode

    settings = get_settings()
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"https://accounts.google.com/o/oauth2/auth?{urlencode(params)}"


def exchange_code(code: str) -> dict:
    """Exchange authorization code for tokens.

    Uses google.oauth2 utilities directly (the recommended approach) rather
    than google_auth_oauthlib.Flow, which adds PKCE that complicates
    stateless server flows.
    """
    from google.auth.transport.requests import Request as GoogleAuthRequest
    import google.auth.transport.requests
    import requests as _requests

    settings = get_settings()
    resp = _requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": settings.google_redirect_uri,
            "grant_type": "authorization_code",
        },
        timeout=30,
    )
    if resp.status_code != 200:
        logger.error("Google token exchange failed: %s %s", resp.status_code, resp.text)
        resp.raise_for_status()
    data = resp.json()

    # Extract email from id_token (JWT) if present — avoids a separate API call
    gmail_email = ""
    id_token = data.get("id_token")
    if id_token:
        try:
            # Decode JWT payload without verification (we trust Google's response)
            payload_b64 = id_token.split(".")[1]
            # Add padding
            payload_b64 += "=" * (4 - len(payload_b64) % 4)
            payload = json.loads(base64.urlsafe_b64decode(payload_b64))
            gmail_email = payload.get("email", "")
        except Exception as e:
            logger.warning("Failed to decode id_token for email: %s", e)

    return {
        "access_token": data.get("access_token"),
        "refresh_token": data.get("refresh_token"),
        "expiry": None,
        "gmail_email": gmail_email,
    }


# ---------------------------------------------------------------------------
# Temporary one-time token store (tokens never touch URLs)
# ---------------------------------------------------------------------------
import secrets
import threading

_token_store: dict[str, tuple[float, dict]] = {}  # ref -> (expiry_ts, token_data)
_store_lock = threading.Lock()
_TOKEN_TTL = 120  # seconds


def store_tokens(token_data: dict) -> str:
    """Store tokens server-side and return a one-time reference UUID."""
    ref = secrets.token_urlsafe(32)
    expiry = time.time() + _TOKEN_TTL
    with _store_lock:
        # Prune expired entries
        now = time.time()
        expired = [k for k, (exp, _) in _token_store.items() if exp < now]
        for k in expired:
            del _token_store[k]
        _token_store[ref] = (expiry, token_data)
    return ref


def retrieve_tokens(ref: str) -> dict | None:
    """Retrieve and delete tokens by reference. Returns None if expired/missing."""
    with _store_lock:
        entry = _token_store.pop(ref, None)
    if entry is None:
        return None
    expiry, token_data = entry
    if time.time() > expiry:
        return None
    return token_data


def get_gmail_service_from_tokens(token_data: dict):
    """Build Gmail API service from stored tokens, refreshing if needed.

    Returns (service, updated_token_data_or_None).
    """
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    settings = get_settings()
    creds = Credentials(
        token=token_data.get("access_token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        scopes=SCOPES,
    )

    updated = None
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        updated = {
            "access_token": creds.token,
            "refresh_token": creds.refresh_token,
            "expiry": creds.expiry.isoformat() if creds.expiry else None,
        }

    service = build("gmail", "v1", credentials=creds)
    return service, updated


def get_gmail_profile(service) -> str | None:
    """Get the authenticated user's Gmail address."""
    try:
        profile = service.users().getProfile(userId="me").execute()
        return profile.get("emailAddress")
    except Exception as e:
        logger.warning("Failed to get Gmail profile: %s", e)
        return None


def send_gmail(service, to_email: str, subject: str, body: str, attachments: list[dict] | None = None) -> dict:
    """Send an email via Gmail API.

    attachments: list of {"filename": str, "content": bytes, "mime_type": str}
    """
    if attachments:
        msg = MIMEMultipart()
        msg.attach(MIMEText(body))
        for att in attachments:
            part = MIMEBase(*att["mime_type"].split("/", 1))
            part.set_payload(att["content"])
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f'attachment; filename="{att["filename"]}"')
            msg.attach(part)
    else:
        msg = MIMEText(body)

    msg["to"] = to_email
    msg["subject"] = subject

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    try:
        result = service.users().messages().send(
            userId="me", body={"raw": raw}
        ).execute()
        return {"status": "sent", "message_id": result.get("id")}
    except Exception as e:
        logger.exception("Failed to send Gmail to %s", to_email)
        return {"status": "failed", "error": str(e)}


# --- State signing for CSRF protection ---

def sign_state(user_id: str, return_url: str = "") -> str:
    """Create HMAC-signed state: base64(json({uid, ts, ret})).signature"""
    secret = get_settings().google_client_secret
    payload = json.dumps({"uid": user_id, "ts": int(time.time()), "ret": return_url})
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]
    encoded = base64.urlsafe_b64encode(payload.encode()).decode()
    return f"{encoded}.{sig}"


def verify_state(state: str) -> dict:
    """Verify state and return full payload dict. Raises ValueError on invalid/expired."""
    secret = get_settings().google_client_secret
    try:
        encoded, sig = state.rsplit(".", 1)
    except ValueError:
        raise ValueError("Invalid state format")
    payload = base64.urlsafe_b64decode(encoded).decode()
    expected_sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]
    if not hmac.compare_digest(sig, expected_sig):
        raise ValueError("Invalid state signature")
    data = json.loads(payload)
    if time.time() - data["ts"] > 600:
        raise ValueError("State expired")
    return data
