'use client'

import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/browser'

// The single admin account's email is NOT a secret — it identifies the one login, and
// the influencer only ever types the password. Configurable via env so it isn't
// hard-baked; falls back to the known collab address.
export const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'simxmargo.collab@gmail.com'

export async function signInAdmin(password: string): Promise<{ error: string | null }> {
  if (!supabaseBrowser) return { error: 'Studio is not configured.' }
  const { error } = await supabaseBrowser.auth.signInWithPassword({ email: ADMIN_EMAIL, password })
  return { error: error ? error.message : null }
}

export async function signOutAdmin(): Promise<void> {
  await supabaseBrowser?.auth.signOut()
}

// Session state for gating the studio:
//   null    → still checking (initial)
//   false   → signed out
//   Session → signed in
export function useAdminSession(): Session | null | false {
  const [session, setSession] = useState<Session | null | false>(null)

  useEffect(() => {
    if (!supabaseBrowser) {
      setSession(false)
      return
    }
    let active = true
    supabaseBrowser.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session ?? false)
    })
    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? false)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return session
}
