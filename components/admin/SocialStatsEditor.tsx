'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { BarChart3, AlertTriangle, Check, RefreshCw, Loader2, Lock } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { adminFetch } from '@/lib/adminClient'
import { useAdminResource, adminKeys, type AdminFetchError } from '@/lib/admin/queries'
import type { Platform, SocialStat } from '@/lib/mediakit-types'
import { formatCount } from '@/lib/mediakit-types'
import { BrandGlyph, BRAND_META } from '@/components/icons/BrandGlyph'
import { StatRowsSkeleton } from '@/components/admin/Skeleton'

// Private admin editor for per-platform social stats shown on the public kit.
// Reads /api/admin/socials via the shared admin query cache → one card per
// platform; per-card PUT saves a single platform. Manual is the source of truth.
//
// AUTO-FETCH: only TikTok + Instagram have a working keyless scrape (see
// lib/social/scrape.ts). Facebook exposes no public count and needs a Graph token
// the creator can't get, so it's MANUAL ONLY — no Fetch button, just a clear badge.
const FETCHABLE = new Set<string>(['tiktok', 'instagram'])

// Editable card row. We extend SocialStat with a UI-only `visible` flag (the
// public kit hides non-visible platforms) so the editor can toggle it locally.
interface SocialRow extends SocialStat {
  visible: boolean
  source?: string // 'manual' | 'api' — integration provenance
  syncedAt?: string | null
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'unconfigured'

const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  x: 'X',
  twitch: 'Twitch',
}

function platformLabel(platform: string): string {
  if (platform in PLATFORM_LABELS) return PLATFORM_LABELS[platform as Platform]
  return platform.charAt(0).toUpperCase() + platform.slice(1)
}

