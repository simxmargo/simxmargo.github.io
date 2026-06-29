-- Per-profile toggle to HIDE the whole public "Rates" section (its heading, the
-- rate list, and the "Rates" nav link) — independent of `show_rates` (0009), which
-- only swaps the PRICES for a "Let's talk" invite while the section still renders.
-- Two orthogonal controls: this one removes the section entirely; show_rates dims
-- pricing within it. Defaults true so existing profiles are unchanged until the
-- admin turns it off. Idempotent.
alter table public_profile
  add column if not exists show_rates_section boolean not null default true;
