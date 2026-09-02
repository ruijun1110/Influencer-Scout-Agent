-- Add from_email to user_email_config for SMTP sender address
ALTER TABLE user_email_config ADD COLUMN IF NOT EXISTS from_email text;
