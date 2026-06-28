-- Per-brand campaign fields for the public brand-detail modal.
--
-- These power the modal's START / END / TOTAL VIEWS stats. They are MANUAL and
-- NULLABLE on purpose: a blank field renders a quiet "~" empty state in the modal
-- (never a fabricated date or count). DELIVERABLES stays DERIVED from the existing
-- media[] jsonb (count of top-content pieces) on the client, so it needs no column.
--
-- Idempotent (add column if not exists) — safe to re-run. Apply with
-- `npm run db:apply`. Existing portfolio_brands rows are untouched (all columns null).
alter table public.portfolio_brands
  add column if not exists start_date  date,
  add column if not exists end_date    date,
  add column if not exists total_views bigint;
