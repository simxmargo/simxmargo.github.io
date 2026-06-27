'use client'

import { useMemo, useRef, useState } from 'react'
import { Loader2, AlertTriangle, Check, X, Download } from 'lucide-react'
import { adminFetch } from '@/lib/adminClient'
import { useDialog } from '@/lib/admin/useDialog'
import { matchCaption, type MatchBrand } from '@/lib/social/brandMatch'
import { formatCount } from '@/lib/mediakit-types'

interface RawVideo {
  id: string
  url: string
  caption: string
  cover: string
  views: number | null
  likes: number | null
  platform: 'tiktok' | 'instagram'
}
interface Row {
  video: RawVideo
  checked: boolean
  brandId: string
}

// Bulk-supply tool: pull a creator's recent TikTok/IG posts by handle (via the
// ScrapeCreators managed API — see lib/social/scrapeCreators.ts), auto-match them to
// brands by caption, review, and add to each brand's Top content in one pass.
export function PullVideosModal({
  brands,
  defaultHandle,
  onClose,
  onAdded,
  on503,
}: {
  brands: MatchBrand[]
  defaultHandle?: string
  onClose: () => void
  onAdded: () => void
  on503: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useDialog(panelRef, onClose)

  const [platform, setPlatform] = useState<'tiktok' | 'instagram'>('tiktok')
  const [handle, setHandle] = useState(defaultHandle ?? '')
  const [fetching, setFetching] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)

  const matchedCount = useMemo(() => (rows ?? []).filter((r) => r.brandId).length, [rows])
  const selectedCount = useMemo(() => (rows ?? []).filter((r) => r.checked && r.brandId).length, [rows])

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => (rs ? rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) : rs))
  }

  async function fetchVideos() {
    if (!handle.trim()) {
      setError('A profile handle is required.')
      return
    }
    setFetching(true)
    setError('')
    setNote('')
    setRows(null)
    try {
      const res = await adminFetch('/api/admin/brands/pull-videos', {
        method: 'POST',
        body: JSON.stringify({ platform, handle }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j?.error || `Fetch failed (${res.status}).`)
        return
      }
      const vids: RawVideo[] = Array.isArray(j.videos) ? j.videos : []
      if (j?.note) setNote(j.note)
      // Auto-match each caption → brand; default-select the matched ones; sort matched first.
      const built: Row[] = vids.map((v) => {
        const ids = matchCaption(v.caption, brands)
        return { video: v, checked: ids.length > 0, brandId: ids[0] ?? '' }
      })
      built.sort((a, b) => Number(Boolean(b.brandId)) - Number(Boolean(a.brandId)))
      setRows(built)
    } catch {
      setError('Request failed — try again.')
    } finally {
      setFetching(false)
    }
  }

  async function addSelected() {
    const sel = (rows ?? []).filter((r) => r.checked && r.brandId)
    if (sel.length === 0) return
    setAdding(true)
    setError('')
    try {
      const res = await adminFetch('/api/admin/brands/add-videos', {
        method: 'POST',
        body: JSON.stringify({ assignments: sel.map((r) => ({ brandId: r.brandId, video: r.video })) }),
      })
      if (res.status === 503) {
        on503()
        return
      }
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j?.error || `Add failed (${res.status}).`)
        return
      }
      // Only signal "saved" (refetch + savedAt bump) when something actually persisted.
      if (typeof j?.added === 'number' && j.added > 0) onAdded()
      if (typeof j?.skipped === 'number' && j.skipped > 0) {
        setRows(null)
        setNote(`Added ${j.added ?? 0}. ${j.skipped} skipped — duplicates, the brand is full (24-item cap), or it no longer exists.`)
      } else {
        onClose()
      }
    } catch {
      setError('Request failed — try again.')
    } finally {
      setAdding(false)
    }
  }

  function switchPlatform(p: 'tiktok' | 'instagram') {
    setPlatform(p)
    setRows(null)
    setNote('')
    setError('')
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pull-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="ico-badge"><Download size={18} aria-hidden="true" /></span>
          <h2 id="pull-title" className="modal-title">Pull videos from a profile</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p className="field-hint">
            Enter the creator&rsquo;s handle and pull their recent posts (via ScrapeCreators). Each post is
            auto-matched to a brand by caption — review and add to that brand&rsquo;s Top content.
          </p>

          <div className="flex items-center gap-2">
            <button type="button" aria-pressed={platform === 'tiktok'} className={`btn btn-sm ${platform === 'tiktok' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => switchPlatform('tiktok')}>
              TikTok
            </button>
            <button type="button" aria-pressed={platform === 'instagram'} className={`btn btn-sm ${platform === 'instagram' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => switchPlatform('instagram')}>
              Instagram
            </button>
          </div>

          <div className="field">
            <label className="flabel" htmlFor="pull-handle">Handle</label>
            <input id="pull-handle" className="input" placeholder="@simxmargo" value={handle} onChange={(e) => setHandle(e.target.value)} />
          </div>
          <div>
            <button type="button" className="btn btn-primary" onClick={() => void fetchVideos()} disabled={fetching}>
              {fetching ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}{' '}
              {fetching ? 'Fetching…' : 'Fetch videos'}
            </button>
          </div>

          {error && (
            <div className="banner banner-error">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          {note && <p className="field-hint">{note}</p>}

          {rows && rows.length > 0 && (
            <>
              <div className="pv-summary">
                {matchedCount} matched · {rows.length - matchedCount} unmatched · {selectedCount} selected
              </div>
              <div className="pv-list">
                {rows.map((r, i) => (
                  <div key={r.video.id} className={`pv-row${r.checked && r.brandId ? ' is-on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={r.checked}
                      disabled={!r.brandId}
                      onChange={(e) => setRow(i, { checked: e.target.checked })}
                      aria-label={`Select ${r.video.caption || 'video'}`}
                    />
                    {r.video.cover ? (
                      // Proxied through our origin — TikTok/IG CDNs 403 cross-origin <img> hotlinks.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="pv-thumb" src={`/api/admin/brands/cover-proxy?u=${encodeURIComponent(r.video.cover)}`} alt="" loading="lazy" />
                    ) : (
                      <span className="pv-thumb pv-thumb-empty" aria-hidden="true" />
                    )}
                    <div className="pv-meta">
                      <div className="pv-cap" title={r.video.caption}>{r.video.caption || '(no caption)'}</div>
                      <div className="pv-stats">
                        {r.video.views != null ? `${formatCount(r.video.views)} views` : ''}
                        {r.video.views != null && r.video.likes != null ? ' · ' : ''}
                        {r.video.likes != null ? `${formatCount(r.video.likes)} likes` : ''}
                      </div>
                    </div>
                    <select
                      className="input pv-select"
                      value={r.brandId}
                      onChange={(e) => setRow(i, { brandId: e.target.value, checked: Boolean(e.target.value) })}
                      aria-label="Assign to brand"
                    >
                      <option value="">— skip —</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>{b.brand}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-primary" disabled={adding || selectedCount === 0} onClick={() => void addSelected()}>
            {adding ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />} Add{' '}
            {selectedCount > 0 ? `${selectedCount} ` : ''}to Top content
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
