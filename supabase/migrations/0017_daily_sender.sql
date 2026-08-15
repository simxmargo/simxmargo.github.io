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
