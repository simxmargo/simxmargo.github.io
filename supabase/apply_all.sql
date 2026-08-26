-- GENERATED: paste this whole file into the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> Run).
-- Concatenation of every supabase/migrations/*.sql, in order. Idempotent - safe to re-run.
-- Source of truth remains the individual files in supabase/migrations/.

-- ===== 0001_init.sql =====
-- brand-outreach-studio — initial schema (single-user tool).
-- Apply with:  supabase db push   (or paste into the Supabase SQL editor).
-- Design rationale lives in docs/BACKEND_DESIGN.md.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- scrape_jobs: brand sites to pull contacts from (the scraper's input queue).
-- ---------------------------------------------------------------------------
create table if not exists scrape_jobs (
  id          uuid primary key default gen_random_uuid(),
  brand       text not null,
  website     text not null,
  country     text default '',
  status      text not null default 'pending'
              check (status in ('pending','scraping','done','needs_browser','error')),
  error       text,
  created_at  timestamptz not null default now(),
  scraped_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- contacts: discovered + enriched + AI-scored leads. Mirrors the UI Contact type.
-- ---------------------------------------------------------------------------
create table if not exists contacts (
  id              uuid primary key default gen_random_uuid(),
  brand           text not null,
  email           text not null,
  email_type      text not null default 'generic'
                  check (email_type in ('partnerships','press','generic','named')),
  country         text default '',
  website         text default '',
  fit_score       int check (fit_score between 1 and 10),
  fit_reason      text default '',
  status          text not null default 'new'
                  check (status in ('new','queued','sent','replied','bounced','skip')),
  notes           text default '',
  source_url      text default '',
  confidence      int,                       -- enrichment confidence 0-100
  last_emailed_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (email)                             -- dedup across runs (the core "skip already seen")
);

-- ---------------------------------------------------------------------------
-- send_queue: outbound emails, drained by pg_cron under a daily cap.
-- ---------------------------------------------------------------------------
create table if not exists send_queue (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references contacts(id) on delete cascade,
  subject       text not null,
  body          text not null,
  reply_to      text not null,
  status        text not null default 'queued'
                check (status in ('queued','sending','sent','failed','canceled')),
  attempts      int not null default 0,
  scheduled_for timestamptz not null default now(),
  sent_at       timestamptz,
  error         text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- suppression_list: opt-outs + hard bounces. NEVER re-contact these (CAN-SPAM).
-- ---------------------------------------------------------------------------
create table if not exists suppression_list (
  email      text primary key,
  reason     text not null check (reason in ('opt_out','bounce','manual')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- app_settings: single-row config (creator profile + sending caps).
-- ---------------------------------------------------------------------------
create table if not exists app_settings (
  id           int primary key default 1 check (id = 1),
  profile      jsonb not null default '{}'::jsonb,   -- the CreatorProfile object
  daily_cap    int not null default 20,
  warmup_start int not null default 5,
  updated_at   timestamptz not null default now()
);
insert into app_settings (id) values (1) on conflict (id) do nothing;

-- Refuse to queue an email to a suppressed address — compliance enforced in the DB,
-- not just the UI.
create or replace function block_suppressed_send() returns trigger
language plpgsql as $$
begin
  if exists (
    select 1
    from contacts c
    join suppression_list s on s.email = c.email
    where c.id = new.contact_id
  ) then
    raise exception 'Address is on the suppression list and cannot be emailed.';
  end if;
  return new;
end $$;

drop trigger if exists trg_block_suppressed on send_queue;
create trigger trg_block_suppressed
  before insert on send_queue
  for each row execute function block_suppressed_send();

-- ---------------------------------------------------------------------------
-- RLS (single owner). The frontend uses the anon key + your one login; Edge
-- Functions use the service-role key and bypass RLS for their server-side writes.
-- ---------------------------------------------------------------------------
alter table scrape_jobs      enable row level security;
alter table contacts         enable row level security;
alter table send_queue       enable row level security;
alter table suppression_list enable row level security;
alter table app_settings     enable row level security;

-- `create policy` has no IF NOT EXISTS, so drop-then-create keeps this migration
-- re-runnable (db:apply re-applies every file each run).
drop policy if exists "owner all" on scrape_jobs;
create policy "owner all" on scrape_jobs      for all to authenticated using (true) with check (true);
drop policy if exists "owner all" on contacts;
create policy "owner all" on contacts         for all to authenticated using (true) with check (true);
drop policy if exists "owner all" on send_queue;
create policy "owner all" on send_queue       for all to authenticated using (true) with check (true);
drop policy if exists "owner all" on suppression_list;
create policy "owner all" on suppression_list for all to authenticated using (true) with check (true);
drop policy if exists "owner all" on app_settings;
create policy "owner all" on app_settings     for all to authenticated using (true) with check (true);

-- ===== 0002_enrich.sql =====
-- Enrichment bookkeeping for the `enrich` Edge Function.
--
-- Hunter.io's free tier is ~25 domain searches/month, so re-running enrichment
-- must never re-spend a credit on a domain it already searched (the "cache
-- everything" rule in docs/BACKEND_DESIGN.md §4). `enrich` selects scrape_jobs
-- that are `done` with `enriched_at is null`, then stamps this column when it's
-- done with that domain. Idempotent — safe to re-run.

alter table scrape_jobs add column if not exists enriched_at timestamptz;

-- ===== 0003_mediakit.sql =====
-- Mediakit (public-facing) data model for the simxmargo unified app.
--
-- These four tables back the PUBLIC mediakit at "/". The security model is the
-- crux (see docs/MEDIAKIT_PLAN.md): the anon key ships in the browser, so RLS is
-- the read boundary and ALL writes go through the service-role key inside
-- passphrase-gated server routes (never from the browser).
--
--   anon role  → SELECT on published/visible public rows; INSERT on collab_inquiries only.
--   service    → full access (admin writes), bypasses RLS entirely.
--
-- Idempotent (create ... if not exists / drop policy if exists). Apply with
-- `npm run db:apply`. Existing tables (contacts, app_settings, …) are untouched.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- public_profile: single-row mediakit identity/config (mirrors app_settings id=1).
-- Deliberately separate from app_settings (which holds the OUTBOUND email profile
-- + caps) so the public page and the email template stay decoupled.
-- ---------------------------------------------------------------------------
create table if not exists public_profile (
  id              int primary key default 1 check (id = 1),
  display_name    text not null default '',
  tagline         text default '',
  bio_md          text default '',                       -- About section (markdown; sanitize on render)
  avatar_url      text default '',
  hero_image_url  text default '',
  location        text default '',
  niche           text default '',
  total_followers bigint,                                -- null ⇒ compute SUM(social_stats.followers)
  rate_card       jsonb not null default '[]'::jsonb,    -- [{deliverable, price, currency, note}]
  press_logos     jsonb not null default '[]'::jsonb,    -- [{name, logo_url, url}]
  theme           jsonb not null default '{}'::jsonb,    -- dark-theme accent overrides
  seo             jsonb not null default '{}'::jsonb,    -- {title, description, og_image_url}
  is_published    boolean not null default false,        -- draft until ready; gates anon read
  updated_at      timestamptz not null default now()
);
insert into public_profile (id, display_name, niche, location)
  values (1, 'simxmargo', 'fashion / lifestyle', 'Philippines')
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- portfolio_brands: one row per partnership shown in the public grid.
-- ---------------------------------------------------------------------------
create table if not exists portfolio_brands (
  id             uuid primary key default gen_random_uuid(),
  brand          text not null,
  website        text default '',                        -- normalized origin (feeds auto-create-from-URL)
  logo_url       text default '',
  blurb          text default '',
  campaign_title text default '',
  metrics        jsonb not null default '{}'::jsonb,     -- {reach, impressions, views, engagement_rate, deliverables}
  media          jsonb not null default '[]'::jsonb,     -- [{type:'image'|'video'|'embed', url, thumb_url, platform}]
  category       text default '',
  featured       boolean not null default false,
  sort_order     int not null default 0,
  is_visible     boolean not null default true,
  contact_id     uuid references contacts(id) on delete set null,  -- optional: promoted from an outreach contact
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_portfolio_brands_order on portfolio_brands (featured desc, sort_order, created_at);

-- ---------------------------------------------------------------------------
-- social_stats: one row per platform (follower/engagement + growth history).
-- ---------------------------------------------------------------------------
create table if not exists social_stats (
  id              uuid primary key default gen_random_uuid(),
  platform        text not null check (platform in ('tiktok','instagram','facebook','youtube','x','twitch')),
  handle          text not null default '',
  profile_url     text default '',
  followers       bigint not null default 0,
  avg_views       bigint,
  engagement_rate numeric(5,2),
  growth_30d      numeric(6,2),
  history         jsonb not null default '[]'::jsonb,    -- [{date, followers}] snapshots
  source          text not null default 'manual' check (source in ('manual','api')),
  sort_order      int not null default 0,
  is_visible      boolean not null default true,
  synced_at       timestamptz,
  updated_at      timestamptz not null default now(),
  unique (platform)
);
-- Seed the real follower split: TikTok 2.7M, Instagram 1.3M, Facebook 394k (= 4.4M).
insert into social_stats (platform, handle, followers, sort_order) values
  ('tiktok',    '@simxmargo', 2700000, 1),
  ('instagram', '@simxmargo', 1300000, 2),
  ('facebook',  'simxmargo',   394000, 3)
on conflict (platform) do nothing;

-- ---------------------------------------------------------------------------
-- collab_inquiries: the ONLY anon-write surface (the public "Work with me" form).
-- Write-only to the public — there is intentionally NO anon SELECT.
-- ---------------------------------------------------------------------------
create table if not exists collab_inquiries (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(name) between 1 and 120),
  email               text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  company             text default '' check (char_length(company) <= 160),
  budget              text default '',
  message             text not null check (char_length(message) between 1 and 4000),
  deliverables        text[] not null default '{}',
  source_path         text default '',
  status              text not null default 'new' check (status in ('new','read','replied','archived','spam')),
  promoted_contact_id uuid references contacts(id) on delete set null,
  ip_hash             text default '',                   -- hashed server-side, never the raw IP
  user_agent          text default '',
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS. Public tables: anon SELECT on published/visible rows. collab_inquiries:
-- anon INSERT only (no SELECT). The "owner all" (authenticated) policies mirror
-- 0001's convention; the real admin path is the service-role key (bypasses RLS).
-- ---------------------------------------------------------------------------
alter table public_profile   enable row level security;
alter table portfolio_brands enable row level security;
alter table social_stats     enable row level security;
alter table collab_inquiries enable row level security;

drop policy if exists "public read published" on public_profile;
create policy "public read published" on public_profile
  for select to anon, authenticated using (is_published = true);
drop policy if exists "owner all" on public_profile;
create policy "owner all" on public_profile
  for all to authenticated using (true) with check (true);

drop policy if exists "public read visible" on portfolio_brands;
create policy "public read visible" on portfolio_brands
  for select to anon, authenticated using (is_visible = true);
drop policy if exists "owner all" on portfolio_brands;
create policy "owner all" on portfolio_brands
  for all to authenticated using (true) with check (true);

drop policy if exists "public read visible" on social_stats;
create policy "public read visible" on social_stats
  for select to anon, authenticated using (is_visible = true);
drop policy if exists "owner all" on social_stats;
create policy "owner all" on social_stats
  for all to authenticated using (true) with check (true);

-- Anon may INSERT a new inquiry, but NEVER read the inbox. Do not add anon SELECT here.
drop policy if exists "anon insert" on collab_inquiries;
create policy "anon insert" on collab_inquiries
  for insert to anon with check (status = 'new' and char_length(message) > 0);
drop policy if exists "owner all" on collab_inquiries;
create policy "owner all" on collab_inquiries
  for all to authenticated using (true) with check (true);

-- ===== 0004_settings.sql =====
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

-- ===== 0005_favicon.sql =====
-- Favicon: the browser-tab icon for the whole site (public kit + admin).
-- Editable in Settings → uploaded to storage, URL stored here. A dedicated column
-- (rather than the seo jsonb) keeps it typed and avoids read-merge-write clobber
-- between the Profile route (which owns seo.og_image_url) and the Settings route.
alter table public.public_profile add column if not exists favicon_url text;

-- ===== 0006_brand_rows.sql =====
-- Which marquee row a brand appears in on the public "brand partners" carousel.
-- NULL ⇒ the page auto-splits the list in half (back-compat for existing rows).
-- The "Top content" per-post fields (views/likes/caption) live inside the existing
-- portfolio_brands.media jsonb, so they need no column change.
alter table public.portfolio_brands
  add column if not exists row_index smallint
  check (row_index is null or row_index in (1, 2));

-- ===== 0007_admin_rls.sql =====
-- 0007_admin_rls.sql
-- Switch the admin from "service-role bypasses RLS behind a server passphrase" to
-- "authenticated admin, gated by RLS" — the prerequisite for a browser-only /admin SPA.
--
-- After applying (npm run db:apply):
--   1) Create the admin auth user in the Supabase dashboard (Authentication → Users).
--   2) Seed it below (uncomment + set the email), or run it once by hand:
--        insert into public.admins (id)
--          select id from auth.users where email = 'REPLACE_ME@example.com'
--          on conflict do nothing;
--   3) Supabase → Authentication → Settings: DISABLE public sign-ups (defense in depth).
--
-- SAFETY: this only tightens write access (owner-all-authenticated → is_admin()) and
-- leaves the existing public read / anon-insert policies intact. The public site keeps
-- working throughout.

begin;

-- ── Admin identity ────────────────────────────────────────────────────────────
create table if not exists public.admins (
  id        uuid primary key references auth.users(id) on delete cascade,
  added_at  timestamptz not null default now()
);
alter table public.admins enable row level security;

-- SECURITY DEFINER so it can read public.admins past that table's own RLS without
-- recursion. STABLE so the planner can cache it within a statement.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- Admins may read the admins list; inserts are intentionally service-role/SQL only
-- (no self-grant). is_admin() (definer) still works regardless of this policy.
drop policy if exists "admins read" on public.admins;
create policy "admins read" on public.admins
  for select to authenticated using (public.is_admin());

-- Idempotency: drop the new "admin all" policies first so re-running this migration
-- (db:apply re-runs every file) doesn't error on already-existing policies.
drop policy if exists "admin all" on public.public_profile;
drop policy if exists "admin all" on public.portfolio_brands;
drop policy if exists "admin all" on public.social_stats;
drop policy if exists "admin all" on public.collab_inquiries;
drop policy if exists "admin all" on public.contacts;
drop policy if exists "admin all" on public.app_settings;
drop policy if exists "admin all" on public.scrape_jobs;
drop policy if exists "admin all" on public.send_queue;
drop policy if exists "admin all" on public.suppression_list;

-- ── Media-kit tables: keep public reads, replace owner-all with is_admin() ──────
-- public_profile (single row id=1)
drop policy if exists "owner all" on public.public_profile;
create policy "admin all" on public.public_profile
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- portfolio_brands
drop policy if exists "owner all" on public.portfolio_brands;
create policy "admin all" on public.portfolio_brands
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- social_stats
drop policy if exists "owner all" on public.social_stats;
create policy "admin all" on public.social_stats
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- collab_inquiries: keep the anon INSERT policy; admin gets read/update/delete
drop policy if exists "owner all" on public.collab_inquiries;
create policy "admin all" on public.collab_inquiries
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── Outreach / config tables: admin-only (no public access) ─────────────────────
drop policy if exists "owner all" on public.contacts;
create policy "admin all" on public.contacts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "owner all" on public.app_settings;
create policy "admin all" on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "owner all" on public.scrape_jobs;
create policy "admin all" on public.scrape_jobs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "owner all" on public.send_queue;
create policy "admin all" on public.send_queue
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "owner all" on public.suppression_list;
create policy "admin all" on public.suppression_list
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── Storage: 'media' bucket = public read, admin-only writes ────────────────────
insert into storage.buckets (id, name, public)
  values ('media', 'media', true)
  on conflict (id) do nothing;

drop policy if exists "media public read" on storage.objects;
create policy "media public read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'media');

drop policy if exists "media admin insert" on storage.objects;
create policy "media admin insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'media' and public.is_admin());

drop policy if exists "media admin update" on storage.objects;
create policy "media admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and public.is_admin())
  with check (bucket_id = 'media' and public.is_admin());

drop policy if exists "media admin delete" on storage.objects;
create policy "media admin delete" on storage.objects
  for delete to authenticated using (bucket_id = 'media' and public.is_admin());

-- ── Seed the admin (the influencer's account; idempotent) ───────────────────────
insert into public.admins (id)
  select id from auth.users where email = 'simxmargo.collab@gmail.com'
  on conflict do nothing;

commit;

-- ===== 0008_brand_campaign_fields.sql =====
-- Per-brand campaign fields for the public brand-detail modal.
--
-- These power the modal's START / END / TOTAL VIEWS stats. They are MANUAL and
-- NULLABLE on purpose: a blank field renders a quiet "~" empty state in the modal
-- (never a fabricated date or count). DELIVERABLES stays DERIVED from the existing
-- media[] jsonb (count of top-content pieces) on the client, so it needs no column.
--
-- Idempotent (add column if not exists) — safe to re-run. Apply with
-- `npm run db:apply`. Existing portfolio_brands rows are untouched (all columns null).
alter table public.portfolio_brands
  add column if not exists start_date  date,
  add column if not exists end_date    date,
  add column if not exists total_views bigint;

-- ===== 0009_show_rates.sql =====
-- Per-profile toggle to HIDE the public "Rates" section without deleting the rate
-- card. Defaults true so existing profiles keep showing rates (no behaviour change
-- until the admin turns it off). Parallels public_profile.is_published. Idempotent.
alter table public_profile
  add column if not exists show_rates boolean not null default true;

-- ===== 0010_content_copy.sql =====
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

-- ===== 0011_show_rates_section.sql =====
-- Per-profile toggle to HIDE the whole public "Rates" section (its heading, the
-- rate list, and the "Rates" nav link) — independent of `show_rates` (0009), which
-- only swaps the PRICES for a "Let's talk" invite while the section still renders.
-- Two orthogonal controls: this one removes the section entirely; show_rates dims
-- pricing within it. Defaults true so existing profiles are unchanged until the
-- admin turns it off. Idempotent.
alter table public_profile
  add column if not exists show_rates_section boolean not null default true;

-- ===== 0012_sending_account.sql =====
-- 0012_sending_account.sql
-- The Gmail SENDING ACCOUNT for the outreach pipeline (docs/BACKEND_DESIGN.md §6b).
--
-- Two tables + one read-only RPC:
--   gmail_account  — single row (id=1) holding the OAuth refresh token. THE SECRET.
--   oauth_states   — short-lived, single-use CSRF/authorization nonces for the
--                    consent redirect (the callback can't carry a JWT).
--   sending_account_status() — what the studio UI is allowed to see. Never the token.
--
-- SECURITY MODEL — read this before adding a policy:
--   Both tables have RLS ENABLED and ZERO policies. In Postgres, RLS-on + no policy
--   = deny-all for every non-superuser role, including `authenticated` (the logged-in
--   admin). Only the service-role key — which lives ONLY in Edge Functions, never in
--   the browser bundle — can touch these rows. That is deliberate: the refresh token
--   is a long-lived credential to send mail as the user, so the browser must never be
--   able to SELECT it, not even as the admin. The UI instead calls the SECURITY
--   DEFINER function below, which returns connection STATUS only.
--   Do NOT add an "admin all" policy to these tables.
--
-- Idempotent (create-if-not-exists / create-or-replace) because `npm run db:apply`
-- re-runs every migration file.

begin;

-- ---------------------------------------------------------------------------
-- gmail_account: the connected sending identity. Single row, like app_settings.
-- ---------------------------------------------------------------------------
create table if not exists public.gmail_account (
  id             int primary key default 1 check (id = 1),
  email          text not null default '',          -- the connected Gmail address
  refresh_token  text,                              -- SECRET. null ⇒ not connected
  scope          text not null default '',          -- scopes Google actually granted
  connected_at   timestamptz,
  last_send_at   timestamptz,                       -- stamped by send-one (§6c)
  needs_reauth   boolean not null default false,    -- set on invalid_grant
  reauth_reason  text not null default '',
  updated_at     timestamptz not null default now()
);

insert into public.gmail_account (id) values (1) on conflict (id) do nothing;

alter table public.gmail_account enable row level security;

-- Re-assert deny-all: if a policy was ever added by hand, this migration removes it.
drop policy if exists "admin all" on public.gmail_account;
drop policy if exists "owner all" on public.gmail_account;

-- Belt-and-braces beyond RLS: strip the blanket grants Supabase hands the API roles,
-- so a future accidental `alter table ... disable row level security` still doesn't
-- expose the token. SECURITY DEFINER functions run as the owner and are unaffected.
revoke all on table public.gmail_account from anon, authenticated;

-- ---------------------------------------------------------------------------
-- oauth_states: single-use nonces for the Google consent redirect.
--
-- Why this is the authorization boundary: the `gmail-oauth` function is deployed
-- with --no-verify-jwt (Google redirects a raw browser, no Authorization header),
-- so the callback proves legitimacy by presenting a `state` that only an
-- admin-authenticated POST could have created. Rows are consumed atomically
-- (update ... where used_at is null returning) so a replayed state is rejected.
-- ---------------------------------------------------------------------------
create table if not exists public.oauth_states (
  state       text primary key,
  purpose     text not null default 'gmail',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '10 minutes'),
  used_at     timestamptz
);

alter table public.oauth_states enable row level security;
drop policy if exists "admin all" on public.oauth_states;
revoke all on table public.oauth_states from anon, authenticated;

-- Supports the housekeeping delete in the Edge Function (purge expired on each start).
create index if not exists oauth_states_expires_idx on public.oauth_states (expires_at);

-- ---------------------------------------------------------------------------
-- sending_account_status(): the ONLY window the browser gets onto gmail_account.
--
-- SECURITY DEFINER so it can read past the table's deny-all RLS, but it selects an
-- explicit column list that OMITS refresh_token, and gates on is_admin() in the
-- WHERE clause — a non-admin caller gets zero rows, not an error (fail closed).
-- ---------------------------------------------------------------------------
create or replace function public.sending_account_status()
returns table (
  connected      boolean,
  email          text,
  connected_at   timestamptz,
  last_send_at   timestamptz,
  needs_reauth   boolean,
  reauth_reason  text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (g.refresh_token is not null and length(g.refresh_token) > 0) as connected,
    g.email,
    g.connected_at,
    g.last_send_at,
    g.needs_reauth,
    g.reauth_reason
  from public.gmail_account g
  where g.id = 1 and public.is_admin();
$$;

revoke all on function public.sending_account_status() from public, anon;
grant execute on function public.sending_account_status() to authenticated;

commit;

-- ===== 0013_send_queue.sql =====
-- 0013_send_queue.sql
-- Makes the EXISTING `send_queue` table (0001_init.sql) actually drivable, and turns
-- on the scheduling half: pg_cron + pg_net + an atomic claim function.
--
-- WHY THIS IS AN ALTER, NOT A CREATE:
--   `send_queue` has existed since 0001 and already carries `trg_block_suppressed`,
--   the BEFORE INSERT trigger that refuses sends to suppressed addresses. Recreating
--   the table would drop that trigger on the floor — the one piece of CAN-SPAM
--   enforcement the system has left now that the opt-out footer is gone (§7). So this
--   migration adapts to the original column names (`scheduled_for`, `error`) and the
--   original status vocabulary ('queued', not 'pending') rather than renaming them.
--
-- WHY A 'sending' STATUS MATTERS:
--   The gap between "this is due" and "Gmail accepted it" contains a network call.
--   Without a claimed state, two overlapping cron ticks both see the same due row and
--   the brand receives the pitch twice. claim_due_sends() flips rows to 'sending'
--   inside the same statement that selects them, under FOR UPDATE SKIP LOCKED, so a
--   second worker cannot see them at all.
--
-- Idempotent — `npm run db:apply` re-runs every migration file.

begin;

-- pg_cron schedules the drain; pg_net is how a scheduled SQL job reaches an Edge
-- Function over HTTP. Both ship with Supabase but are not enabled by default.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Columns 0001 didn't have.
-- ---------------------------------------------------------------------------

-- Needed to detect a worker that died mid-send: "claimed, but not touched in 10
-- minutes" is only answerable if we record when a row was last touched.
alter table public.send_queue add column if not exists updated_at timestamptz not null default now();

-- Gmail's id for the sent message — the only durable handle for "which message was
-- this?" when reconciling against the sent folder later.
alter table public.send_queue add column if not exists gmail_message_id text not null default '';

-- 0001 declared reply_to NOT NULL with no default, so every insert had to supply it.
-- The Reply-To is now derived server-side from public_profile at send time (one source
-- of truth), so the column must not force the caller to duplicate it.
alter table public.send_queue alter column reply_to set default '';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- The drain's hot path: "what is queued and due?"
create index if not exists send_queue_due_idx
  on public.send_queue (scheduled_for)
  where status = 'queued';

create index if not exists send_queue_contact_idx on public.send_queue (contact_id);

-- One live send per contact. Double-clicking "Queue for Outreach", or queuing a brand
-- that's already waiting, must not put the same pitch on the wire twice. Terminal rows
-- (sent/failed/canceled) are excluded so re-sending later stays possible.
create unique index if not exists send_queue_one_live_per_contact
  on public.send_queue (contact_id)
  where status in ('queued','sending');

-- ---------------------------------------------------------------------------
-- claim_due_sends(): atomically hand a worker the rows it may send.
--
-- SECURITY DEFINER and revoked from anon/authenticated: only the service role (which
-- exists solely inside Edge Functions) can claim work. The browser queues and cancels
-- through RLS; it can never trigger a send directly.
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_sends(p_limit int default 5)
returns setof public.send_queue
language sql
volatile
security definer
set search_path = public
as $$
  update public.send_queue q
     set status = 'sending',
         attempts = q.attempts + 1,
         updated_at = now()
   where q.id in (
     select id
       from public.send_queue
      where status = 'queued'
        and scheduled_for <= now()
      order by scheduled_for
      for update skip locked
      limit greatest(1, least(p_limit, 25))
   )
  returning q.*;
$$;

revoke all on function public.claim_due_sends(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reclaim rows stranded in 'sending' by a worker that died mid-flight (function
-- timeout, a deploy landing mid-tick). Ten minutes is far longer than a send takes,
-- so anything older is genuinely orphaned.
--
-- Back to 'queued' only while under the attempt ceiling — a row that keeps killing
-- its worker is a bug, and retrying it forever just keeps re-hitting the same wall.
-- ---------------------------------------------------------------------------
create or replace function public.requeue_stuck_sends()
returns int
language sql
volatile
security definer
set search_path = public
as $$
  with bumped as (
    update public.send_queue
       set status = case when attempts >= 3 then 'failed' else 'queued' end,
           error  = case when attempts >= 3
                         then 'Gave up after 3 attempts (worker kept dying mid-send).'
                         else error end,
           updated_at = now()
     where status = 'sending'
       and updated_at < now() - interval '10 minutes'
    returning 1
  )
  select coalesce(count(*), 0)::int from bumped;
$$;

revoke all on function public.requeue_stuck_sends() from public, anon, authenticated;

commit;

-- ===== 0014_contact_inbound_status.sql =====
-- 0014_contact_inbound_status.sql
-- Adds 'inbound' to the contacts status vocabulary.
--
-- WHY: every scraped lead sat at 'new' forever, which made the Status column carry no
-- information at all. The gap wasn't cosmetic — the vocabulary had no way to say the
-- one thing that most changes how you treat a brand: THEY contacted US.
--
--   new      scraped, never touched          (cold, we found them)
--   inbound  they reached out first          (warm — from a Work-with-me inquiry)
--   queued   scheduled to send
--   sent     pitched, awaiting a reply
--   replied  they answered our pitch
--   bounced  delivery failed
--   skip     deliberately passed over
--
-- 'inbound' and 'replied' are deliberately distinct: both mean a human wrote to you,
-- but one is a lead that arrived warm and the other is a cold pitch that worked. They
-- deserve different follow-ups, and collapsing them would lose the only signal that
-- tells you whether outreach is actually converting.
--
-- Idempotent — drop-then-add, so db:apply can re-run it.

begin;

alter table public.contacts drop constraint if exists contacts_status_check;

alter table public.contacts add constraint contacts_status_check
  check (status = any (array[
    'new'::text, 'inbound'::text, 'queued'::text, 'sent'::text,
    'replied'::text, 'bounced'::text, 'skip'::text
  ]));

commit;

-- ===== 0015_sender_blocklist.sql =====
-- 0015_sender_blocklist.sql
-- Makes "Mark as spam" mean what people assume it means.
--
-- Before this, `spam` was only a folder label on ONE row: the same address could fill
-- the inbox again the next day and nothing stopped it. The button therefore had to be
-- tooltipped "Move this message to Spam", because promising sender-level filtering
-- would have left real spam unfiltered while the operator believed it was handled.
--
-- Three parts:
--   blocked_senders          — the list. Email is the primary key, so blocking twice
--                              is a no-op rather than a duplicate.
--   apply_sender_blocklist() — BEFORE INSERT trigger; new mail from a blocked address
--                              lands in Spam without ever appearing in the inbox.
--   set_inquiry_spam()       — the single call the UI makes. Blocking and sweeping the
--                              sender's existing messages must happen together or the
--                              inbox is left half-cleaned.
--
-- Idempotent — `npm run db:apply` re-runs every migration file.

begin;

create table if not exists public.blocked_senders (
  -- Stored lowercased by the RPC below; matching is exact, NOT domain-wide. Blocking
  -- "someone@gmail.com" must never blackhole every gmail.com sender.
  email       text primary key,
  created_at  timestamptz not null default now()
);

alter table public.blocked_senders enable row level security;

drop policy if exists "admin all" on public.blocked_senders;
create policy "admin all" on public.blocked_senders
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- The filter itself. SECURITY DEFINER because inbound inquiries are inserted by the
-- `collab` Edge Function / anon path, which cannot read blocked_senders under RLS.
--
-- BEFORE INSERT, not AFTER: rewriting `status` in flight means a blocked message is
-- never briefly visible in the inbox, and no UPDATE has to chase it.
-- ---------------------------------------------------------------------------
create or replace function public.apply_sender_blocklist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null
     and exists (select 1 from public.blocked_senders b where b.email = lower(trim(new.email)))
  then
    new.status := 'spam';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_apply_sender_blocklist on public.collab_inquiries;
create trigger trg_apply_sender_blocklist
  before insert on public.collab_inquiries
  for each row execute function public.apply_sender_blocklist();

-- ---------------------------------------------------------------------------
-- set_inquiry_spam(id, spam) — what the Spam / Not-spam buttons call.
--
-- Marking spam does THREE things atomically: block the sender, sweep every message
-- they've already sent into Spam, and (implicitly) route their future mail via the
-- trigger. Doing these as separate client calls would let a failure between them
-- leave the sender blocked but their existing mail still in the inbox.
--
-- Unmarking is the exact inverse, and only restores the messages it swept — a message
-- that was archived for other reasons stays archived.
-- ---------------------------------------------------------------------------
create or replace function public.set_inquiry_spam(p_id uuid, p_spam boolean)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Admin only.';
  end if;

  select lower(trim(email)) into v_email from public.collab_inquiries where id = p_id;
  if v_email is null or v_email = '' then
    -- No address to key on: fall back to moving just this row.
    update public.collab_inquiries
       set status = case when p_spam then 'spam' else 'read' end
     where id = p_id;
    return 1;
  end if;

  if p_spam then
    insert into public.blocked_senders (email) values (v_email)
      on conflict (email) do nothing;

    update public.collab_inquiries
       set status = 'spam'
     where lower(trim(email)) = v_email
       and status <> 'spam';
  else
    delete from public.blocked_senders where email = v_email;

    update public.collab_inquiries
       set status = 'read'
     where lower(trim(email)) = v_email
       and status = 'spam';
  end if;

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.set_inquiry_spam(uuid, boolean) from public, anon;
grant execute on function public.set_inquiry_spam(uuid, boolean) to authenticated;

commit;

-- ===== 0016_contact_alternates.sql =====
-- 0016_contact_alternates.sql
-- One contact row per company, with the runners-up kept on the row.
--
-- WHY THIS COLUMN EXISTS
--   The scraper used to write EVERY address a site published. meandem.com publishes one
--   mailbox per retail store, so it produced 21 rows; goodhousekeeping.com produced 8.
--   At the time of writing, 93 of 166 contacts — 56% of the table — were redundant rows
--   for a company already represented, and 96 sat at 'skip' because the post-send sweep
--   had archived them after the fact.
--
--   The scraper now ranks the addresses it finds and writes ONE. That alone would throw
--   the alternates away, and they are worth keeping for exactly one reason: when the
--   chosen address bounces, promoting a runner-up costs a single UPDATE, while
--   re-crawling the site costs a queue slot, a politeness delay per page, and — for the
--   59% of sites that answer our user agent with 403 — probably yields nothing at all.
--
-- SHAPE (validated by the CHECK below, which only asserts it is an array):
--   [{"email": "press@brand.com", "type": "press", "score": 46}, …]
--   Capped at 8 entries by MAX_ALTERNATES in lib/outreach/pickEmail.ts.
--
-- `confidence` is NOT added here — it has existed since 0001 as the Hunter.io
-- enrichment score and has been unused since Hunter was dropped. The ranker reuses it
-- rather than adding a second, near-identical column.
--
-- Idempotent — `npm run db:apply` re-runs every migration file.

begin;

alter table public.contacts
  add column if not exists alternates jsonb not null default '[]'::jsonb;

-- Guard the shape at the boundary rather than trusting every future writer. A scalar or
-- an object here would break the UI's `.map()` at render time, which is a long way from
-- the write that caused it.
alter table public.contacts drop constraint if exists contacts_alternates_is_array;
alter table public.contacts add constraint contacts_alternates_is_array
  check (jsonb_typeof(alternates) = 'array');

comment on column public.contacts.alternates is
  'Runner-up addresses for this company, best first: [{email,type,score}]. Promote one if the chosen address bounces. Written by lib/outreach/pickEmail.ts.';

comment on column public.contacts.confidence is
  'Address-quality score 0-100 from lib/outreach/pickEmail.ts — role intent plus publication signals. Higher means more likely to be read by a human who handles collaborations.';

-- The working list is ordered by how good the address is, so the sort must not be a
-- sequential scan once the table grows past a few hundred rows.
create index if not exists contacts_confidence_idx
  on public.contacts (confidence desc nulls last);

commit;

-- ===== 0017_daily_sender.sql =====
-- 0017_daily_sender.sql
-- The DAILY SEND WINDOW + safety rails for scheduled outreach (BACKEND_DESIGN §6e).
--
-- WHY THIS EXISTS
--   Until now the send drain ran every minute of every day and claimed 5 rows per
--   tick. In practice that meant 14 pitches leaving in a 2-minute burst at 1 AM —
--   the exact robotic signature Gmail's abuse heuristics look for, from a free
--   @gmail.com account with no domain reputation of its own. The account at stake
--   also RECEIVES every collab inquiry from the media kit, so a suspension would cut
--   off inbound leads, not just outbound pitches.
--
--   The rails, all enforced server-side in drain-queue/sendPitch (the browser only
--   edits the knobs): a morning send window in PH time, one send per cron tick with
--   random skips (so gaps look human), a warm-up ramp on the daily cap, an MX check
--   before an address is auto-queued, and a kill switch that pauses everything when
--   bounces or auth failures suggest the account is in trouble.
--
-- Idempotent — `npm run db:apply` re-runs every migration file.

begin;

-- ---------------------------------------------------------------------------
-- app_settings: the safety knobs. Single row id=1, admin-editable via RLS
-- ("admin all" policy from 0007) — the studio Settings tab reads/writes these.
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists sending_paused boolean not null default false,
  add column if not exists paused_reason text not null default '',
  add column if not exists auto_queue boolean not null default true,
  add column if not exists auto_queue_min_confidence int not null default 55,
  add column if not exists send_weekdays_only boolean not null default true,
  add column if not exists send_window_start int not null default 8,
  add column if not exists send_window_end int not null default 11;

comment on column public.app_settings.sending_paused is
  'Kill switch. Set by the admin, or automatically by drain-queue on a bounce spike / repeated failures. While true, NOTHING sends — including manual queue rows.';
comment on column public.app_settings.paused_reason is
  'Why sending_paused was set — shown in the studio so unpausing is an informed act.';
comment on column public.app_settings.auto_queue is
  'When true, drain-queue tops the queue up each morning from validated high-confidence NEW contacts, up to the day''s remaining budget.';
comment on column public.app_settings.auto_queue_min_confidence is
  'Floor on contacts.confidence (0-100, lib/outreach/pickEmail.ts) for auto-queueing. 55 admits collab/marketing desks; front-door addresses need liveness bonuses to clear it.';
comment on column public.app_settings.send_window_start is
  'Send window start hour in Asia/Manila (inclusive). Sends happen only inside [start, end).';
comment on column public.app_settings.send_window_end is
  'Send window end hour in Asia/Manila (exclusive).';

-- Constrain the window to sane values so a typo cannot silence sending forever
-- (start >= end would never match any hour).
alter table public.app_settings drop constraint if exists app_settings_send_window_sane;
alter table public.app_settings add constraint app_settings_send_window_sane
  check (send_window_start >= 0 and send_window_end <= 24 and send_window_start < send_window_end);

-- ---------------------------------------------------------------------------
-- gmail_account: bounce-sweep bookkeeping (the sweep itself is scope-gated —
-- it only runs once the account is reconnected with gmail.readonly).
-- ---------------------------------------------------------------------------
alter table public.gmail_account
  add column if not exists last_bounce_check_at timestamptz;

-- ---------------------------------------------------------------------------
-- domain_checks: MX lookup cache for the pre-send dead-address gate.
--
-- One row per recipient DOMAIN, not per address — every mailbox at a domain
-- shares its MX records. Written only by Edge Functions (service role); the
-- admin may read it for debugging. has_mx NULL means "lookup failed, unknown"
-- — unknown does NOT block a send, only a definite no-MX does.
-- ---------------------------------------------------------------------------
create table if not exists public.domain_checks (
  domain      text primary key,
  has_mx      boolean,
  checked_at  timestamptz not null default now()
);

alter table public.domain_checks enable row level security;
drop policy if exists "admin read" on public.domain_checks;
create policy "admin read" on public.domain_checks
  for select to authenticated using (public.is_admin());
revoke all on table public.domain_checks from anon;
revoke insert, update, delete on table public.domain_checks from authenticated;

-- ---------------------------------------------------------------------------
-- sending_safety_status(): bounce-detection visibility for the Settings card.
--
-- A SEPARATE function rather than new columns on sending_account_status():
-- `create or replace` cannot change a function's return signature, so widening
-- the existing RPC would break 0012's idempotent re-run under db:apply.
-- Same pattern as 0012: SECURITY DEFINER past the deny-all RLS, explicit
-- column list (never the token), is_admin() in the WHERE — fail closed.
-- ---------------------------------------------------------------------------
create or replace function public.sending_safety_status()
returns table (
  can_detect_bounces    boolean,
  last_bounce_check_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (g.scope like '%gmail.readonly%') as can_detect_bounces,
    g.last_bounce_check_at
  from public.gmail_account g
  where g.id = 1 and public.is_admin();
$$;

revoke all on function public.sending_safety_status() from public, anon;
grant execute on function public.sending_safety_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Narrow the send drain's cron schedule to 00:00–09:59 UTC (08:00–17:59 PH).
--
-- The FUNCTION enforces the real window from app_settings (default 8–11 AM PH)
-- on every tick — this schedule is the outer envelope, wide enough that the
-- admin can move the window anywhere in the PH working day without another
-- migration, while the 14 hours where nothing should ever send get zero
-- invocations at the source.
--
-- cron.alter_job keeps the job's COMMAND untouched — the command embeds
-- CRON_SECRET and this repo is public, so it must never appear here.
-- The scraper drain (drain-scrape-jobs) intentionally stays at every-minute:
-- lead discovery has no reason to sleep.
-- ---------------------------------------------------------------------------
do $$
declare
  jid bigint;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    select jobid into jid from cron.job where jobname = 'drain-send-queue';
    if jid is not null then
      perform cron.alter_job(jid, schedule => '* 0-9 * * *');
    end if;
  end if;
end $$;

commit;


-- ===== 0018_lead_topup.sql =====
-- 0018_lead_topup.sql
-- KEEPING THE FUNNEL FULL: atomic scrape claiming, bounded retries, and the knobs
-- behind the pre-window lead top-up (`top-up-leads`).
--
-- WHY THIS EXISTS
--   On 2026-08-17 the morning window sent 9 pitches against a cap of 15, and the next
--   morning would have sent ZERO. Not a sender bug — a supply one. `discover-brands`
--   is admin-gated and fires only when someone clicks "Scrape new brands", so the only
--   automated job touching the funnel (`drain-scrape-jobs`) was draining a queue that
--   had been empty since the last manual run. The sender can only ever mail what
--   discovery last happened to leave behind.
--
--   Measured funnel on the 14-15 Aug cohort (the only one scored by the current
--   ranker): 15 brands discovered → 13 scraped clean → 6 cleared confidence 55.
--   Call it 3 discovered per qualified send. Filling a cap of 20 needs ~60 a day,
--   and nothing was asking for them.
--
--   Three things land here:
--     1. claim_scrape_jobs() — the scraper's claim was select-then-update, i.e. NOT
--        atomic, while its own comment claimed otherwise. Runs take ~90s on a 60s
--        cron, so overlap is by design and two workers could crawl one brand at once.
--     2. attempts / next_attempt_at / fail_class — retries had nowhere to record
--        themselves, so every failure was terminal. 107 of 195 jobs sat dead.
--     3. app_settings knobs for the top-up loop, including a DAILY DISCOVERY BUDGET.
--        Unattended discovery against a metered API with no daily ceiling is how a
--        credit balance disappears over a weekend.
--
-- Idempotent — `npm run db:apply` re-runs every migration file.

begin;

-- ---------------------------------------------------------------------------
-- scrape_jobs: retry bookkeeping.
--
-- `fail_class` exists because `needs_browser` was a catch-all that lied. Of the 107
-- rows wearing it, 34 were CDN 403/429 walls — a headless browser cannot fix a site
-- refusing our user agent, so pointing one at them is wasted work forever. Splitting
-- the reason from the remedy is what makes a retry policy expressible at all.
-- ---------------------------------------------------------------------------
alter table public.scrape_jobs
  add column if not exists attempts        int not null default 0,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists fail_class      text;

comment on column public.scrape_jobs.attempts is
  'Claim count. Incremented by claim_scrape_jobs(); the ceiling lives in scrape-static.';
comment on column public.scrape_jobs.next_attempt_at is
  'Earliest re-claim time for status=''retry''. NULL for every other status.';
comment on column public.scrape_jobs.fail_class is
  'Why it produced nothing: blocked (403/429 wall — never retry statically), unreachable (transient — retry), no_address (pages read fine, site publishes none — a real browser candidate), or unknown.';

-- 'retry' is a new status, and 0001 pinned the vocabulary with an inline CHECK that
-- `create table if not exists` will never revisit. Widen it here or every backoff
-- write fails at 23514.
alter table public.scrape_jobs drop constraint if exists scrape_jobs_status_check;
alter table public.scrape_jobs add constraint scrape_jobs_status_check
  check (status in ('pending','scraping','retry','done','needs_browser','error'));

-- The drain's hot path: "what can I claim right now?"
create index if not exists scrape_jobs_claimable_idx
  on public.scrape_jobs (created_at)
  where status in ('pending', 'retry');

-- ---------------------------------------------------------------------------
-- claim_scrape_jobs(): hand a worker rows nobody else can see.
--
-- Same shape as claim_due_sends() (0013) and for the same reason: FOR UPDATE SKIP
-- LOCKED inside the UPDATE means a second invocation cannot select rows the first
-- one took. The previous two-statement version left a window between SELECT and
-- UPDATE wide enough for the every-minute cron to double-crawl a domain — wasted
-- wall clock, and a politeness violation against sites we are trying to charm.
--
-- Retry-due rows are claimed by the SAME call, oldest first, so a retry never starves
-- behind a growing backlog of fresh work.
-- ---------------------------------------------------------------------------
create or replace function public.claim_scrape_jobs(p_limit int default 5)
returns setof public.scrape_jobs
language sql
volatile
security definer
set search_path = public
as $$
  update public.scrape_jobs j
     set status          = 'scraping',
         attempts        = j.attempts + 1,
         next_attempt_at = null
   where j.id in (
     select id
       from public.scrape_jobs
      where status = 'pending'
         or (status = 'retry' and coalesce(next_attempt_at, now()) <= now())
      order by created_at
      for update skip locked
      limit greatest(1, least(p_limit, 25))
   )
  returning j.*;
$$;

revoke all on function public.claim_scrape_jobs(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- requeue_stuck_scrapes(): rescue jobs orphaned by a worker that died mid-crawl.
--
-- scrape-static had no equivalent of requeue_stuck_sends(), so a function timeout or
-- a deploy landing mid-run stranded rows on 'scraping' permanently. A crawl takes
-- ~90s, so 15 minutes is far past any healthy run.
-- ---------------------------------------------------------------------------
create or replace function public.requeue_stuck_scrapes()
returns int
language sql
volatile
security definer
set search_path = public
as $$
  with bumped as (
    update public.scrape_jobs
       set status     = case when attempts >= 3 then 'error' else 'retry' end,
           error      = case when attempts >= 3
                             then 'Gave up after 3 attempts (worker kept dying mid-crawl).'
                             else error end,
           fail_class = case when attempts >= 3 then 'unreachable' else fail_class end,
           next_attempt_at = now()
     where status = 'scraping'
       and coalesce(scraped_at, created_at) < now() - interval '15 minutes'
    returning 1
  )
  select coalesce(count(*), 0)::int from bumped;
$$;

revoke all on function public.requeue_stuck_scrapes() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: classify the existing dead pile, then re-open the part worth re-opening.
--
-- 34 blocked / 10 unreachable / 63 with no reason recorded (they predate the
-- diagnoseEmpty() rollout). The unknowns are re-queued ONCE so the current
-- diagnostics can say what they actually are; the CDN walls are left alone, because
-- re-knocking on a closed door is the definition of wasted budget.
-- ---------------------------------------------------------------------------
update public.scrape_jobs
   set fail_class = case
         when error ilike '%Blocked by the site%'            then 'blocked'
         when error ilike '%No contact page could be read%'  then 'unreachable'
         when error ilike '%none usable%'                    then 'no_address'
         when error is null or error = ''                    then 'unknown'
         else 'unknown'
       end
 where status = 'needs_browser'
   and fail_class is null;

update public.scrape_jobs
   set status = 'retry', next_attempt_at = now(), attempts = 0
 where status = 'needs_browser'
   and fail_class in ('unreachable', 'unknown');

-- ---------------------------------------------------------------------------
-- app_settings: the top-up knobs. Enforced in top-up-leads; this is just storage.
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists topup_enabled              boolean not null default true,
  add column if not exists lead_target_buffer         numeric not null default 1.3,
  add column if not exists discovery_daily_budget     int     not null default 80,
  add column if not exists discovery_prefer_free_after int    not null default 40;

comment on column public.app_settings.topup_enabled is
  'Master switch for the pre-window lead top-up. Off = the sender mails only what is already in the pool.';
comment on column public.app_settings.lead_target_buffer is
  'Qualified leads to stock per unit of daily cap. 1.3 absorbs the MX and duplicate-company rejections that happen after a lead is counted.';
comment on column public.app_settings.discovery_daily_budget is
  'Hard ceiling on brands queued for scraping per PH day. The cost control: ScrapeCreators bills ~1 credit per 5 brands discovered.';
comment on column public.app_settings.discovery_prefer_free_after is
  'Once this many brands have been queued today, ask discovery to skip the metered Instagram source and use Brave/Wikidata only.';

alter table public.app_settings drop constraint if exists app_settings_topup_sane;
alter table public.app_settings add constraint app_settings_topup_sane
  check (
    lead_target_buffer between 1.0 and 3.0
    and discovery_daily_budget between 0 and 500
    and discovery_prefer_free_after between 0 and 500
  );

-- ---------------------------------------------------------------------------
-- Schedule the top-up: every 10 minutes, 20:00-23:59 UTC = 04:00-07:59 PH.
--
-- BEFORE the 08:00 send window, never during it. 24 ticks is far more than the loop
-- needs (it exits the moment the pool is stocked), and the spread means a slow
-- Instagram search costs one tick rather than the morning.
--
-- The command has to embed CRON_SECRET, and this repo is PUBLIC — so the secret is
-- LIFTED FROM THE EXISTING JOB rather than written here. It already lives in
-- cron.job.command for drain-send-queue; reading it out server-side means it never
-- travels through this file, a script, or anyone's clipboard. Re-running is safe:
-- the schedule is updated in place if the job already exists.
-- ---------------------------------------------------------------------------
do $$
declare
  secret text;
  base   text;
  jid    bigint;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    return;
  end if;

  select (regexp_match(command, $re$'x-cron-secret'\s*,\s*'([^']+)'$re$))[1],
         (regexp_match(command, $re$url\s*:=\s*'(https://[^/]+)/functions$re$))[1]
    into secret, base
    from cron.job
   where jobname = 'drain-send-queue';

  -- No sender job to borrow from means this project has not been wired up yet;
  -- the columns above still apply, the schedule just waits.
  if secret is null or base is null then
    raise notice 'topup-leads not scheduled: could not read the cron secret from drain-send-queue.';
    return;
  end if;

  select jobid into jid from cron.job where jobname = 'topup-leads';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;

  perform cron.schedule(
    'topup-leads',
    '*/10 20-23 * * *',
    format(
      $cmd$
      select net.http_post(
        url     := %L,
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',%L),
        body    := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
      $cmd$,
      base || '/functions/v1/top-up-leads',
      secret
    )
  );
