'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, X, Search, Loader2, CheckCircle2, XCircle, Globe } from 'lucide-react'
import { useDialog } from '@/lib/admin/useDialog'
import { parseBrandLines, scrapeBrands, type ScrapeSummary } from '@/lib/admin/scrapeBrands'

// "Scrape new brands": paste brand sites → we queue scrape_jobs and run the
// scrape-static → enrich → qualify Edge Functions, then refresh the contacts list.
// The functions hold the secrets + do the I/O; this modal only collects input and
// shows the per-brand outcome (docs/BACKEND_DESIGN.md §9).

const MAX_PER_RUN = 12 // each site is scraped server-side (~10s); keep one run bounded.

// A small status pill per scraped brand. `done`+found → success; `needs_browser` →
// JS-rendered site we couldn't read statically; `error` → that one domain failed.
function statusPill(status: string, found: number) {
  if (status === 'error') return { icon: XCircle, cls: 'pill-danger', label: 'failed' }
  if (status === 'needs_browser') return { icon: AlertTriangle, cls: 'pill-muted', label: 'no static emails' }
  return { icon: CheckCircle2, cls: 'pill-ok', label: found ? `${found} found` : 'none found' }
}

export function ScrapeBrandsModal({ onClose, onScraped }: { onClose: () => void; onScraped: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  useDialog(panelRef, onClose)

  const [text, setText] = useState('')
  const [country, setCountry] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invalidLines, setInvalidLines] = useState<string[]>([])
  const [summary, setSummary] = useState<ScrapeSummary | null>(null)

  async function run() {
    setError(null)
    setSummary(null)
    setInvalidLines([])

    const { inputs, invalid } = parseBrandLines(text, country)
    if (inputs.length === 0) {
      setError('Add at least one brand website (one per line).')
      setInvalidLines(invalid)
      return
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
            <code>Brand Name, website.com</code>. We read each site&rsquo;s public contact pages
            (respecting robots.txt), then enrich + AI-score the leads. Up to {MAX_PER_RUN} per run;
            ~10s per site.
          </p>

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
              disabled={loading || text.trim() === ''}
            >
              {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
              {loading ? 'Scraping…' : 'Scrape'}
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
                  const p = statusPill(r.status, r.found)
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
