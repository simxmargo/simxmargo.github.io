'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { getAdminSecret, setAdminSecret } from '@/lib/adminClient'

// Lightweight passphrase gate (NOT a login system). Verifies a single shared
// secret server-side via GET /api/admin/verify, then keeps it in sessionStorage.
// This is UX/convenience; the real protection is the server-side header check on
// every /api/admin/* route. Dark editorial "studio" theme to match the admin.

// The gate renders outside the AdminShell, so it sets its own .studio scope; the
// inline display:flex overrides the .studio grid layout for a centered card.
const centerStudio = { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 } as const
export function AdminGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const stored = getAdminSecret()
    if (!stored) {
      setState('locked')
      return
    }
    fetch('/api/admin/verify', { headers: { 'x-admin-secret': stored } })
      .then((r) => setState(r.ok ? 'open' : 'locked'))
      .catch(() => setState('locked'))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const r = await fetch('/api/admin/verify', { headers: { 'x-admin-secret': value } })
      if (r.ok) {
        setAdminSecret(value)
        setState('open')
      } else if (r.status === 503) {
        setError('Admin isn’t configured on the server yet (set ADMIN_SECRET in .env).')
      } else {
        setError('Incorrect passphrase.')
      }
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (state === 'checking') {
    return (
      <div className="studio" style={centerStudio}>
        <div className="empty" style={{ border: 'none' }}>Loading…</div>
      </div>
    )
  }

  if (state === 'locked') {
    return (
      <div className="studio" style={centerStudio}>
        <form onSubmit={submit} className="card" style={{ width: '100%', maxWidth: 380 }}>
          <span className="ico-badge" style={{ marginBottom: 16 }}>
            <Lock size={18} aria-hidden="true" />
          </span>
          <h1 className="card-title display" style={{ fontSize: 22 }}>Studio access</h1>
          <p className="card-sub" style={{ marginTop: 6 }}>
            Enter the admin passphrase to manage the media kit and outreach.
          </p>
          <label htmlFor="admin-pass" className="sr-only">Admin passphrase</label>
          <input
            id="admin-pass"
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Passphrase"
            className="input"
            style={{ marginTop: 20 }}
          />
          {error && (
            <div className="banner banner-error" role="alert" style={{ marginTop: 12 }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting || !value}
            className="btn btn-primary"
            style={{ marginTop: 16, width: '100%', justifyContent: 'center' }}
          >
            {submitting ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      </div>
    )
  }

  return <>{children}</>
}
