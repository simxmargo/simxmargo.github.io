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
