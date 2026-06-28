'use client'

import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, X, Download, Search, Loader2, Check } from 'lucide-react'
import { useDialog } from '@/lib/admin/useDialog'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { updateBrand, type AdminBrand } from '@/lib/admin/resources/brands'
import { formatCount, type BrandMedia } from '@/lib/mediakit-types'

// Bulk-supply tool: pull a creator's recent TikTok/IG posts by handle (via the
// `pull-videos` Edge Function → ScrapeCreators), which re-hosts each cover to permanent
// Storage and auto-matches videos to brands by caption. The admin reviews the grouped
// list (matched per-brand + an "Unmatched" group), tweaks the per-video brand, then on
// Add we append the chosen videos to each brand's portfolio_brands.media via updateBrand
// (direct supabase, RLS = is_admin()). The function never writes — the browser persists.

// One video returned by the `pull-videos` function (mirrors its response contract).
interface PulledVideo {
  id: string
  url: string
  cover: string // re-hosted permanent URL (or the raw cover as a fallback)
  caption: string
  platform: 'tiktok' | 'instagram'
  views: number | null
  likes: number | null
  suggestedBrandId: string | null
  suggestedBrand: string | null
}

// A pulled video + the admin's review choices (which brand, include or not).
interface ReviewRow extends PulledVideo {
  brandId: string // '' = unmatched / unassigned
  include: boolean
}

const UNMATCHED = '' as const

// Read the function's JSON `{ error }` body off a failed invoke (the message lives on
// the FunctionsHttpError's Response in `.context`); fall back to the generic message.
async function fnErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown })?.context
  if (ctx instanceof Response) {
    try {
      const j = await ctx.clone().json()
      if (j && typeof j.error === 'string') return j.error
    } catch {
      /* not a JSON body */
    }
  }
  return error instanceof Error ? error.message : 'Could not pull videos.'
}

