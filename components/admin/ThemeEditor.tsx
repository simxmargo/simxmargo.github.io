'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, AlertTriangle, RotateCcw, Palette, Eye, ImageIcon } from 'lucide-react'
import { saveProfile } from '@/lib/admin/resources/profile'
import { useAdminResource, adminKeys, AdminFetchError } from '@/lib/admin/queries'
import type { PublicProfile } from '@/lib/mediakit-types'
import { onAccentInk, readableAccentText, contrastRatio, contrastLabel, PAGE_BG, AA_TEXT } from '@/lib/theme/contrast'
import { FormSkeleton } from '@/components/admin/Skeleton'
import { StudioImageSlot } from '@/components/admin/StudioImageSlot'
import { themeFaviconDataUrl } from '@/lib/mediakit/favicon'
import { applyFavicon } from '@/lib/applyFavicon'

// Accent presets: the active brand red first, then the design's original 5 options.
const PRESETS = ['#e33b3b', '#e0694b', '#c89b3c', '#b6485f', '#6f7d5a', '#8a6fc4']

const isHex6 = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s)

// Live WCAG contrast badge — green ✓ AA at ≥4.5:1, accent warning below.
function Badge({ ratio }: { ratio: number }) {
  const { text, pass } = contrastLabel(ratio)
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: pass ? '#57a97b' : '#e0694b' }}
    >
      {pass ? <CheckCircle2 size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}
      {text} {pass ? 'AA' : 'low'}
    </span>
  )
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'config-missing'

