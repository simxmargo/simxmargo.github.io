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
