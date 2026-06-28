'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, AlertTriangle, RotateCcw, Palette, Eye } from 'lucide-react'
import { saveProfile } from '@/lib/admin/resources/profile'
import { useAdminResource, adminKeys, AdminFetchError } from '@/lib/admin/queries'
import type { PublicProfile } from '@/lib/mediakit-types'
import { FormSkeleton } from '@/components/admin/Skeleton'

// Accent presets: the active brand red first, then the design's original 5 options.
const PRESETS = ['#e33b3b', '#e0694b', '#c89b3c', '#b6485f', '#6f7d5a', '#8a6fc4']

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'config-missing'

export function ThemeEditor() {
  const qc = useQueryClient()
  const q = useAdminResource<Partial<PublicProfile>>('profile')
  const [accent, setAccent] = useState('#e33b3b')
  const [tileTheme, setTileTheme] = useState<'light' | 'dark'>('light')
  const [recentAccents, setRecentAccents] = useState<string[]>([])
  const [save, setSave] = useState<SaveState>('idle')
  const [err, setErr] = useState('')

  // Seed local editable state from the cached profile. q.data is a stable
  // reference while cached, so this runs only on first load + after an
  // invalidation — not on every render.
  useEffect(() => {
    if (!q.data) return
    const p = q.data
    if (p.theme?.accent) setAccent(p.theme.accent)
    if (p.theme?.tileTheme) setTileTheme(p.theme.tileTheme)
    if (Array.isArray(p.theme?.recentAccents)) setRecentAccents(p.theme.recentAccents.slice(0, 5))
  }, [q.data])

  async function onSave() {
    setSave('saving')
    setErr('')
    // Prepend the just-saved accent to the recent list: newest first, de-duped
    // (case-insensitive), capped at 5. Persisted in the theme jsonb so it survives reloads.
    const nextRecent = [accent, ...recentAccents.filter((c) => c.toLowerCase() !== accent.toLowerCase())].slice(0, 5)
    try {
      await saveProfile({ theme: { accent, tileTheme, recentAccents: nextRecent } })
      setRecentAccents(nextRecent)
      setSave('saved')
      void qc.invalidateQueries({ queryKey: adminKeys.profile })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Couldn’t reach the server. Try again.')
      setSave('error')
    }
  }

  if (q.isLoading) {
    return <FormSkeleton withHeader titleW={120} subW={430} cards={1} fields={4} />
  }
  if (q.isError) {
    const status = (q.error as AdminFetchError | null)?.status
    const loadErr =
      status === 503
        ? 'Loading needs SUPABASE_SERVICE_ROLE_KEY set on the server.'
        : status
          ? `Couldn’t load the theme (${status}).`
          : 'Couldn’t reach the server. Try again.'
    return (
      <div className="banner banner-error" role="alert">
        <AlertTriangle size={18} aria-hidden="true" />
        <div>
          <span>{loadErr}</span>
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={() => void q.refetch()}
              className="btn btn-ghost btn-sm"
            >
              <RotateCcw size={14} aria-hidden="true" /> Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  const isHex = /^#[0-9a-fA-F]{6}$/.test(accent)
  const safeAccent = isHex ? accent : '#e33b3b'

  return (
    <>
      <header className="main-head">
        <div>
          <h1 className="page-title display">Theme</h1>
          <p className="page-sub">The accent colour and logo-tile background on your public media kit.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={save === 'saving' || !isHex}>
          {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Save again' : 'Save theme'}
        </button>
      </header>

      <div className="stack">
        <section className="card">
          <div className="card-head">
            <span className="ico-badge"><Palette size={18} aria-hidden="true" /></span>
            <h2 className="card-title">Accent &amp; tile</h2>
          </div>
          <p className="card-sub indent">Pick a preset or enter a custom hex, and choose the logo-tile background.</p>

          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div className="field">
              <span className="flabel">Accent colour</span>
              <div className="flex flex-wrap items-center gap-2">
                {PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Use ${c}`}
                    onClick={() => setAccent(c)}
                    className="cursor-pointer"
                    style={{
                      height: 36,
                      width: 36,
                      borderRadius: '50%',
                      background: c,
                      border: '2px solid',
                      borderColor: accent.toLowerCase() === c.toLowerCase() ? 'var(--ink)' : 'var(--line)',
                      transition: 'border-color 0.15s',
                    }}
                  />
                ))}
                <span style={{ margin: '0 4px', height: 24, width: 1, background: 'var(--line)' }} />
                <input
                  type="color"
                  value={safeAccent}
                  onChange={(e) => setAccent(e.target.value)}
                  aria-label="Custom colour picker"
                  className="cursor-pointer"
                  style={{
                    height: 36,
                    width: 36,
                    borderRadius: 9,
                    border: '1px solid var(--line)',
                    background: 'var(--field)',
                    padding: 2,
                  }}
                />
                <input
                  type="text"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  aria-label="Custom hex value"
                  className="input font-mono"
                  style={{ width: 128 }}
                  placeholder="#e33b3b"
                />
              </div>
              {!isHex && <span className="field-hint" style={{ color: 'var(--accent)' }}>Enter a 6-digit hex like #e33b3b.</span>}
            </div>

            {recentAccents.length > 0 && (
              <div className="field">
                <span className="flabel">Recent</span>
                <div className="flex flex-wrap items-center gap-2">
                  {recentAccents.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Use recent colour ${c}`}
                      title={c}
                      onClick={() => setAccent(c)}
                      className="cursor-pointer"
                      style={{
                        height: 32,
                        width: 32,
                        borderRadius: '50%',
                        background: c,
                        border: '2px solid',
                        borderColor: accent.toLowerCase() === c.toLowerCase() ? 'var(--ink)' : 'var(--line)',
                        transition: 'border-color 0.15s',
                      }}
                    />
                  ))}
                </div>
                <span className="field-hint">Your last 5 saved accents — click to reuse.</span>
              </div>
            )}

            <div className="field">
              <span className="flabel">Logo tile background</span>
              <div className="seg" role="group" aria-label="Logo tile background">
                {(['light', 'dark'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTileTheme(t)}
                    className={`seg-btn capitalize${tileTheme === t ? ' active' : ''}`}
                    aria-pressed={tileTheme === t}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Live preview on the public kit's dark canvas */}
        <section className="card">
          <div className="card-head">
            <span className="ico-badge"><Eye size={18} aria-hidden="true" /></span>
            <h2 className="card-title">Preview</h2>
          </div>
          <p className="card-sub indent">How the accent reads on your live media kit.</p>
          <div className="card-body">
            <div style={{ borderRadius: 12, padding: 28, background: '#0e0d0b' }}>
              <div
                style={{
                  color: '#f3eee4',
                  fontFamily: 'var(--font-druk), "Druk Wide", "Archivo Black", sans-serif',
                  fontSize: 22,
                  fontWeight: 700,
                  lineHeight: 1.05,
                }}
              >
                simxmargo
              </div>
              <span
                style={{
                  display: 'inline-block',
                  marginTop: 18,
                  background: safeAccent,
                  color: '#14110d',
                  padding: '9px 18px',
                  borderRadius: 2,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Work with me
              </span>
            </div>
          </div>
        </section>

        {save === 'saved' && (
          <span className="save-ok" role="status">
            <CheckCircle2 size={16} aria-hidden="true" /> Saved — refresh the public kit to see it.
          </span>
        )}
        {save === 'error' && (
          <div className="banner banner-error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{err}</span>
          </div>
        )}
        {save === 'config-missing' && (
          <div className="banner banner-warn" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>Saving needs SUPABASE_SERVICE_ROLE_KEY set on the server.</span>
          </div>
        )}
      </div>
    </>
  )
}
