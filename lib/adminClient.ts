'use client'

// Client-side admin auth helper. The passphrase lives in sessionStorage (cleared
// when the tab closes) and rides on every admin request as the x-admin-secret
// header — never a query string. The server (lib/requireAdmin) is the real gate.
const KEY = 'simxmargo-admin-secret'

export function getAdminSecret(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(KEY)
}

export function setAdminSecret(secret: string): void {
  sessionStorage.setItem(KEY, secret)
}

export function clearAdminSecret(): void {
  sessionStorage.removeItem(KEY)
}

// fetch wrapper that attaches the admin header. Use for all /api/admin/* calls.
export async function adminFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(opts.headers ?? {}),
      'x-admin-secret': getAdminSecret() ?? '',
    },
  })
}

// Multipart upload variant — attaches the admin header but deliberately does NOT
// set content-type, so the browser supplies `multipart/form-data; boundary=…`.
// Setting it here (as adminFetch does) would corrupt the body parse on the server.
export async function adminUpload(path: string, form: FormData): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    body: form,
    headers: { 'x-admin-secret': getAdminSecret() ?? '' },
  })
}