// Parse a numeric input to `number | null` (empty string ⇒ null, never NaN).
function toNum(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

// Same as toNum but never null — followers is a required non-null number.
function toFollowers(value: string): number {
  return toNum(value) ?? 0
}

// Normalize the /api/admin/socials GET payload → editable rows.
function normalizeRows(data: unknown): SocialRow[] {
  const list = Array.isArray(data) ? (data as Partial<SocialRow>[]) : []
  return list.map((s) => ({
    platform: (s.platform ?? 'instagram') as Platform,
    handle: s.handle ?? '',
    profileUrl: s.profileUrl ?? '',
    followers: typeof s.followers === 'number' ? s.followers : 0,
    avgViews: typeof s.avgViews === 'number' ? s.avgViews : null,
    engagementRate: typeof s.engagementRate === 'number' ? s.engagementRate : null,
    growth30d: typeof s.growth30d === 'number' ? s.growth30d : null,
    history: Array.isArray(s.history) ? s.history : [],
    visible: s.visible !== false,
    source: typeof s.source === 'string' ? s.source : 'manual',
    syncedAt: typeof s.syncedAt === 'string' ? s.syncedAt : null,
  }))
}

interface FetchState {
  status: 'idle' | 'loading' | 'fetched' | 'failed'
  note?: string
}

export function SocialStatsEditor() {
  const q = useAdminResource<unknown>('socials')
  const qc = useQueryClient()
  const [rows, setRows] = useState<SocialRow[]>([])
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({})
  // Per-platform auto-fetch state (loading / freshly-fetched highlight / failure note).
  const [fetchState, setFetchState] = useState<Record<string, FetchState>>({})
  const [fetchingAll, setFetchingAll] = useState(false)

  // Seed editable rows from the cached query data.
  useEffect(() => {
    if (!q.data) return
    setRows(normalizeRows(q.data))
  }, [q.data])

  function patchRow(platform: string, patch: Partial<SocialRow>) {
    setRows((prev) => prev.map((r) => (r.platform === platform ? { ...r, ...patch } : r)))
    setSaveState((prev) => (prev[platform] && prev[platform] !== 'saving' ? { ...prev, [platform]: 'idle' } : prev))
  }

  // Manual edit of a fetched value clears the "fetched" highlight (it's no longer
  // the scraped number).
  function clearFetched(platform: string) {
    setFetchState((prev) => (prev[platform] ? { ...prev, [platform]: { status: 'idle' } } : prev))
  }

  async function saveRow(row: SocialRow, e: FormEvent) {
    e.preventDefault()
    setSaveState((prev) => ({ ...prev, [row.platform]: 'saving' }))
    try {
      const res = await adminFetch('/api/admin/socials', {
        method: 'PUT',
        body: JSON.stringify({
          platform: row.platform,
          handle: row.handle,
          profileUrl: row.profileUrl,
          followers: row.followers,
          avgViews: row.avgViews,
          engagementRate: row.engagementRate,
          growth30d: row.growth30d,
          isVisible: row.visible,
        }),
      })
      if (res.status === 503) {
        setSaveState((prev) => ({ ...prev, [row.platform]: 'unconfigured' }))
        return
      }
      if (!res.ok) throw new Error(`Save failed (${res.status})`)
      setSaveState((prev) => ({ ...prev, [row.platform]: 'saved' }))
      clearFetched(row.platform) // saved → no longer a pending draft
      qc.invalidateQueries({ queryKey: adminKeys.socials })
    } catch {
      setSaveState((prev) => ({ ...prev, [row.platform]: 'error' }))
    }
  }

  // Best-effort: scrape ONE platform's public profile and pre-fill its follower
  // field for review (never auto-writes — the influencer confirms + Saves).
  async function fetchOne(platform: string) {
    if (!FETCHABLE.has(platform)) return
    setFetchState((prev) => ({ ...prev, [platform]: { status: 'loading' } }))
    try {
      const res = await adminFetch('/api/admin/socials/scrape', {
        method: 'POST',
        body: JSON.stringify({ platform }),
      })
      const data = await res.json()
      if (data?.found && typeof data.followers === 'number') {
        patchRow(platform, { followers: data.followers })
        setFetchState((prev) => ({
          ...prev,
          [platform]: { status: 'fetched', note: `Fetched ${formatCount(data.followers)} — review & Save` },
        }))
      } else {
        setFetchState((prev) => ({
          ...prev,
          [platform]: { status: 'failed', note: data?.note || 'Couldn’t read it — enter manually' },
        }))
      }
    } catch {
      setFetchState((prev) => ({ ...prev, [platform]: { status: 'failed', note: 'Request failed — try again' } }))
    }
  }

  // Global: auto-fetch every fetchable platform at once (TikTok + Instagram).
  async function fetchAll() {
    const targets = rows.map((r) => r.platform).filter((p) => FETCHABLE.has(p))
    if (targets.length === 0) return
    setFetchingAll(true)
    await Promise.all(targets.map(fetchOne))
    setFetchingAll(false)
  }

  const totalReach = rows.reduce((sum, r) => sum + (r.visible ? r.followers : 0), 0)
  const ready = !q.isLoading && !q.isError
  const loadError = q.error ? q.error.message : 'Could not load social stats.'
  const hasFetchable = rows.some((r) => FETCHABLE.has(r.platform))

  return (
    <>
      <header className="main-head">
        <div>
          <h1 className="page-title display">Social stats</h1>
          <p className="page-sub">
            Numbers shown on your public kit. Auto-fetch pulls TikTok &amp; Instagram; the rest is by hand.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {ready && hasFetchable && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={fetchAll}
              disabled={fetchingAll}
              title="Reads your public TikTok + Instagram profiles and pre-fills the numbers to review."
            >
              {fetchingAll ? (
                <>
                  <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Fetching…
                </>
              ) : (
                <>
                  <RefreshCw size={15} aria-hidden="true" /> Auto-fetch
                </>
              )}
            </button>
          )}
          {ready && rows.length > 0 && (
            <div
              style={{
                flex: 'none',
                textAlign: 'right',
                background: 'var(--panel)',
                border: '1px solid var(--line)',
                borderRadius: 14,
                padding: '14px 18px',
              }}
            >
              <div className="flabel">Total reach</div>
              <div
                className="display"
                style={{
                  marginTop: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 7,
                  fontSize: 24,
                  fontWeight: 600,
                  color: 'var(--ink)',
                }}
              >
                <BarChart3 size={17} aria-hidden="true" style={{ color: 'var(--accent)' }} />
                {formatCount(totalReach)}
              </div>
              <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--faint)' }}>
                {totalReach.toLocaleString()} followers · visible only
              </div>
            </div>
          )}
        </div>
      </header>

      {q.isLoading && <StatRowsSkeleton />}

      {q.isError && (
        <div className="banner banner-error" role="alert">
          <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
          <span>
            Couldn’t load social stats. {loadError}
            {(q.error as AdminFetchError | null)?.status === 503 && ' Saving needs SUPABASE_SERVICE_ROLE_KEY set on the server.'}
          </span>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 12 }} onClick={() => q.refetch()}>
            Retry
          </button>
        </div>
      )}

      {ready && rows.length === 0 && <div className="empty">No platforms yet.</div>}

      {ready && rows.length > 0 && (
        <div className="stack">
          {rows.map((row) => {
            const state = saveState[row.platform] ?? 'idle'
            const fetch = fetchState[row.platform] ?? { status: 'idle' as const }
            const fetchable = FETCHABLE.has(row.platform)
            const brand = BRAND_META[row.platform as keyof typeof BRAND_META]
            return (
              <form
                key={row.platform}
                onSubmit={(e) => saveRow(row, e)}
                className="card"
                style={brand ? { borderLeft: `3px solid ${brand.color}` } : undefined}
              >
                <div className="card-head" style={{ justifyContent: 'space-between' }}>
                  <div className="flex items-center gap-3">
                    <span
                      className="ico-badge"
                      style={brand ? { background: `color-mix(in srgb, ${brand.color} 16%, transparent)`, color: brand.color } : undefined}
                    >
                      <BrandGlyph platform={row.platform} size={18} colored={false} />
                    </span>
                    <div>
                      <h2 className="card-title">{platformLabel(row.platform)}</h2>
                      <span className={fetchable ? 'pill' : 'pill pill-muted'} style={{ marginTop: 4 }}>
                        {fetchable ? 'Auto-fetch ready' : (
                          <>
                            <Lock size={10} aria-hidden="true" style={{ marginRight: 4, verticalAlign: '-1px' }} />
                            Manual only
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`pill ${row.visible ? 'pill-accent' : ''}`}>
                      {row.visible ? 'Visible' : 'Hidden'}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.visible}
                      aria-label={`Show ${platformLabel(row.platform)} on the public kit`}
                      onClick={() => patchRow(row.platform, { visible: !row.visible })}
                      className="switch"
                    >
                      <span className="switch-knob" />
                    </button>
                  </div>
                </div>

                <div className="card-body grid2">
                  <div className="field col-span">
                    <label htmlFor={`${row.platform}-handle`} className="flabel">
                      Handle
                    </label>
                    <input
                      id={`${row.platform}-handle`}
                      type="text"
                      className="input"
                      value={row.handle}
                      onChange={(e) => patchRow(row.platform, { handle: e.target.value })}
                      placeholder="@username"
                    />
                  </div>

                  {/* Followers — the focal metric + the per-platform fetch affordance. */}
                  <div className="field col-span">
                    <div className="field-row">
                      <label htmlFor={`${row.platform}-followers`} className="flabel">
                        Followers
                      </label>
                      {fetchable ? (
                        <button
                          type="button"
                          className="chip-btn"
                          onClick={() => fetchOne(row.platform)}
                          disabled={fetch.status === 'loading'}
                          title={`Read your public ${platformLabel(row.platform)} and pre-fill the count.`}
                        >
                          {fetch.status === 'loading' ? (
                            <>
                              <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Fetching…
                            </>
                          ) : (
                            <>
                              <RefreshCw size={12} aria-hidden="true" /> Fetch
                            </>
                          )}
                        </button>
                      ) : (
                        <span className="chip-muted">
                          <Lock size={11} aria-hidden="true" /> Manual only
                        </span>
                      )}
                    </div>
                    <input
                      id={`${row.platform}-followers`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      className={`input${fetch.status === 'fetched' ? ' input-fetched' : ''}`}
                      value={String(row.followers)}
                      onChange={(e) => {
                        patchRow(row.platform, { followers: toFollowers(e.target.value) })
                        clearFetched(row.platform)
                      }}
                    />
                    {fetch.note && (
                      <span className={`field-hint ${fetch.status === 'fetched' ? 'hint-ok' : 'hint-warn'}`}>
                        {fetch.status === 'fetched' ? <Check size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}
                        {fetch.note}
                      </span>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor={`${row.platform}-avgviews`} className="flabel">
                      Avg views
                    </label>
                    <input
                      id={`${row.platform}-avgviews`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      className="input"
                      value={row.avgViews == null ? '' : String(row.avgViews)}
                      onChange={(e) => patchRow(row.platform, { avgViews: toNum(e.target.value) })}
                    />
                  </div>

                  <div className="field">
                    <label htmlFor={`${row.platform}-engagement`} className="flabel">
                      Engagement rate (%)
                    </label>
                    <input
                      id={`${row.platform}-engagement`}
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      className="input"
                      value={row.engagementRate == null ? '' : String(row.engagementRate)}
                      onChange={(e) => patchRow(row.platform, { engagementRate: toNum(e.target.value) })}
                    />
                  </div>

                  <div className="field col-span">
                    <label htmlFor={`${row.platform}-growth`} className="flabel">
                      Growth 30d (%)
                    </label>
                    <input
                      id={`${row.platform}-growth`}
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      className="input"
                      value={row.growth30d == null ? '' : String(row.growth30d)}
                      onChange={(e) => patchRow(row.platform, { growth30d: toNum(e.target.value) })}
                    />
                  </div>
                </div>

                {state === 'unconfigured' && (
                  <div className="banner banner-warn" role="alert" style={{ marginTop: 18 }}>
                    <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
                    <span>Saving needs SUPABASE_SERVICE_ROLE_KEY set on the server.</span>
                  </div>
                )}

                {state === 'error' && (
                  <div className="banner banner-error" role="alert" style={{ marginTop: 18 }}>
                    <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
                    <span>Couldn’t save. Please try again.</span>
                  </div>
                )}

                <div className="flex items-center gap-3" style={{ marginTop: 18 }}>
                  <button type="submit" disabled={state === 'saving'} className="btn btn-primary">
                    {state === 'saving' ? 'Saving…' : 'Save'}
                  </button>
                  {state === 'saved' && (
                    <span className="save-ok">
                      <Check size={15} aria-hidden="true" />
                      Saved
                    </span>
                  )}
                </div>
              </form>
            )
          })}
        </div>
      )}
    </>
  )
}
