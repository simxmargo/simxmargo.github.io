'use client'

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { adminFetch } from '@/lib/adminClient'

// Centralized admin read-cache. One query key + endpoint per resource so that a
// mutation's invalidation always targets the same cache entry the reader uses.
//
// NOTE: `profile` is shared by BOTH ProfileEditor and ThemeEditor — they read and
// write the same /api/admin/profile row, so they must use this one key. Saving in
// either invalidates the other automatically.
const ENDPOINTS = {
  profile: '/api/admin/profile',
  brands: '/api/admin/brands',
  socials: '/api/admin/socials',
  inquiries: '/api/admin/inquiries',
  settings: '/api/admin/settings',
} as const

export type AdminResource = keyof typeof ENDPOINTS

export const adminKeys = {
  profile: ['admin', 'profile'] as const,
  brands: ['admin', 'brands'] as const,
  socials: ['admin', 'socials'] as const,
  inquiries: ['admin', 'inquiries'] as const,
  settings: ['admin', 'settings'] as const,
}

// Status-bearing error so callers can branch on `err.status` (e.g. 503 = the
// server's SERVICE_ROLE key is missing) instead of string-matching messages.
export class AdminFetchError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AdminFetchError'
    this.status = status
  }
}

// GET helper that throws AdminFetchError on a non-2xx so React Query routes it to
// `isError` / `error`. Tries to surface the server's { error } message.
export async function adminGet<T>(path: string): Promise<T> {
  const res = await adminFetch(path)
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new AdminFetchError(res.status, msg)
  }
  return (await res.json()) as T
}

// The one hook every admin editor uses for its initial load. Cached across tab
// switches by the AdminQueryProvider; `isLoading` is true only on the very first
// load (a cached revisit renders immediately, so the skeleton never re-flashes).
export function useAdminResource<T>(name: AdminResource): UseQueryResult<T, AdminFetchError> {
  return useQuery<T, AdminFetchError>({
    queryKey: adminKeys[name],
    queryFn: () => adminGet<T>(ENDPOINTS[name]),
  })
}
