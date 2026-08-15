'use client'

import { useState } from 'react'
import {
  Globe,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Ban,
  X,
  Clock,
} from 'lucide-react'
import { useScrapeRun, type ScrapeRunItem } from '@/lib/admin/scrapeRun'

// The run readout for "Scrape new brands".
//
// Collapsed by default and only present while a run exists: the point of the one-click
// flow is that you fire it and carry on, so the default state has to be a single line
// you can ignore. Expanding is for when a run finishes thin and you want to know which
// sites refused us — that answer used to live in a modal you had to sit and watch.

// `needs_browser` splits in two on purpose: a site that refused our user agent (403/429)
// is NOT the same as one that simply publishes no address. The first is hopeless for a
// headless browser too, so it must not read as "no static emails".
function pillFor(item: ScrapeRunItem) {
  switch (item.status) {
    case 'waiting':
      return { icon: Clock, cls: 'pill-muted', label: 'waiting' }
    case 'scraping':
      return { icon: Loader2, cls: 'pill', label: 'reading…', spin: true }
    case 'error':
      return { icon: XCircle, cls: 'pill-danger', label: 'failed' }
    case 'needs_browser':
      return /blocked/i.test(item.error ?? '')
        ? { icon: Ban, cls: 'pill-danger', label: 'blocked by site' }
        : { icon: AlertTriangle, cls: 'pill-muted', label: 'no public address' }
    default:
      return item.found > 0
        ? { icon: CheckCircle2, cls: 'pill-ok', label: `${item.found} found` }
        : { icon: AlertTriangle, cls: 'pill-muted', label: 'none found' }
  }
}

export function ScrapeRunPanel() {
  const { items, phase, notes, totalFound, failed, dismiss } = useScrapeRun()
  const [open, setOpen] = useState(false)

  // Rendered from the moment a run starts, BEFORE any items exist — discovery takes a
  // second or two and a button that looks dead for that long reads as broken.
  if (phase === 'idle') return null

  // A failed run opens itself. The reason lives in `notes`, and leaving it collapsed
  // behind a "Nothing to scrape" line is how a 504 went unnoticed for a day.
  const expanded = open || failed

  const finished = items.filter((i) => i.status !== 'waiting' && i.status !== 'scraping').length
  const current = items.find((i) => i.status === 'scraping')
  const running = phase === 'discovering' || phase === 'scraping' || phase === 'finishing'

  const headline =
    phase === 'discovering'
      ? 'Finding brands to scrape…'
      : phase === 'finishing'
        ? 'Enriching and scoring…'
        : running
          ? `Scraping ${Math.min(finished + 1, items.length)} of ${items.length}${current ? ` · ${current.brand}` : ''}`
          : failed
            ? "Couldn't find brands to scrape"
            : items.length === 0
              ? 'Nothing to scrape'
              : `Found ${totalFound} contact${totalFound === 1 ? '' : 's'} across ${items.length} site${items.length === 1 ? '' : 's'}`

  return (
    <section className="scrape-run" aria-live="polite">
      <div className="scrape-run-head">
        <button
          type="button"
          className="scrape-run-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={expanded}
          aria-controls="scrape-run-list"
        >
          {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          <span className="ico-badge scrape-run-ico">
            {running ? (
              <Loader2 size={15} className="animate-spin" aria-hidden="true" />
            ) : failed ? (
              <XCircle size={15} aria-hidden="true" />
            ) : (
              <Globe size={15} aria-hidden="true" />
            )}
          </span>
          <span className="scrape-run-title">{headline}</span>
        </button>

        {/* Dismiss only once it's over — killing the row mid-run would hide work that
            is still happening rather than stop it. */}
        {!running && (
          <button type="button" className="icon-btn" onClick={dismiss} aria-label="Dismiss scrape summary">
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      {expanded && (
        <div id="scrape-run-list" className="scrape-run-body">
          {running && phase !== 'discovering' && (
            <p className="field-hint hint-icon">
              <Globe size={12} aria-hidden="true" />
              <span>
                Scraping happens on the server — you can close this tab and the contacts will
                still appear.
              </span>
            </p>
          )}
          {items.map((it) => {
            const p = pillFor(it)
            const Icon = p.icon
            return (
              <div className="scrape-row" key={it.website}>
                <span className={`pill ${p.cls}`}>
                  <Icon
                    size={12}
                    className={'spin' in p && p.spin ? 'animate-spin' : undefined}
                    aria-hidden="true"
                  />{' '}
                  {p.label}
                </span>
                <span className="scrape-brand">{it.brand}</span>
                <span className="scrape-site">{it.website}</span>
                {it.error && (
                  <span className="scrape-err" title={it.error}>
                    {it.error}
                  </span>
                )}
              </div>
            )
          })}

          {notes.map((n, i) => (
            <p className="field-hint" key={i}>
              {n}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
