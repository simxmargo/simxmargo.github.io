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
