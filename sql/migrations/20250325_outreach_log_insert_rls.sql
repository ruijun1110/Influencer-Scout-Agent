CREATE POLICY "Users can insert outreach_log via campaign ownership" ON outreach_log
  FOR INSERT TO authenticated
  WITH CHECK (owns_campaign(campaign_id));
