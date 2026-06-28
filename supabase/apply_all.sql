-- GENERATED: paste this whole file into the Supabase SQL Editor (Dashboard → SQL Editor → New query → Run).
-- Concatenation of every supabase/migrations/*.sql, in order. Idempotent — safe to re-run.
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

