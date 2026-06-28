-- Per-profile toggle to HIDE the public "Rates" section without deleting the rate
-- card. Defaults true so existing profiles keep showing rates (no behaviour change
-- until the admin turns it off). Parallels public_profile.is_published. Idempotent.
alter table public_profile
  add column if not exists show_rates boolean not null default true;
