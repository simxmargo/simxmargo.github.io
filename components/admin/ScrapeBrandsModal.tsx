'use client'

import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, X, Search, Loader2, CheckCircle2, XCircle, Globe, Ban, Check } from 'lucide-react'
import { useDialog } from '@/lib/admin/useDialog'
import { parseBrandLines, scrapeBrands, type ScrapeSummary } from '@/lib/admin/scrapeBrands'
import { BRAND_CATEGORIES, BRAND_DIRECTORY, normalizeDomain } from '@/lib/brandDirectory'

// "Scrape new brands": paste brand sites → we queue scrape_jobs and run the
// scrape-static → enrich → qualify Edge Functions, then refresh the contacts list.
// The functions hold the secrets + do the I/O; this modal only collects input and
// shows the per-brand outcome (docs/BACKEND_DESIGN.md §9).

const MAX_PER_RUN = 12 // each site is scraped server-side (~10s); keep one run bounded.

// A small status pill per scraped brand. `done`+found → success; `error` → that one
// domain failed. `needs_browser` splits in two: a site that refused our user agent
// (403/429) is NOT the same as one that simply publishes no address — the first is
// hopeless for the browser worker too, so it must not read as "no static emails".
function statusPill(status: string, found: number, error?: string) {
  if (status === 'error') return { icon: XCircle, cls: 'pill-danger', label: 'failed' }
  if (status === 'needs_browser') {
    return /blocked/i.test(error ?? '')
      ? { icon: Ban, cls: 'pill-danger', label: 'blocked by site' }
      : { icon: AlertTriangle, cls: 'pill-muted', label: 'no static emails' }
  }
  return { icon: CheckCircle2, cls: 'pill-ok', label: found ? `${found} found` : 'none found' }
}

