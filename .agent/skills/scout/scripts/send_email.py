#!/usr/bin/env python3
"""
send_email.py — Gmail API email sending with OAuth2.

Credentials: .agent/credentials/credentials.json (OAuth client, from admin)
Token:       .agent/credentials/token.json (auto-generated per user)
"""
import base64
import mimetypes
import sys
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

CREDENTIALS_DIR = Path(__file__).resolve().parents[3] / 'credentials'
CREDENTIALS_PATH = CREDENTIALS_DIR / 'credentials.json'
TOKEN_PATH = CREDENTIALS_DIR / 'token.json'
SCOPES = ['https://www.googleapis.com/auth/gmail.send']


def get_gmail_service():
    """Build and return an authenticated Gmail API service."""
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    creds = None
    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_PATH.exists():
                print(
                    f"ERROR: Gmail credentials not found at {CREDENTIALS_PATH}\n"
                    "  Get credentials.json from your Google Cloud project admin\n"
                    "  and place it in .agent/credentials/",
                    file=sys.stderr,
                )
                return None
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_PATH), SCOPES)
            creds = flow.run_local_server(port=0)

        TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_PATH.write_text(creds.to_json())

    return build('gmail', 'v1', credentials=creds)


def send_email(to_addresses: list[str], subject: str, body: str,
               sender_email: str = '',
               attachments: list[Path] | None = None) -> dict:
    """Send an email via Gmail API.

    Returns {'status': 'sent'|'failed', 'error': str|None}
    """
    service = get_gmail_service()
    if not service:
        return {'status': 'failed', 'error': 'Gmail service unavailable'}

    try:
        if attachments:
            message = MIMEMultipart()
            message.attach(MIMEText(body))
            for path in attachments:
                mime_type, _ = mimetypes.guess_type(str(path))
                main_type, sub_type = (mime_type or 'application/octet-stream').split('/', 1)
                part = MIMEBase(main_type, sub_type)
                part.set_payload(path.read_bytes())
                encoders.encode_base64(part)
                part.add_header('Content-Disposition', 'attachment', filename=path.name)
                message.attach(part)
        else:
            message = MIMEText(body)

        message['to'] = ', '.join(to_addresses)
        message['subject'] = subject
        if sender_email:
            message['from'] = sender_email

        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
        result = service.users().messages().send(
            userId='me',
            body={'raw': raw},
        ).execute()

        return {'status': 'sent', 'error': None, 'message_id': result.get('id')}
    except Exception as e:
        return {'status': 'failed', 'error': str(e)}


def setup_gmail_oauth():
    """Run the OAuth flow interactively to generate token.json."""
    service = get_gmail_service()
    if service:
        print("Gmail OAuth setup complete. Token saved.")
    else:
        print("Gmail OAuth setup failed.", file=sys.stderr)
        sys.exit(1)
