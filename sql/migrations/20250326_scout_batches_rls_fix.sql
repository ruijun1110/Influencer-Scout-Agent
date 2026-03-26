-- Fix: scout_batches had wide-open RLS (qual: true), leaking all users' tasks
DROP POLICY "Users can manage scout_batches" ON public.scout_batches;

CREATE POLICY "Users can read own scout_batches" ON public.scout_batches
  FOR SELECT USING (owns_campaign(campaign_id));

CREATE POLICY "Users can insert own scout_batches" ON public.scout_batches
  FOR INSERT WITH CHECK (owns_campaign(campaign_id));

CREATE POLICY "Users can update own scout_batches" ON public.scout_batches
  FOR UPDATE USING (owns_campaign(campaign_id));

CREATE POLICY "Users can delete own scout_batches" ON public.scout_batches
  FOR DELETE USING (owns_campaign(campaign_id));
