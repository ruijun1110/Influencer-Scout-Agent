ALTER TABLE user_email_config
  ADD COLUMN IF NOT EXISTS gmail_email text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
