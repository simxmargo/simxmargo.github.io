'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

// One QueryClient for the whole admin SPA. It lives ABOVE the panel components
// (which mount/unmount on every tab switch), so the cache survives navigation —
// switching tabs reads cached data instantly instead of refetching.
//
// staleTime 5min: a tab revisited within 5 minutes serves from cache with no
// network call. Mutations (Save / toggle / reorder) explicitly invalidate their
// resource key, so edits still propagate immediately. refetchOnWindowFocus is off
// because the admin is the sole writer — there's no out-of-band change to chase.
export function AdminQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            gcTime: 30 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
