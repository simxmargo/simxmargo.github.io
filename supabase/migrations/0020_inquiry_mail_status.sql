-- 0020_inquiry_mail_status.sql — can collab inquiries be filed into the Gmail Inbox?
--
-- The `collab` function files each public inquiry into the connected account with
-- users.messages.import, which needs gmail.insert (or gmail.modify / full mail). An
-- account connected before that scope existed keeps SENDING fine but can't file, and
-- the Settings card has to be able to say "reconnect to get inquiries in Gmail".
--
-- Its own function, like 0017's sending_safety_status(): `create or replace` cannot
-- change a return signature, so widening an existing RPC would break db:apply's
-- replay. SECURITY DEFINER past gmail_account's deny-all RLS, explicit column list
-- (never the token), is_admin() in the WHERE — zero rows for anyone else.
-- Additive and idempotent: safe to re-run.

create or replace function public.inquiry_mail_status()
returns table (
  can_file_inquiries boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.refresh_token is not null
      and (
        g.scope like '%gmail.insert%'
        or g.scope like '%gmail.modify%'
        or g.scope like '%https://mail.google.com/%'
      ) as can_file_inquiries
  from public.gmail_account g
  where g.id = 1 and public.is_admin();
$$;

revoke all on function public.inquiry_mail_status() from public, anon;
grant execute on function public.inquiry_mail_status() to authenticated;