export function ThemeEditor() {
  const qc = useQueryClient()
  const q = useAdminResource<Partial<PublicProfile>>('profile')
  const [accent, setAccent] = useState('#e33b3b')
  const [tileTheme, setTileTheme] = useState<'light' | 'dark'>('light')
  const [recentAccents, setRecentAccents] = useState<string[]>([])
  const [accentInk, setAccentInk] = useState('') // '' = Auto (derive from accent)
  const [accentText, setAccentText] = useState('') // '' = Auto (readable accent)
  const [faviconUrl, setFaviconUrl] = useState('') // '' = theme-coloured brand mark
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
    setAccentInk(typeof p.theme?.accentInk === 'string' ? p.theme.accentInk : '')
    setAccentText(typeof p.theme?.accentText === 'string' ? p.theme.accentText : '')
    setFaviconUrl(typeof p.faviconUrl === 'string' ? p.faviconUrl : '')
  }, [q.data])

  async function onSave() {
    setSave('saving')
    setErr('')
    // Prepend the just-saved accent to the recent list: newest first, de-duped
    // (case-insensitive), capped at 5. Persisted in the theme jsonb so it survives reloads.
    const nextRecent = [accent, ...recentAccents.filter((c) => c.toLowerCase() !== accent.toLowerCase())].slice(0, 5)
    try {
      await saveProfile({
        faviconUrl,
        theme: {
          accent,
          tileTheme,
          recentAccents: nextRecent,
          // Persist overrides only; omitting a key means "Auto" (derived at render time).
          ...(isHex6(accentInk) ? { accentInk } : {}),
          ...(isHex6(accentText) ? { accentText } : {}),
        },
      })
      setRecentAccents(nextRecent)
      setSave('saved')
      void qc.invalidateQueries({ queryKey: adminKeys.profile })
      // Swap the browser-tab icon immediately (AdminShell's sidebar re-reads it
      // from the invalidated profile cache).
      applyFavicon(faviconUrl || themeFaviconDataUrl(isHex6(accent) ? accent : ''))
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

  // Contrast-safe derivations (mirror app/page.tsx): Auto comes from the accent, a valid
  // custom hex overrides. Ratios feed the live WCAG badges + the auto-lighten notice.
  const autoInk = onAccentInk(safeAccent)
  const effInk = isHex6(accentInk) ? accentInk : autoInk
  const autoText = readableAccentText(safeAccent)
  const effText = isHex6(accentText) ? accentText : autoText
  const inkRatio = contrastRatio(effInk, safeAccent) // button label vs button fill
  const textRatio = contrastRatio(effText, PAGE_BG) // accent-text vs page bg
  const rawTextRatio = contrastRatio(safeAccent, PAGE_BG) // the raw accent as text

  return (
    <>
      <header className="main-head">
        <div>
          <h1 className="page-title display">Theme</h1>
          <p className="page-sub">Accent, button-label &amp; accent-text colours, the logo-tile background and your site icon — with live contrast checks.</p>
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
          <p className="card-sub indent">Pick a preset or custom hex. The button label &amp; accent-text stay contrast-safe automatically — override either if you want.</p>

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

            <div className="field">
              <span className="flabel">Button label</span>
              <div className="seg" role="group" aria-label="Button label colour mode" style={{ maxWidth: 200 }}>
                {(['auto', 'custom'] as const).map((m) => {
                  const active = m === 'auto' ? !accentInk : !!accentInk
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setAccentInk(m === 'auto' ? '' : accentInk || autoInk)}
                      className={`seg-btn capitalize${active ? ' active' : ''}`}
                      aria-pressed={active}
                    >
                      {m}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
                <span
                  aria-hidden="true"
                  style={{ height: 30, width: 34, borderRadius: 6, background: safeAccent, color: effInk, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, border: '1px solid var(--line)' }}
                >
                  Aa
                </span>
                {accentInk ? (
                  <>
                    <input type="color" value={isHex6(accentInk) ? accentInk : autoInk} onChange={(e) => setAccentInk(e.target.value)} aria-label="Button label colour" className="cursor-pointer" style={{ height: 30, width: 34, borderRadius: 7, border: '1px solid var(--line)', background: 'var(--field)', padding: 2 }} />
                    <input type="text" value={accentInk} onChange={(e) => setAccentInk(e.target.value)} aria-label="Button label hex" className="input font-mono" style={{ width: 110 }} placeholder="#ffffff" />
                  </>
                ) : (
                  <span className="field-hint" style={{ margin: 0 }}>Auto → {autoInk.toLowerCase()}</span>
                )}
                <Badge ratio={inkRatio} />
              </div>
              <span className="field-hint">Text on your accent button. Auto picks black or white for the best contrast.</span>
            </div>

            <div className="field">
              <span className="flabel">Accent text</span>
              <div className="seg" role="group" aria-label="Accent text colour mode" style={{ maxWidth: 200 }}>
                {(['auto', 'custom'] as const).map((m) => {
                  const active = m === 'auto' ? !accentText : !!accentText
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setAccentText(m === 'auto' ? '' : accentText || autoText)}
                      className={`seg-btn capitalize${active ? ' active' : ''}`}
                      aria-pressed={active}
                    >
                      {m}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
                <span
                  aria-hidden="true"
                  style={{ height: 30, padding: '0 10px', borderRadius: 6, background: '#0b0a08', color: effText, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 700, border: '1px solid var(--line)' }}
                >
                  Text
                </span>
                {accentText ? (
                  <>
                    <input type="color" value={isHex6(accentText) ? accentText : autoText} onChange={(e) => setAccentText(e.target.value)} aria-label="Accent text colour" className="cursor-pointer" style={{ height: 30, width: 34, borderRadius: 7, border: '1px solid var(--line)', background: 'var(--field)', padding: 2 }} />
                    <input type="text" value={accentText} onChange={(e) => setAccentText(e.target.value)} aria-label="Accent text hex" className="input font-mono" style={{ width: 110 }} placeholder={autoText} />
                  </>
                ) : (
                  <span className="field-hint" style={{ margin: 0 }}>Auto → {autoText.toLowerCase()}</span>
                )}
                <Badge ratio={textRatio} />
              </div>
              {!accentText && rawTextRatio < AA_TEXT ? (
                <span className="field-hint">Your accent is {rawTextRatio.toFixed(1)}:1 on the dark background — auto-lightened so eyebrow dots, labels &amp; links stay readable.</span>
              ) : (
                <span className="field-hint">Colour of the eyebrow dots, section labels &amp; links on your kit.</span>
              )}
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

        {/* Favicon — browser-tab icon for the whole site. Stored on the same
            public_profile row (favicon_url) and saved in the same saveProfile
            call as the theme, so "Save theme" covers both. */}
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
                onChange={setFaviconUrl}
                folder="favicon"
                shape="rounded"
                className="slot-favicon"
                placeholder="Drop favicon"
                fallbackSrc={themeFaviconDataUrl(safeAccent)}
                ariaLabel="Upload favicon"
              />
              <div>
                <div className="ib-label">Site icon</div>
                <div className="ib-help">
                  This is your current browser-tab icon. By default it&rsquo;s your brand mark in your{' '}
                  <strong>accent colour</strong> (it follows the accent above). Upload a square PNG to
                  override it with a custom icon.
                </div>
                {faviconUrl && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 10 }}
                    onClick={() => setFaviconUrl('')}
                  >
                    <RotateCcw size={14} aria-hidden="true" /> Reset to theme default
                  </button>
                )}
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
            <div style={{ borderRadius: 12, padding: 28, background: '#0b0a08' }}>
              <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', fontWeight: 600, color: 'rgba(244,239,229,0.55)' }}>
                Philippines <span style={{ color: effText }}>·</span> Fashion <span style={{ color: effText }}>·</span> Beauty
              </div>
              <div
                style={{
                  color: '#f3eee4',
                  fontFamily: 'var(--font-druk), "Druk Wide", "Archivo Black", sans-serif',
                  fontSize: 22,
                  fontWeight: 700,
                  lineHeight: 1.05,
                  marginTop: 10,
                }}
              >
                simxmargo
              </div>
              <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: effText }}>Trusted by leading brands</div>
              <span
                style={{
                  display: 'inline-block',
                  marginTop: 18,
                  background: safeAccent,
                  color: effInk,
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
