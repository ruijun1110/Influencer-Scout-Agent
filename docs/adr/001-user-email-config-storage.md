# ADR 001: User email configuration storage

## Context

The web app persists SMTP (and future OAuth) settings in Supabase table `user_email_config`, in a JSON column named `credentials_encrypted`.

## Decision

- The column name suggests encryption, but **values are stored as plaintext JSON** from the client unless additional encryption is added.
- Access must be restricted with **Row Level Security** so each row is readable/writable only by `user_id = auth.uid()`.

## Consequences

- Suitable for low-sensitivity SMTP app passwords only if RLS is correctly enforced and the database is trusted.
- For production hardening, prefer: Edge Function + vault, server-side encryption, or OAuth tokens without storing raw passwords in Postgres.

## References

- [web/src/pages/settings.tsx](../../web/src/pages/settings.tsx)