end $$;

commit;

-- ===== 0019_auto_resume.sql =====
-- 0019_auto_resume.sql — machine-readable pause provenance + the auto-resume knob.
--
-- `sending_paused` (0017) is one boolean written by two very different actors: the
-- admin flipping the Settings switch (a deliberate decision) and drain-queue's
-- bounce breaker (a tripped safety). Auto-resume may only ever undo the breaker,
-- so WHO paused has to live in the schema — parsing it back out of the free-text
-- paused_reason would make a wording tweak silently un-pause a human's pause.
--
-- Apply via `npm run db:apply` (Management API). Idempotent — db:apply re-runs
-- every migration, so the backfill below only fills provenance where it's missing.

begin;

alter table public.app_settings
  add column if not exists paused_source text not null default ''
    check (paused_source in ('', 'manual', 'auto')),
  add column if not exists paused_at timestamptz,
  add column if not exists auto_resume boolean not null default true;

comment on column public.app_settings.paused_source is
  'Who set sending_paused: ''manual'' (the admin in Settings), ''auto'' (drain-queue''s bounce breaker), '''' when not paused. Auto-resume only ever clears ''auto''.';
comment on column public.app_settings.paused_at is
  'When sending_paused last flipped true. Null while sending. Survives a breaker re-trip so "paused since" stays honest.';
comment on column public.app_settings.auto_resume is
  'When true, drain-queue lifts an AUTOMATIC pause once the same bounce predicate that tripped it evaluates clean again (the bounced sends have aged out of the 7-day window). Manual pauses always wait for the admin.';

-- 0017's comment promised the switch also trips on auth failures; it never did —
-- invalid_grant only sets gmail_account.needs_reauth. Restate it truthfully.
comment on column public.app_settings.sending_paused is
  'Kill switch. Set by the admin, or automatically by drain-queue on a bounce spike. While true, NOTHING sends — including manual queue rows.';

-- Backfill a pause that predates provenance. Guarded on paused_source = '' so a
-- re-run (db:apply replays everything) never rewrites what a later writer stamped.
update public.app_settings
   set paused_source = case when paused_reason like 'Auto-paused%' then 'auto' else 'manual' end,
       paused_at     = coalesce(paused_at, updated_at)
 where id = 1
   and sending_paused
   and paused_source = '';

commit;
