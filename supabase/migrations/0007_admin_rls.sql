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
