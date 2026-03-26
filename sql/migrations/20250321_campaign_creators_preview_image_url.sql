-- Discover tab: thumbnail from video search / marketplace scout (null for similar-sourced rows).
alter table public.campaign_creators
  add column if not exists preview_image_url text;

comment on column public.campaign_creators.preview_image_url is
  'Video or marketplace cover URL for Discover cards; use profile cover_url for similar-sourced rows.';
