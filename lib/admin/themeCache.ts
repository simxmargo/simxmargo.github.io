import type { CSSProperties } from 'react'

// Caches the saved studio accent in localStorage so the admin chrome + login portal
// paint in the RIGHT theme colour on first render — instead of flashing the studio's
// default accent while the profile query (or the pre-auth login, which has no data at
// all) loads. Safe to read during render in the admin's client-only components (they
// render behind the session gate, never in the static export's server HTML, so there's
// no hydration mismatch). The live value still wins the moment the query resolves.

const ACCENT_RE = /^#[0-9a-f]{3,8}$/i
const KEY = 'sxm-admin-accent'

// Last-saved accent from localStorage, or null when unset/invalid/unavailable.
export function readCachedAccent(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(KEY)
    return v && ACCENT_RE.test(v.trim()) ? v.trim() : null
  } catch {
    return null
  }
}

// Persist a freshly-loaded accent so the NEXT load paints it immediately. No-ops on a
// missing/invalid value (keeps the previous good cache) or storage errors.
export function writeCachedAccent(accent: string | null | undefined): void {
  if (typeof window === 'undefined') return
  try {
    if (typeof accent === 'string' && ACCENT_RE.test(accent.trim())) {
      window.localStorage.setItem(KEY, accent.trim())
    }
  } catch {
    /* private mode / quota — the live data path still applies the accent */
  }
}

// Inline style overriding the studio's --accent token, or undefined to keep the default.
export function accentStyle(accent: string | null | undefined): CSSProperties | undefined {
  return typeof accent === 'string' && ACCENT_RE.test(accent.trim())
    ? ({ ['--accent']: accent.trim() } as CSSProperties)
    : undefined
}
