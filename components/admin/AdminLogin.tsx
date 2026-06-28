'use client'

import { useState, type CSSProperties, type FormEvent } from 'react'
import { signInAdmin, useAdminSession } from '@/lib/admin/auth'

// Replaces AdminGate: a single password field (the admin email is fixed in config, so
// the influencer only types a password). On success the Supabase session persists, so
// returning visits skip straight to the studio. RLS — not this screen — is the real
// security boundary; this is just the unlock UX.
export function AdminLogin({ children }: { children: React.ReactNode }) {
  const session = useAdminSession()
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle')

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
        <p style={{ color: 'var(--fog, #9a948a)' }}>Loading…</p>
      </div>
    )
  }

  if (session) return <>{children}</>

  return (
    <div className="studio" style={screen}>
      <form onSubmit={onSubmit} style={card} aria-label="Studio login">
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
          autoFocus
          required
          style={input}
        />

        {status === 'error' && (
          <p role="alert" style={errorText}>
            Incorrect password.
          </p>
        )}

        <button type="submit" disabled={status === 'submitting'} style={button}>
          {status === 'submitting' ? 'Unlocking…' : 'Unlock studio'}
        </button>
      </form>
    </div>
  )
}

// Inline styles keep this gate self-contained (no globals.css dependency) while still
// reading the .studio theme tokens with sane fallbacks.
const screen: CSSProperties = {
  minHeight: '100dvh',
  display: 'grid',
  placeItems: 'center',
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
  border: '1px solid rgba(241,236,226,0.08)',
}
const title: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-bodoni, Georgia, serif)',
  fontSize: 26,
  color: 'var(--ink, #f1ece2)',
}
const sub: CSSProperties = { margin: 0, fontSize: 14, color: 'var(--fog, #9a948a)' }
const input: CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid rgba(241,236,226,0.14)',
  background: 'rgba(0,0,0,0.25)',
  color: 'var(--ink, #f1ece2)',
  fontSize: 15,
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
  cursor: 'pointer',
}
const errorText: CSSProperties = { margin: 0, fontSize: 13, color: '#e0694b' }
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
