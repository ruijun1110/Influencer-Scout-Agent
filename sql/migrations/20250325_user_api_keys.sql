CREATE TABLE IF NOT EXISTS user_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) UNIQUE,
  tikhub_api_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own keys" ON user_api_keys FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own keys" ON user_api_keys FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own keys" ON user_api_keys FOR UPDATE USING (user_id = auth.uid());
