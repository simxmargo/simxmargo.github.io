'use client'

import { useEffect, useState } from 'react'
import { Mail, ShieldCheck, AlertTriangle, RotateCcw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { saveSettings } from '@/lib/admin/resources/settings'
import { useStore } from '@/lib/store'
import { useAdminResource, adminKeys, type AdminFetchError } from '@/lib/admin/queries'
import { FormSkeleton } from '@/components/admin/Skeleton'

// Outreach-only Studio Settings. All creator identity lives on the Profile tab and
// the site favicon lives on the Theme tab (Media Kit) — this page owns ONLY app
// config that persists to app_settings: the daily send cap. Reads flow through the
// shared TanStack Query cache so navigating between admin tabs never re-flashes
// the skeleton.

interface SettingsData {
  dailyCap: number
}

type Save = 'idle' | 'saving' | 'saved' | 'error' | 'unconfigured'

export function SettingsPage() {
  const rehydrate = useStore((s) => s.hydrate)
  const qc = useQueryClient()
  const q = useAdminResource<SettingsData>('settings')

  const [dailyCap, setDailyCap] = useState(20)
  const [save, setSave] = useState<Save>('idle')
  const [saveErr, setSaveErr] = useState('')

  // Seed local form state from the cached query data. Stable while cached, so this
  // only re-runs when the underlying settings actually change.
  useEffect(() => {
    if (!q.data) return
    setDailyCap(typeof q.data.dailyCap === 'number' ? q.data.dailyCap : 20)
  }, [q.data])

  function setCap(n: number) {
    setDailyCap(n)
    if (save !== 'idle') setSave('idle')
  }

  async function onSave() {
    setSave('saving')
    setSaveErr('')
    try {
      await saveSettings({ dailyCap })
      setSave('saved')
      qc.invalidateQueries({ queryKey: adminKeys.settings })
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
          <p className="page-sub">App configuration — your outreach sending limits.</p>
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
