'use client'

import { useAdminResource } from '@/lib/admin/queries'
import { themeFaviconDataUrl } from '@/lib/mediakit/favicon'
import type { PublicProfile } from '@/lib/mediakit-types'

// The studio sidebar's brand lockup: the WEBSITE FAVICON (custom upload from Settings,
// else the theme-tinted brand mark) + the "simxmargo STUDIO" wordmark. Reads the same
// cached `profile` (theme accent) + `settings` (uploaded favicon) queries the editors
// use, so changing the favicon in Settings or the accent in Theme updates this mark
// reactively — TanStack invalidation re-renders it. Lives BELOW AdminQueryProvider
// (AdminShell renders the provider), so it can safely call useAdminResource.
export function SidebarBrand() {
  const profileQ = useAdminResource<Partial<PublicProfile>>('profile')
  const settingsQ = useAdminResource<{ faviconUrl?: string }>('settings')

  const accent = profileQ.data?.theme?.accent ?? ''
  const uploaded = settingsQ.data?.faviconUrl ?? ''
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
