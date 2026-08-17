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
