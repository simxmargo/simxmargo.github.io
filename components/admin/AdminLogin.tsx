'use client'

import { useState, type CSSProperties, type FormEvent } from 'react'
import { signInAdmin, useAdminSession } from '@/lib/admin/auth'
import { readCachedAccent, accentStyle } from '@/lib/admin/themeCache'

// Replaces AdminGate: a single password field (the admin email is fixed in config, so
// the influencer only types a password). On success the Supabase session persists, so
// returning visits skip straight to the studio. RLS — not this screen — is the real
// security boundary; this is just the unlock UX.
export function AdminLogin({ children }: { children: React.ReactNode }) {
  const session = useAdminSession()
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [focused, setFocused] = useState(false)
  // Tint the login portal with the saved accent from cache (it's pre-auth, so there's
  // no theme data to read) — so the studio's colour is consistent before sign-in too.
  const [cachedAccent] = useState(readCachedAccent)
  const accent = accentStyle(cachedAccent)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!password) return
    setStatus('submitting')
    const { error } = await signInAdmin(password)
    if (error) {
      setStatus('error')
      return
    }
    setStatus('idle')
    setPassword('')
  }

  // Still checking the persisted session — avoid flashing the login form.
  if (session === null) {
    return (
      <div className="studio" style={screen}>
        <p style={{ color: 'var(--muted, #a59c8f)' }}>Loading…</p>
      </div>
    )
  }

  if (session) return <>{children}</>

  return (
    <div className="studio" style={{ ...screen, ...accent }}>
      <form onSubmit={onSubmit} style={card} aria-label="Studio login">
        {/* Chrome/Safari paint a pale-blue background on autofilled fields that inline
            styles can't override (the :-webkit-autofill pseudo wins). Re-skin it to the
            dark theme via the inset box-shadow trick; the 9999s transition kills the flash. */}
        <style>{`
          #admin-pw:-webkit-autofill,
          #admin-pw:-webkit-autofill:hover,
          #admin-pw:-webkit-autofill:focus,
          #admin-pw:-webkit-autofill:active {
            -webkit-box-shadow: 0 0 0 1000px var(--field, #211d18) inset;
            -webkit-text-fill-color: var(--ink, #f1ece2);
            caret-color: var(--ink, #f1ece2);
            border-radius: 10px;
            transition: background-color 9999s ease-out 0s;
          }
        `}</style>
        <h1 style={title}>simxmargo studio</h1>
        <p style={sub}>Enter your password to edit the media kit.</p>

        <label htmlFor="admin-pw" style={srOnly}>
          Password
        </label>
        <input
          id="admin-pw"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (status === 'error') setStatus('idle')
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus
          required
          style={focused ? { ...input, ...inputFocus } : input}
        />

        {status === 'error' && (
          <p role="alert" style={errorText}>
            Incorrect password.
          </p>
        )}

        <button
          type="submit"
          disabled={status === 'submitting'}
          style={status === 'submitting' ? { ...button, ...buttonBusy } : button}
        >
          {status === 'submitting' ? 'Unlocking…' : 'Unlock studio'}
        </button>
      </form>
    </div>
  )
}

// Inline styles keep this gate self-contained (no globals.css dependency) while still
// reading the .studio theme tokens with sane fallbacks.
// Flexbox (not grid) so the .studio scope's `grid-template-columns: 262px 1fr`
// can't leak in and pin the card to the narrow sidebar column. Flex centers the
// card on both axes regardless of the inherited .studio grid template.
const screen: CSSProperties = {
  minHeight: '100dvh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg, #141210)',
  padding: 24,
}
const card: CSSProperties = {
  width: '100%',
  maxWidth: 360,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  padding: 32,
  borderRadius: 14,
  background: 'var(--panel, #1b1814)',
  border: '1px solid var(--line, rgba(241,236,226,0.08))',
  boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
}
const title: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-druk), 'Druk Wide', 'Archivo Black', sans-serif",
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: '-0.01em',
  color: 'var(--ink, #f1ece2)',
}
const sub: CSSProperties = { margin: 0, fontSize: 14, color: 'var(--muted, #a59c8f)' }
const input: CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid var(--line, rgba(241,236,226,0.14))',
  background: 'var(--field, rgba(0,0,0,0.25))',
  color: 'var(--ink, #f1ece2)',
  fontSize: 15,
  outline: 'none',
  transition: 'border-color 120ms ease, box-shadow 120ms ease',
}
// Terracotta focus ring mirroring the .studio `.input.input-fetched` treatment,
// replacing the browser default outline.
const inputFocus: CSSProperties = {
  borderColor: 'var(--accent, #cf5d39)',
  boxShadow: '0 0 0 3px var(--accent-soft, rgba(207,93,57,0.16))',
}
const button: CSSProperties = {
  marginTop: 4,
  padding: '12px 14px',
  borderRadius: 10,
  border: 'none',
  background: 'var(--accent, #cf5d39)',
  color: '#fff',
  fontWeight: 600,
  fontSize: 15,
  letterSpacing: '0.01em',
  cursor: 'pointer',
  transition: 'opacity 120ms ease',
}
const buttonBusy: CSSProperties = { opacity: 0.65, cursor: 'progress' }
const errorText: CSSProperties = { margin: 0, fontSize: 13, color: 'var(--danger, #d2674a)' }
const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
}
