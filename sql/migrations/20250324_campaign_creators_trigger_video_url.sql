-- Add trigger video URL to campaign_creators for click-to-play on discover cards
ALTER TABLE campaign_creators ADD COLUMN IF NOT EXISTS trigger_video_url text;
