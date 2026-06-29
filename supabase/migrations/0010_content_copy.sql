-- 0010_content_copy.sql
-- Admin-editable marketing copy for strings that were previously hardcoded in the
-- public media-kit components — starting with the footer headline.
--
-- One jsonb map keyed by copy-slot (e.g. footerHeadline, footerEmphasis) rather than a
-- column per string, so making another section editable later is just a new key + a
-- form field — no migration per string. Any missing key falls back to DEFAULT_SITE_COPY
-- in the app (lib/mediakit-types.ts), so existing rows render correctly with no backfill.
--
-- Idempotent (add column if not exists) — safe to re-run via `npm run db:apply`.
-- RLS is unchanged: public_profile already has the admin-write (is_admin) + public-read
-- policies from 0007, and they apply to every column including this one.
alter table public.public_profile
  add column if not exists content jsonb not null default '{}'::jsonb;
