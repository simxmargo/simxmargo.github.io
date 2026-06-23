-- Enrichment bookkeeping for the `enrich` Edge Function.
--
-- Hunter.io's free tier is ~25 domain searches/month, so re-running enrichment
-- must never re-spend a credit on a domain it already searched (the "cache
-- everything" rule in docs/BACKEND_DESIGN.md §4). `enrich` selects scrape_jobs
-- that are `done` with `enriched_at is null`, then stamps this column when it's
-- done with that domain. Idempotent — safe to re-run.

alter table scrape_jobs add column if not exists enriched_at timestamptz;
