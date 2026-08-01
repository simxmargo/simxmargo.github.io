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
