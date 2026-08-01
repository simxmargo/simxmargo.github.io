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
