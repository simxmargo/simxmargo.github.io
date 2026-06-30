import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
import { getMediaKit } from '@/lib/mediakit/data'
import { SITE_URL } from '@/lib/siteUrl'
import { formatCount, totalReach } from '@/lib/mediakit-types'
import { MediaKitLive } from '@/components/mediakit/MediaKitLive'

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
      // Static export carves out app/opengraph-image.tsx, so the page declares the OG
      // card here. It points at a STABLE Supabase Storage URL (media/og/card.png) that
      // the admin re-renders + overwrites on save (lib/og/shareCard.ts) — so the share
      // card can change WITHOUT a redeploy. The URL is deliberately version-free (a
      // ?v=<sha> would re-tie it to the deploy); freshness comes from the object's own
      // short cache-control. Locally the dynamic route injects the tag, so we only emit
      // this in the static export to avoid a duplicate.
      ...(process.env.EXPORT_STATIC === '1' && process.env.NEXT_PUBLIC_SUPABASE_URL
        ? { images: [`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/og/card.png`] }
        : {}),
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
  // live there in globals.css). The `.mk` wrapper, theme CSS vars, and JSON-LD are
  // server-rendered from the build-time snapshot (SEO + identical first paint);
  // MediaKitLive renders the visual tree and refreshes it to live data client-side.
  return (
    <div className="mk" style={mkStyle}>
      <script
        type="application/ld+json"
        // Escape `<` so any `</script>` inside DB-authored text can't break out.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <MediaKitLive initial={{ profile, socials, brands }} />
    </div>
  )
}
