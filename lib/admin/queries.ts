'use client'

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { readProfile } from './resources/profile'
import { readBrands } from './resources/brands'
import { readSocials } from './resources/socials'
import { readInquiries } from './resources/inquiries'
import { readSettings } from './resources/settings'

// Centralized admin read-cache. Each resource now reads DIRECTLY from Supabase
// (authenticated admin session + RLS is_admin()), replacing the old /api/admin/*
// route fetches. One query key per resource so a mutation's invalidation always
// targets the same cache entry the reader uses.
//
// NOTE: `profile` is shared by BOTH ProfileEditor and ThemeEditor — they read/write
// the same public_profile row, so they share this one key; saving in either
// invalidates the other automatically.
export const adminKeys = {
  profile: ['admin', 'profile'] as const,
  brands: ['admin', 'brands'] as const,
  socials: ['admin', 'socials'] as const,
  inquiries: ['admin', 'inquiries'] as const,
  settings: ['admin', 'settings'] as const,
}

const READERS = {
  profile: readProfile,
  brands: readBrands,
  socials: readSocials,
  inquiries: readInquiries,
  settings: readSettings,
} as const

export type AdminResource = keyof typeof READERS

// Status-bearing error kept for editor compatibility. Direct Supabase reads throw
// plain Errors now (there is no HTTP status), so `status` is always 0 — the editors'
// graceful "unconfigured/error" branches key off the message, not the status.
export class AdminFetchError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AdminFetchError'
    this.status = status
  }
}

// The one hook every admin editor uses for its initial load. Cached across tab
// switches by AdminQueryProvider; `isLoading` is true only on the first load.
export function useAdminResource<T>(name: AdminResource): UseQueryResult<T, AdminFetchError> {
  return useQuery<T, AdminFetchError>({
    queryKey: adminKeys[name],
    queryFn: async () => {
      try {
        return (await READERS[name]()) as T
      } catch (e) {
        throw new AdminFetchError(0, e instanceof Error ? e.message : String(e))
      }
    },
  })
}
