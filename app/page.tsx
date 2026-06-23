import type { Metadata } from 'next'
import { getMediaKit } from '@/lib/mediakit/data'
import { formatCount, totalReach } from '@/lib/mediakit-types'
import { HeroSection } from '@/components/mediakit/HeroSection'
import { SocialStatsStrip } from '@/components/mediakit/SocialStatsStrip'
import { PortfolioGrid } from '@/components/mediakit/PortfolioGrid'
import { AboutSection } from '@/components/mediakit/AboutSection'
import { RateAndContact } from '@/components/mediakit/RateAndContact'
import { DownloadKitButton } from '@/components/mediakit/DownloadKitButton'
import { MediaKitFooter } from '@/components/mediakit/MediaKitFooter'

// ISR: re-fetch the live mediakit data at most once a minute (Supabase queries
// aren't covered by Next's fetch cache, so this is what bounds freshness).
export const revalidate = 60

export async function generateMetadata(): Promise<Metadata> {
  const { profile, socials } = await getMediaKit()
  const reach = formatCount(totalReach(profile, socials))
  const title = profile.seo?.title || `${profile.displayName} — Media Kit`
  const description =
    profile.seo?.description || `${profile.displayName} · ${reach} followers. ${profile.tagline}`.trim()
  return {
    title,
    description,
    alternates: { canonical: '/' },
    openGraph: { title, description, url: '/', type: 'website' },
  }
}

export default async function MediaKitPage() {
  const { profile, socials, brands } = await getMediaKit()

  return (
    <main className="min-h-screen bg-ink-950 text-ivory">
      <HeroSection profile={profile} socials={socials} />
      <SocialStatsStrip socials={socials} />
      <PortfolioGrid brands={brands} />
      <AboutSection profile={profile} />
      <RateAndContact rateCard={profile.rateCard} />
      <div className="flex justify-center px-6 pb-20">
        <DownloadKitButton />
      </div>
      <MediaKitFooter profile={profile} socials={socials} />
    </main>
  )
}
