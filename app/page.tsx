import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
import { getMediaKit } from '@/lib/mediakit/data'
import { SITE_URL } from '@/lib/siteUrl'
import { formatCount, totalReach } from '@/lib/mediakit-types'
import { RevealRoot } from '@/components/mediakit/RevealRoot'
import { TopNav } from '@/components/mediakit/TopNav'
import { HeroSection } from '@/components/mediakit/HeroSection'
import { SocialStatsStrip } from '@/components/mediakit/SocialStatsStrip'
import { PortfolioGrid } from '@/components/mediakit/PortfolioGrid'
import { RateAndContact } from '@/components/mediakit/RateAndContact'
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
    openGraph: {
      title,
      description,
      url: '/',
      type: 'website',
      // Static export carves out app/opengraph-image.tsx, so the page declares the
      // OG card itself (public/og.png). Locally that route auto-injects it — gating
      // on EXPORT_STATIC prevents emitting duplicate og:image tags.
      ...(process.env.EXPORT_STATIC === '1' ? { images: ['/og.png'] } : {}),
    },
  }
}

export default async function MediaKitPage() {
  const { profile, socials, brands } = await getMediaKit()

  // schema.org Person/structured data, server-rendered so crawlers + rich results
  // see real follower counts and social profiles in the initial HTML.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: profile.displayName,
    description: profile.tagline || profile.seo?.description || undefined,
    jobTitle: profile.niche || undefined,
    image: profile.avatarUrl || undefined,
    ...(profile.location ? { homeLocation: { '@type': 'Place', name: profile.location } } : {}),
    url: SITE_URL,
    sameAs: socials.map((s) => s.profileUrl).filter(Boolean),
    interactionStatistic: socials
      .filter((s) => s.followers > 0)
      .map((s) => ({
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/FollowAction',
        userInteractionCount: s.followers,
        name: s.platform,
      })),
  }

  // Theme from the admin Theme editor, applied as CSS vars on the .mk root SERVER-SIDE
  // (no flash-of-default). Empty/unset falls back to the design defaults in globals.css.
  const theme = profile.theme ?? {}
  const mkStyle = {
    ...(theme.accent ? { '--accent': theme.accent } : {}),
    ...(theme.tileTheme === 'dark' ? { '--tile': '#1c1a14', '--tileink': '#f3eee4' } : {}),
  } as CSSProperties

  // The whole public page is scoped under `.mk` (the design's theme + stylesheet
  // live there in globals.css). RevealRoot drives the scroll-reveal choreography.
  return (
    <div className="mk" style={mkStyle}>
      <script
        type="application/ld+json"
        // Escape `<` so any `</script>` inside DB-authored text can't break out.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <RevealRoot />
      <TopNav name={profile.displayName} />
      <HeroSection profile={profile} socials={socials} />
      <SocialStatsStrip socials={socials} />
      <PortfolioGrid brands={brands} />
      <RateAndContact profile={profile} />
      <MediaKitFooter profile={profile} socials={socials} />

      {/* TEMP — hardcoded admin link for easy testing; remove before launch. */}
      <a
        href="/admin"
        style={{
          position: 'fixed', bottom: 16, right: 16, zIndex: 100,
          background: 'var(--accent)', color: '#14110d', padding: '8px 14px',
          borderRadius: 4, fontSize: 13, fontWeight: 600, textDecoration: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,.35)',
        }}
      >
        Admin →
      </a>
    </div>
  )
}
