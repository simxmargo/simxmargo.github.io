-- 0004_settings.sql — identity columns for the redesigned Studio Settings page.
--
-- The Settings design ("fills your outreach emails AND your public media kit")
-- makes public_profile the SINGLE identity source feeding both surfaces. These
-- columns hold the outreach-facing identity that previously lived only in the
-- app_settings.profile jsonb. followers/avg-views/engagement are NOT stored here
-- — they derive from social_stats (source 'manual'|'api'); the future TikTok/IG/FB
-- sync writes social_stats with source='api'.
--
-- Idempotent (add column if not exists). DDL is prod-safe; no data backfill.

alter table public_profile add column if not exists handle          text not null default '';
alter table public_profile add column if not exists audience        text not null default '';
alter table public_profile add column if not exists reply_to_email  text not null default '';
alter table public_profile add column if not exists mailing_address text not null default '';
alter table public_profile add column if not exists media_kit_url    text not null default '';
alter table public_profile add column if not exists cover_image_url  text not null default '';

-- Note: the social-share thumbnail (og:image) continues to live in seo->>'og_image_url'.