export function ScrapeBrandsModal({
  onClose,
  onScraped,
  existingDomains,
}: {
  onClose: () => void
  onScraped: () => void
  /** Normalised domains already in contacts — so the picker can't re-add them. */
  existingDomains?: Set<string>
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useDialog(panelRef, onClose)

  // Browse is the DEFAULT. An empty textarea made "who do I pitch?" — the genuinely
  // hard part — look like the user's problem to solve from memory.
  const [mode, setMode] = useState<'browse' | 'paste'>('browse')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [category, setCategory] = useState<string>('all')
  const [dirSearch, setDirSearch] = useState('')

  const [text, setText] = useState('')
  const [country, setCountry] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invalidLines, setInvalidLines] = useState<string[]>([])
  const [summary, setSummary] = useState<ScrapeSummary | null>(null)

  const alreadyAdded = existingDomains ?? new Set<string>()

  const visibleBrands = useMemo(() => {
    const q = dirSearch.trim().toLowerCase()
    return BRAND_DIRECTORY.filter((b) => category === 'all' || b.category === category).filter(
      (b) => !q || b.name.toLowerCase().includes(q) || b.domain.includes(q),
    )
  }, [category, dirSearch])

  function toggle(domain: string): void {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      return next
    })
  }

  // "Select all" respects the cap and skips brands already in contacts, so it can
  // never quietly produce a selection the run would truncate.
  function selectVisible(): void {
    const room = MAX_PER_RUN - picked.size
    const addable = visibleBrands
      .filter((b) => !alreadyAdded.has(normalizeDomain(b.domain)) && !picked.has(b.domain))
      .slice(0, Math.max(0, room))
    setPicked((prev) => new Set([...prev, ...addable.map((b) => b.domain)]))
  }

  async function run() {
    setError(null)
    setSummary(null)
    setInvalidLines([])

    let inputs: ReturnType<typeof parseBrandLines>['inputs']
    let invalid: string[] = []

    if (mode === 'browse') {
      // Parsed one at a time so each brand keeps ITS OWN country — parseBrandLines
      // applies a single country to a whole block, which would stamp every pick with
      // the same one.
      inputs = BRAND_DIRECTORY.filter((b) => picked.has(b.domain)).flatMap(
        (b) => parseBrandLines(`${b.name}, ${b.domain}`, b.country).inputs,
      )
      if (inputs.length === 0) {
        setError('Pick at least one brand from the list.')
        return
      }
    } else {
      const parsed = parseBrandLines(text, country)
      inputs = parsed.inputs
      invalid = parsed.invalid
      if (inputs.length === 0) {
        setError('Add at least one brand website (one per line).')
        setInvalidLines(invalid)
        return
      }
    }
    const capped = inputs.slice(0, MAX_PER_RUN)
    setInvalidLines(invalid)

    setLoading(true)
    try {
      const result = await scrapeBrands(capped)
      if (inputs.length > MAX_PER_RUN) {
        result.warnings.unshift(`Only the first ${MAX_PER_RUN} sites were scraped this run.`)
      }
      setSummary(result)
      onScraped() // re-hydrate the store so the Contacts table shows new leads live
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not scrape.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scrape-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="ico-badge"><Globe size={18} aria-hidden="true" /></span>
          <h2 id="scrape-title" className="modal-title">Scrape new brands</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && (
            <div className="banner banner-error">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="seg" role="tablist" aria-label="How to add brands">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'browse'}
              className={`seg-btn${mode === 'browse' ? ' active' : ''}`}
              onClick={() => setMode('browse')}
              disabled={loading}
            >
              Browse brands
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'paste'}
              className={`seg-btn${mode === 'paste' ? ' active' : ''}`}
              onClick={() => setMode('paste')}
              disabled={loading}
            >
              Paste websites
            </button>
          </div>

          {mode === 'browse' ? (
            <>
              <div className="dir-filters">
                <input
                  className="input"
                  placeholder="Search brands…"
                  aria-label="Search the brand list"
                  value={dirSearch}
                  onChange={(e) => setDirSearch(e.target.value)}
                  disabled={loading}
                  style={{ flex: '1 1 180px', minWidth: 0 }}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={selectVisible}
                  disabled={loading || picked.size >= MAX_PER_RUN}
                >
                  Select all shown
                </button>
              </div>

              <div className="dir-cats" role="group" aria-label="Filter by category">
                <button
                  type="button"
                  className={`tpl-chip${category === 'all' ? ' active' : ''}`}
                  onClick={() => setCategory('all')}
                  disabled={loading}
                >
                  All
                </button>
                {BRAND_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`tpl-chip${category === c ? ' active' : ''}`}
                    onClick={() => setCategory(c)}
                    disabled={loading}
                  >
                    {c}
                  </button>
                ))}
              </div>

              <div className="dir-list">
                {visibleBrands.map((b) => {
                  const added = alreadyAdded.has(normalizeDomain(b.domain))
                  const on = picked.has(b.domain)
                  const full = !on && picked.size >= MAX_PER_RUN
                  return (
                    <label
                      key={b.domain}
                      className={`dir-item${added ? ' is-added' : ''}`}
                      title={added ? 'Already in your contacts' : b.domain}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={loading || added || full}
                        onChange={() => toggle(b.domain)}
                      />
                      <span className="dir-name">{b.name}</span>
                      <span className="dir-domain">{b.domain}</span>
                      {added ? (
                        <span className="pill pill-ok dir-tag">
                          <Check size={11} aria-hidden="true" /> Added
                        </span>
                      ) : (
                        <span className="dir-country">{b.country}</span>
                      )}
                    </label>
                  )
                })}
                {visibleBrands.length === 0 && <div className="empty">No brands match that search.</div>}
              </div>

              <p className="field-hint">
                {picked.size} of {MAX_PER_RUN} selected · overseas fashion, beauty and apparel brands.
                We read each site&rsquo;s public contact pages (respecting robots.txt), then enrich +
                AI-score the leads. Roughly 4 in 10 sites publish a usable address — the rest report
                back as blocked or empty. ~10s per site.
              </p>
            </>
          ) : (
            <>
              <div className="field">
                <label className="flabel" htmlFor="scrape-list">Brand websites</label>
                <textarea
                  id="scrape-list"
                  className="input"
                  rows={6}
                  placeholder={'nike.com\nGlossier, glossier.com\naloyoga.com'}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={loading}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>

              <div className="field" style={{ maxWidth: 220 }}>
                <label className="flabel" htmlFor="scrape-country">Country (optional)</label>
                <input
                  id="scrape-country"
                  className="input"
                  placeholder="US"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  disabled={loading}
                />
              </div>

              <p className="field-hint">
                One brand per line — either a website (we&rsquo;ll name it from the domain) or{' '}
                <code>Brand Name, website.com</code>. Up to {MAX_PER_RUN} per run; ~10s per site.
              </p>
            </>
          )}

          {invalidLines.length > 0 && (
            <div className="banner banner-warn">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>Skipped {invalidLines.length} line{invalidLines.length === 1 ? '' : 's'} without a usable website: {invalidLines.slice(0, 3).join(' · ')}{invalidLines.length > 3 ? '…' : ''}</span>
            </div>
          )}

          {!summary && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => void run()}
              disabled={loading || (mode === 'browse' ? picked.size === 0 : text.trim() === '')}
            >
              {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
              {loading
                ? 'Scraping…'
                : mode === 'browse' && picked.size > 0
                  ? `Scrape ${picked.size} brand${picked.size === 1 ? '' : 's'}`
                  : 'Scrape'}
            </button>
          )}

          {summary && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="pv-summary">
                {summary.totalFound} new contact{summary.totalFound === 1 ? '' : 's'} across {summary.results.length} site{summary.results.length === 1 ? '' : 's'}
                {typeof summary.scoredCount === 'number' && summary.scoredCount > 0 ? ` · ${summary.scoredCount} scored` : ''}
                {typeof summary.enrichedAdded === 'number' && summary.enrichedAdded > 0 ? ` · ${summary.enrichedAdded} enriched` : ''}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {summary.results.map((r) => {
                  const p = statusPill(r.status, r.found, r.error)
                  const Icon = p.icon
                  return (
                    <div
                      key={r.website}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}
                    >
                      <span className={`pill ${p.cls}`} style={{ whiteSpace: 'nowrap' }}>
                        <Icon size={13} aria-hidden="true" /> {p.label}
                      </span>
                      <span style={{ fontWeight: 600 }}>{r.brand}</span>
                      <span style={{ opacity: 0.6, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.website}</span>
                      {r.error && <span style={{ opacity: 0.7, fontStyle: 'italic' }} title={r.error}>— {r.error}</span>}
                    </div>
                  )
                })}
              </div>

              {/* enrich/qualify ran but produced nothing actionable (usually a missing key) */}
              {(summary.enrichNote || summary.scoreNote) && (
                <p className="field-hint">
                  {summary.enrichNote && <>Enrichment: {summary.enrichNote}. </>}
                  {summary.scoreNote && <>Scoring: {summary.scoreNote}.</>}
                </p>
              )}

              {summary.warnings.map((w, i) => (
                <div key={i} className="banner banner-warn">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-foot">
          {summary ? (
            <>
              <button type="button" className="btn btn-primary" onClick={() => { setSummary(null); setText('') }}>
                Scrape more
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Done</button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          )}
        </div>
      </div>
    </div>
  )
}
