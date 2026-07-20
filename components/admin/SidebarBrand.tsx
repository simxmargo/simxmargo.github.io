'use client'

import { useAdminResource } from '@/lib/admin/queries'
import { themeFaviconDataUrl } from '@/lib/mediakit/favicon'
import type { PublicProfile } from '@/lib/mediakit-types'

// The studio sidebar's brand lockup: the WEBSITE FAVICON (custom upload from the Theme
// tab, else the theme-tinted brand mark) + the "simxmargo STUDIO" wordmark. Both the
// uploaded favicon (favicon_url) and the accent live on the `public_profile` row, so
// this reads them from the single cached `profile` query the editors use — changing the
// favicon or accent in Theme re-renders this mark reactively (TanStack invalidation).
// Lives BELOW AdminQueryProvider (AdminShell renders the provider), so it can safely
// call useAdminResource.
export function SidebarBrand() {
  const profileQ = useAdminResource<Partial<PublicProfile>>('profile')

  const accent = profileQ.data?.theme?.accent ?? ''
  const uploaded = profileQ.data?.faviconUrl ?? ''
  const favicon = uploaded || themeFaviconDataUrl(accent)

  return (
    <div className="brand">
      <span className="brand-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={favicon} alt="" />
      </span>
      <div>
        <div className="brand-name display">
          simxmargo
        </div>
        <div className="brand-sub">STUDIO</div>
      </div>
    </div>
  )
}
