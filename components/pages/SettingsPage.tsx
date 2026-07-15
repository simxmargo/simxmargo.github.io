'use client'

import { useEffect, useState } from 'react'
import { Mail, ImageIcon, ShieldCheck, AlertTriangle, RotateCcw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { saveSettings } from '@/lib/admin/resources/settings'
import { useStore } from '@/lib/store'
import { useAdminResource, adminKeys, type AdminFetchError } from '@/lib/admin/queries'
import { StudioImageSlot } from '@/components/admin/StudioImageSlot'
import { FormSkeleton } from '@/components/admin/Skeleton'
import { themeFaviconDataUrl } from '@/lib/mediakit/favicon'
import { applyFavicon } from '@/lib/applyFavicon'
import type { PublicProfile } from '@/lib/mediakit-types'

// App-config-only Studio Settings. All creator identity + outreach fields and the
// public media-kit images now live on the Profile tab (they share the public_profile
// row via /api/admin/profile). This page owns ONLY app config that persists to
// app_settings via /api/admin/settings: the browser-tab favicon and the daily send
// cap. Reads flow through the shared TanStack Query cache so navigating between admin
// tabs never re-flashes the skeleton.

interface SettingsData {
  faviconUrl: string
  dailyCap: number
}

type Save = 'idle' | 'saving' | 'saved' | 'error' | 'unconfigured'

export function SettingsPage() {
  const rehydrate = useStore((s) => s.hydrate)
  const qc = useQueryClient()
  const q = useAdminResource<SettingsData>('settings')
  // The theme accent drives the DEFAULT favicon preview (same mark the browser tab +
  // sidebar show when no custom icon is uploaded). Shared cache key with Theme/Profile.
  const profileQ = useAdminResource<Partial<PublicProfile>>('profile')
  const defaultFavicon = themeFaviconDataUrl(profileQ.data?.theme?.accent ?? '')

  const [faviconUrl, setFaviconUrl] = useState('')
  const [dailyCap, setDailyCap] = useState(20)
  const [save, setSave] = useState<Save>('idle')
  const [saveErr, setSaveErr] = useState('')

  // Seed local form state from the cached query data. Stable while cached, so this
  // only re-runs when the underlying settings actually change.
  useEffect(() => {
    if (!q.data) return
    setFaviconUrl(q.data.faviconUrl ?? '')
    setDailyCap(typeof q.data.dailyCap === 'number' ? q.data.dailyCap : 20)
  }, [q.data])

  function onFavicon(url: string) {
    setFaviconUrl(url)
    if (save !== 'idle') setSave('idle')
  }
  function setCap(n: number) {
    setDailyCap(n)
    if (save !== 'idle') setSave('idle')
  }

  async function onSave() {
    setSave('saving')
    setSaveErr('')
    try {
      await saveSettings({ faviconUrl, dailyCap })
      setSave('saved')
      qc.invalidateQueries({ queryKey: adminKeys.settings })
      // favicon_url lives on the profile row too (AdminShell reads it from there) —
      // keep that cache honest AND swap the tab icon immediately for instant feedback.
      qc.invalidateQueries({ queryKey: adminKeys.profile })
      applyFavicon(faviconUrl || defaultFavicon)
      void rehydrate() // refresh the queue meter so it picks up the new daily cap
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (msg === 'Studio is not configured.') return setSave('unconfigured')
      setSaveErr(msg || 'Couldn’t reach the server. Try again.')
      setSave('error')
    }
  }

  const saveLabel = save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved ✓' : 'Save changes'
  const cap = dailyCap
  const capPct = `${(((cap - 5) / 95) * 100).toFixed(2)}%`

  if (q.isLoading) {
    return <FormSkeleton withHeader titleW={150} subW={420} cards={2} fields={2} />
  }

  if (q.isError) {
    const err = q.error as AdminFetchError | null
    return (
      <>
        <header className="main-head">
          <div>
            <h1 className="page-title display">Settings</h1>
            <p className="page-sub">App configuration for your studio.</p>
          </div>
        </header>
        <div className="stack">
          <div className="banner banner-error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <div>
              <p style={{ fontWeight: 600, margin: 0 }}>
                {err?.message ?? `Couldn’t load settings${err?.status ? ` (${err.status})` : ''}.`}
              </p>
              <button
                type="button"
                onClick={() => void q.refetch()}
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 12 }}
              >
                <RotateCcw size={14} aria-hidden="true" /> Retry
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <header className="main-head">
        <div>
          <h1 className="page-title display">Settings</h1>
          <p className="page-sub">App configuration — your site icon and outreach sending limits.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={save === 'saving'}>
          {saveLabel}
        </button>
      </header>

      <div className="stack">
        {/* Sending account — Gmail OAuth, backend pending */}
        <section className="card">
          <div className="card-head">
            <span className="ico-badge"><Mail size={18} aria-hidden="true" /></span>
            <h2 className="card-title">Sending account</h2>
          </div>
          <p className="card-sub indent">
            Connect a dedicated secondary Gmail. Replies route to your Reply-to email so brands reach you directly.
          </p>
          <div className="card-body">
            <div className="connect">
              <div className="flex items-center gap-3">
                <span className="ico-badge"><Mail size={18} aria-hidden="true" /></span>
                <div>
                  <div className="connect-t">No sending account connected</div>
                  <div className="connect-s">Use a fresh secondary inbox — never your main one.</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="tag">Backend pending</span>
                {/* TODO(studio-backend): launch Gmail OAuth (gmail.send scope) via Edge Function. */}
                <button type="button" className="btn btn-ghost is-disabled" disabled title="Backend pending — see docs/BACKEND_DESIGN.md">
                  Connect Gmail
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Favicon — browser-tab icon for the whole site */}
        <section className="card">
          <div className="card-head">
            <span className="ico-badge"><ImageIcon size={18} aria-hidden="true" /></span>
            <h2 className="card-title">Favicon</h2>
          </div>
          <p className="card-sub indent">The icon shown on the browser tab, across your whole site.</p>
          <div className="card-body">
            <div className="img-block">
              <StudioImageSlot
                value={faviconUrl}
                onChange={onFavicon}
                folder="favicon"
                shape="rounded"
                className="slot-favicon"
                placeholder="Drop favicon"
                fallbackSrc={defaultFavicon}
                ariaLabel="Upload favicon"
              />
              <div>
                <div className="ib-label">Site icon</div>
                <div className="ib-help">
                  This is your current browser-tab icon. By default it&rsquo;s your brand mark in the{' '}
                  <strong>theme colour</strong> (it follows the accent you pick in Theme). Upload a square
                  PNG to override it with a custom icon.
                </div>
                {faviconUrl && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 10 }}
                    onClick={() => onFavicon('')}
                  >
                    <RotateCcw size={14} aria-hidden="true" /> Reset to theme default
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Sending safety */}
        <section className="card">
          <div className="card-head">
            <span className="ico-badge"><ShieldCheck size={18} aria-hidden="true" /></span>
            <h2 className="card-title">Sending safety</h2>
          </div>
          <div className="card-body">
            <div style={{ fontSize: 14.5 }}>
              Daily send cap: <strong>{cap}</strong>
            </div>
            <div className="slider">
              <div className="slider-track"><div className="slider-fill" style={{ width: capPct }} /></div>
              <div className="slider-thumb" style={{ left: capPct }} />
              <input
                className="slider-input"
                type="range"
                min={5}
                max={100}
                value={cap}
                onChange={(e) => setCap(Number(e.target.value))}
                aria-label="Daily send cap"
              />
            </div>
            <div className="flex justify-between" style={{ marginTop: 8 }}>
              <span className="muted-sm">5</span>
              <span className="muted-sm">100</span>
            </div>
            <p className="card-sub" style={{ marginTop: 14 }}>
              Start low (10–20) and ramp slowly to keep your sending account healthy.
            </p>
          </div>
        </section>

        {/* Save state feedback */}
        {save === 'unconfigured' && (
          <div className="banner banner-warn" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>Saving needs SUPABASE_SERVICE_ROLE_KEY set on the server.</span>
          </div>
        )}
        {save === 'error' && (
          <div className="banner banner-error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{saveErr}</span>
          </div>
        )}
      </div>
    </>
  )
}