export function PullVideosModal({
  brands,
  defaultHandle,
  onClose,
  onAdded,
}: {
  brands: AdminBrand[]
  defaultHandle?: string
  onClose: () => void
  onAdded: () => void
  on503: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useDialog(panelRef, onClose)

  const [platform, setPlatform] = useState<'tiktok' | 'instagram'>('tiktok')
  const [handle, setHandle] = useState(defaultHandle ?? '')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [rows, setRows] = useState<ReviewRow[]>([])

  const brandName = useMemo(() => new Map(brands.map((b) => [b.id, b.brand])), [brands])

  // Selected = included AND assigned to a brand (unmatched-unassigned can't be saved).
  const selectedCount = rows.filter((r) => r.include && r.brandId).length

  // Group the review rows by assigned brand: each brand that has rows (in the brands'
  // own display order) becomes a group, then the Unmatched group last.
  const groups = useMemo(() => {
    const out: { id: string; title: string; rows: ReviewRow[] }[] = []
    for (const b of brands) {
      const r = rows.filter((row) => row.brandId === b.id)
      if (r.length) out.push({ id: b.id, title: b.brand, rows: r })
    }
    const unmatched = rows.filter((row) => !row.brandId)
    if (unmatched.length) out.push({ id: UNMATCHED, title: 'Unmatched — choose a brand', rows: unmatched })
    return out
  }, [rows, brands])

  async function pull() {
    const sb = supabaseBrowser
    if (!sb) {
      setError('Studio is not configured.')
      return
    }
    const h = handle.trim()
    if (!h) {
      setError('Enter a handle or profile URL.')
      return
    }
    setLoading(true)
    setError(null)
    setNote(null)
    setRows([])
    try {
      const { data, error: invokeErr } = await sb.functions.invoke('pull-videos', {
        body: { platform, handle: h },
      })
      if (invokeErr) {
        setError(await fnErrorMessage(invokeErr))
        return
      }
      const vids: PulledVideo[] = Array.isArray(data?.videos) ? data.videos : []
      if (vids.length === 0) {
        setNote(typeof data?.note === 'string' ? data.note : 'No posts found for that handle.')
        return
      }
      setRows(
        vids.map((v) => ({
          ...v,
          brandId: v.suggestedBrandId ?? UNMATCHED,
          include: true,
        })),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not pull videos.')
    } finally {
      setLoading(false)
    }
  }

  const setRowBrand = (id: string, brandId: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, brandId } : r)))
  const toggleRow = (id: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, include: !r.include } : r)))

  async function add() {
    // Bucket the selected videos by brand, then append each bucket to that brand's media.
    const byBrand = new Map<string, BrandMedia[]>()
    for (const r of rows) {
      if (!r.include || !r.brandId) continue
      const item: BrandMedia = { type: 'video', url: r.url, platform: r.platform }
      if (r.cover) item.thumbUrl = r.cover
      if (r.caption) item.caption = r.caption
      if (typeof r.views === 'number') item.views = r.views
      if (typeof r.likes === 'number') item.likes = r.likes
      const arr = byBrand.get(r.brandId) ?? []
      arr.push(item)
      byBrand.set(r.brandId, arr)
    }
    if (byBrand.size === 0) {
      setError('Pick a brand for at least one selected video.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      for (const [bid, newMedia] of byBrand) {
        const brand = brands.find((b) => b.id === bid)
        const existing = Array.isArray(brand?.media) ? brand.media : []
        // Append (existing first): updateBrand→sanitizeMedia caps the array at 12, so any
        // new items beyond 12 for an already-full brand are dropped (same as the editor).
        await updateBrand(bid, { media: [...existing, ...newMedia] })
      }
      onAdded()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save videos.')
    } finally {
      setSaving(false)
    }
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
          {error && (
            <div className="banner banner-error">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {/* Handle / platform input — always available so you can re-pull. */}
          <div className="pv-form">
            <div className="field" style={{ flex: '0 0 auto' }}>
              <label className="flabel" htmlFor="pv-platform">Platform</label>
              <select
                id="pv-platform"
                className="input"
                value={platform}
                onChange={(e) => setPlatform(e.target.value === 'instagram' ? 'instagram' : 'tiktok')}
                disabled={loading || saving}
              >
                <option value="tiktok">TikTok</option>
                <option value="instagram">Instagram</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label className="flabel" htmlFor="pv-handle">Handle or profile URL</label>
              <input
                id="pv-handle"
                className="input"
                placeholder={platform === 'tiktok' ? '@handle or tiktok.com/@handle' : '@handle or instagram.com/handle'}
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void pull()
                  }
                }}
                disabled={loading || saving}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}
              onClick={() => void pull()}
              disabled={loading || saving || !handle.trim()}
            >
              {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
              {loading ? 'Pulling…' : 'Pull'}
            </button>
          </div>
          <p className="field-hint">
            Fetches the creator&rsquo;s recent posts (up to 12), re-hosts each cover, and auto-matches them to your
            brands by caption. Review the matches below, then add the ones you want.
          </p>

          {note && (
            <div className="banner banner-warn">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{note}</span>
            </div>
          )}

          {rows.length > 0 && (
            <>
              <div className="pv-summary">
                {rows.length} {rows.length === 1 ? 'video' : 'videos'} · {selectedCount} selected
              </div>
              {groups.map((g) => (
                <div key={g.id || 'unmatched'} className="pv-group">
                  <div className="pv-group-head">
                    <span className="pv-group-title">{g.title}</span>
                    <span className="pv-group-count">{g.rows.length}</span>
                  </div>
                  <div className="pv-list">
                    {g.rows.map((r) => (
                      <div key={r.id} className={`pv-row${r.include ? ' is-on' : ''}`}>
                        <input
                          type="checkbox"
                          className="pv-check"
                          checked={r.include}
                          onChange={() => toggleRow(r.id)}
                          aria-label={`Include ${r.caption || r.url}`}
                        />
                        {r.cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="pv-thumb" src={r.cover} alt="" loading="lazy" />
                        ) : (
                          <span className="pv-thumb pv-thumb-empty" aria-hidden="true" />
                        )}
                        <div className="pv-meta">
                          <div className="pv-cap" title={r.caption || r.url}>{r.caption || r.url}</div>
                          <div className="pv-stats">
                            {r.platform}
                            {typeof r.views === 'number' ? ` · ${formatCount(r.views)} views` : ''}
                            {typeof r.likes === 'number' ? ` · ${formatCount(r.likes)} likes` : ''}
                          </div>
                        </div>
                        <select
                          className="input pv-select"
                          value={r.brandId}
                          onChange={(e) => setRowBrand(r.id, e.target.value)}
                          aria-label="Assign to brand"
                        >
                          <option value="">Unmatched</option>
                          {brands.map((b) => (
                            <option key={b.id} value={b.id}>{brandName.get(b.id)}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="modal-foot">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void add()}
            disabled={saving || loading || selectedCount === 0}
          >
            {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
            {saving ? 'Adding…' : selectedCount > 0 ? `Add ${selectedCount} ${selectedCount === 1 ? 'video' : 'videos'}` : 'Add videos'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
