'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { BarChart3, AlertTriangle, Check, Eye, EyeOff } from 'lucide-react'
import { adminFetch } from '@/lib/adminClient'
import type { Platform, SocialStat } from '@/lib/mediakit-types'
import { formatCount } from '@/lib/mediakit-types'

// Private admin editor for per-platform social stats shown on the public kit.
// GET /api/admin/socials on mount → one card per platform; per-card PUT saves a
// single platform. API auto-sync is a later phase, so everything here is manual.
// Light "studio" theme to match the rest of the admin shell. No props (self-fetch).

// Editable card row. We extend SocialStat with a UI-only `visible` flag (the
// public kit hides non-visible platforms) so the editor can toggle it locally.
interface SocialRow extends SocialStat {
  visible: boolean
}

type LoadState = 'loading' | 'ready' | 'error'
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
  // Unknown/future platform → Title-case the raw key as a graceful fallback.
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

const labelCls = 'text-xs font-medium uppercase tracking-wide text-stone-400'
const inputCls =
  'rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-plum-500 focus:outline-none focus:ring-1 focus:ring-plum-500'
const primaryBtn =
  'rounded-lg bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50'

export function SocialStatsEditor() {
  const [load, setLoad] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<string>('')
  const [rows, setRows] = useState<SocialRow[]>([])
  // Per-platform save state, keyed by platform.
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({})

  useEffect(() => {
    let cancelled = false
    async function loadStats() {
      setLoad('loading')
      setLoadError('')
      try {
        const res = await adminFetch('/api/admin/socials')
        if (!res.ok) {
          throw new Error(`Request failed (${res.status})`)
        }
        const data: unknown = await res.json()
        if (cancelled) return
        const list = Array.isArray(data) ? (data as Partial<SocialRow>[]) : []
        const normalized: SocialRow[] = list.map((s) => ({
          platform: (s.platform ?? 'instagram') as Platform,
          handle: s.handle ?? '',
          profileUrl: s.profileUrl ?? '',
          followers: typeof s.followers === 'number' ? s.followers : 0,
          avgViews: typeof s.avgViews === 'number' ? s.avgViews : null,
          engagementRate: typeof s.engagementRate === 'number' ? s.engagementRate : null,
          growth30d: typeof s.growth30d === 'number' ? s.growth30d : null,
          history: Array.isArray(s.history) ? s.history : [],
          // Default to visible when the API doesn't send the flag.
          visible: s.visible !== false,
        }))
        setRows(normalized)
        setLoad('ready')
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Could not load social stats.')
        setLoad('error')
      }
    }
    loadStats()
    return () => {
      cancelled = true
    }
  }, [])

  function patchRow(platform: string, patch: Partial<SocialRow>) {
    setRows((prev) => prev.map((r) => (r.platform === platform ? { ...r, ...patch } : r)))
    // Editing resets a previously-saved/errored card back to idle.
    setSaveState((prev) => (prev[platform] && prev[platform] !== 'saving' ? { ...prev, [platform]: 'idle' } : prev))
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
          visible: row.visible,
        }),
      })
      if (res.status === 503) {
        setSaveState((prev) => ({ ...prev, [row.platform]: 'unconfigured' }))
        return
      }
      if (!res.ok) {
        throw new Error(`Save failed (${res.status})`)
      }
      setSaveState((prev) => ({ ...prev, [row.platform]: 'saved' }))
    } catch {
      setSaveState((prev) => ({ ...prev, [row.platform]: 'error' }))
    }
  }

  const totalReach = rows.reduce((sum, r) => sum + (r.visible ? r.followers : 0), 0)

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-stone-900">Social stats</h1>
          <p className="mt-1 text-sm text-stone-500">
            Followers shown on the public kit. API auto-sync is a later phase.
          </p>
        </div>
        {load === 'ready' && rows.length > 0 && (
          <div className="shrink-0 rounded-xl border border-stone-200 bg-white px-4 py-3 text-right">
            <div className={labelCls}>Total reach</div>
            <div className="mt-0.5 flex items-center justify-end gap-1.5 font-display text-xl font-semibold text-stone-900">
              <BarChart3 size={16} className="text-plum-600" aria-hidden="true" />
              {formatCount(totalReach)}
            </div>
            <div className="text-xs text-stone-400">{totalReach.toLocaleString()} followers · visible only</div>
          </div>
        )}
      </header>

      {load === 'loading' && (
        <div className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-400">
          Loading social stats…
        </div>
      )}

      {load === 'error' && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>Couldn’t load social stats. {loadError}</span>
        </div>
      )}

      {load === 'ready' && rows.length === 0 && (
        <div className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-500">
          No platforms yet.
        </div>
      )}

      {load === 'ready' && rows.length > 0 && (
        <div className="grid gap-5 md:grid-cols-2">
          {rows.map((row) => {
            const state = saveState[row.platform] ?? 'idle'
            return (
              <form
                key={row.platform}
                onSubmit={(e) => saveRow(row, e)}
                className="rounded-xl border border-stone-200 bg-white p-5"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="font-display text-lg font-semibold text-stone-900">
                    {platformLabel(row.platform)}
                  </h2>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.visible}
                    onClick={() => patchRow(row.platform, { visible: !row.visible })}
                    className={`flex h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${
                      row.visible
                        ? 'border-plum-200 bg-plum-50 text-plum-700'
                        : 'border-stone-200 text-stone-500 hover:bg-stone-100'
                    }`}
                  >
                    {row.visible ? (
                      <Eye size={15} aria-hidden="true" />
                    ) : (
                      <EyeOff size={15} aria-hidden="true" />
                    )}
                    {row.visible ? 'Visible' : 'Hidden'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 flex flex-col gap-1">
                    <label htmlFor={`${row.platform}-handle`} className={labelCls}>
                      Handle
                    </label>
                    <input
                      id={`${row.platform}-handle`}
                      type="text"
                      value={row.handle}
                      onChange={(e) => patchRow(row.platform, { handle: e.target.value })}
                      placeholder="@username"
                      className={inputCls}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${row.platform}-followers`} className={labelCls}>
                      Followers
                    </label>
                    <input
                      id={`${row.platform}-followers`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={String(row.followers)}
                      onChange={(e) => patchRow(row.platform, { followers: toFollowers(e.target.value) })}
                      className={inputCls}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${row.platform}-avgviews`} className={labelCls}>
                      Avg views
                    </label>
                    <input
                      id={`${row.platform}-avgviews`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={row.avgViews == null ? '' : String(row.avgViews)}
                      onChange={(e) => patchRow(row.platform, { avgViews: toNum(e.target.value) })}
                      className={inputCls}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${row.platform}-engagement`} className={labelCls}>
                      Engagement rate (%)
                    </label>
                    <input
                      id={`${row.platform}-engagement`}
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={row.engagementRate == null ? '' : String(row.engagementRate)}
                      onChange={(e) => patchRow(row.platform, { engagementRate: toNum(e.target.value) })}
                      className={inputCls}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${row.platform}-growth`} className={labelCls}>
                      Growth 30d (%)
                    </label>
                    <input
                      id={`${row.platform}-growth`}
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={row.growth30d == null ? '' : String(row.growth30d)}
                      onChange={(e) => patchRow(row.platform, { growth30d: toNum(e.target.value) })}
                      className={inputCls}
                    />
                  </div>
                </div>

                {state === 'unconfigured' && (
                  <div
                    role="alert"
                    className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
                  >
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>Saving needs SUPABASE_SERVICE_ROLE_KEY set on the server.</span>
                  </div>
                )}

                {state === 'error' && (
                  <p role="alert" className="mt-4 text-sm text-red-600">
                    Couldn’t save. Please try again.
                  </p>
                )}

                <div className="mt-4 flex items-center gap-3">
                  <button type="submit" disabled={state === 'saving'} className={primaryBtn}>
                    {state === 'saving' ? 'Saving…' : 'Save'}
                  </button>
                  {state === 'saved' && (
                    <span className="flex items-center gap-1 text-sm font-medium text-green-600">
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
    </div>
  )
}
