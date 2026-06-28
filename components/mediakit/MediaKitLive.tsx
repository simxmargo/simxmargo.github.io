'use client'

// Client wrapper that renders the public media kit's visual tree and silently
// upgrades it from the build-time SSR snapshot to LIVE Supabase data on mount.
//
// First paint === `initial` (the static export snapshot baked at build time), so
// crawlers and the initial HTML are unchanged. After hydration we fetch the live
// published/visible rows via the session-less anon client (lib/mediakit/clientData)
// and swap them in only if the read succeeds — so admin edits appear on the next
// page load without a rebuild, and a failed/empty read leaves the snapshot intact.
import { useEffect, useState } from 'react'
import type { MediaKitData } from '@/lib/mediakit-types'
import { getMediaKitClient } from '@/lib/mediakit/clientData'
import { RevealRoot } from '@/components/mediakit/RevealRoot'
import { TopNav } from '@/components/mediakit/TopNav'
import { HeroSection } from '@/components/mediakit/HeroSection'
import { SocialStatsStrip } from '@/components/mediakit/SocialStatsStrip'
import { PortfolioGrid } from '@/components/mediakit/PortfolioGrid'
import { RateAndContact } from '@/components/mediakit/RateAndContact'
import { MediaKitFooter } from '@/components/mediakit/MediaKitFooter'

export function MediaKitLive({ initial }: { initial: MediaKitData }) {
  const [data, setData] = useState<MediaKitData>(initial)

  useEffect(() => {
    let cancelled = false
    getMediaKitClient().then((fresh) => {
      if (!cancelled && fresh) setData(fresh)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const { profile, socials, brands } = data

  return (
    <>
      <RevealRoot />
      <TopNav name={profile.displayName} />
      <HeroSection profile={profile} socials={socials} />
      <SocialStatsStrip socials={socials} />
      <PortfolioGrid brands={brands} socials={socials} />
      <RateAndContact profile={profile} />
      <MediaKitFooter profile={profile} socials={socials} />
    </>
  )
}
