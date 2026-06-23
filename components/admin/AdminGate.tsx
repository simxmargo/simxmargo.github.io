'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { getAdminSecret, setAdminSecret } from '@/lib/adminClient'

// Lightweight passphrase gate (NOT a login system). Verifies a single shared
// secret server-side via GET /api/admin/verify, then keeps it in sessionStorage.
// This is UX/convenience; the real protection is the server-side header check on
// every /api/admin/* route. Light "studio" theme to match the outreach UI.
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
    return <div className="flex h-screen items-center justify-center text-sm text-stone-400">Loading…</div>
  }

  if (state === 'locked') {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-100 px-6">
        <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
          <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-plum-50 text-plum-600">
            <Lock size={18} aria-hidden="true" />
          </span>
          <h1 className="font-display text-xl font-semibold text-stone-900">Studio access</h1>
          <p className="mt-1 text-sm text-stone-500">Enter the admin passphrase to manage the media kit and outreach.</p>
          <label htmlFor="admin-pass" className="sr-only">Admin passphrase</label>
          <input
            id="admin-pass"
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Passphrase"
            className="mt-5 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-plum-500 focus:outline-none focus:ring-1 focus:ring-plum-500"
          />
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || !value}
            className="mt-4 w-full rounded-lg bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50"
          >
            {submitting ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      </div>
    )
  }

  return <>{children}</>
}
