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
import { DEFAULT_SITE_COPY } from '@/lib/mediakit-types'
import { getMediaKitClient } from '@/lib/mediakit/clientData'
import { loadSnapManifest, localizeAssets } from '@/lib/mediakit/localizedAssets'
import { applyFavicon } from '@/lib/applyFavicon'
import { themeFaviconDataUrl } from '@/lib/mediakit/favicon'
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
    const run = () => {
      Promise.all([getMediaKitClient(), loadSnapManifest()]).then(([fresh, manifest]) => {
        if (cancelled || !fresh) return
        // Live rows carry the ORIGINAL remote image URLs; map them back to the
        // local /snap/ copies the build downloaded. Without this the live upgrade
        // re-fetches every image from Supabase/third-party CDNs and throws away
        // the whole point of scripts/localize-export.mjs.
        const live = localizeAssets(fresh, manifest)
        setData(live)
        // The baked <head> favicon is whatever existed at BUILD time — let the live
        // value win (uploaded icon, else the current theme mark). A failed read
        // never reaches here, so the baked icon stays as the offline fallback.
        applyFavicon(
          live.profile.faviconUrl || themeFaviconDataUrl(live.profile.theme?.accent ?? ''),
        )
      })
    }
    // Defer the live upgrade OUT of the critical load path. The baked snapshot is
    // already current (rebuilt every deploy) and uses fast localized /snap/ images,
    // so there is nothing to gain from upgrading early — and plenty to lose.
    const ric = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    let idleId = 0
    let timeoutId = 0
    const schedule = () => {
      if (cancelled) return
      if (typeof ric.requestIdleCallback === 'function') idleId = ric.requestIdleCallback(run, { timeout: 3000 })
      else timeoutId = window.setTimeout(run, 1500)
    }

    // Gate on `load` — every baked image has finished — BEFORE re-rendering with
    // live data. requestIdleCallback on its own fired at its 3s timeout, which on
    // a cellular link lands while images are still downloading; changing the `src`
    // of an in-flight <img> makes the browser ABORT the partial download and start
    // over. Measured on Slow 4G / iPhone 13: the hero portrait took 22.9s and the
    // page load 24.2s, against 6.2s / 7.8s with the swap suppressed. The manifest
    // rewrite in `run` usually makes the new src identical (so React writes
    // nothing), and this gate covers the images that have no local twin.
    if (document.readyState === 'complete') schedule()
    else window.addEventListener('load', schedule, { once: true })

    return () => {
      cancelled = true
      window.removeEventListener('load', schedule)
      if (idleId && typeof ric.cancelIdleCallback === 'function') ric.cancelIdleCallback(idleId)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  const { profile, socials, brands } = data
  // PortfolioGrid doesn't take the whole profile, so resolve its editable copy here.
  const c = profile.content ?? {}
  const partnersEyebrow = c.partnersEyebrow?.trim() || DEFAULT_SITE_COPY.partnersEyebrow
  const partnersTitle = c.partnersTitle?.trim() || DEFAULT_SITE_COPY.partnersTitle

  return (
    <>
      <RevealRoot />
      <TopNav name={profile.displayName} showRates={profile.showRatesSection !== false} />
      <HeroSection profile={profile} socials={socials} />
      <SocialStatsStrip socials={socials} />
      <PortfolioGrid brands={brands} socials={socials} partnersEyebrow={partnersEyebrow} partnersTitle={partnersTitle} />
      <RateAndContact profile={profile} />
      <MediaKitFooter profile={profile} socials={socials} />
    </>
  )
}
