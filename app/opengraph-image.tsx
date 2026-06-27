import { ImageResponse } from 'next/og'
import { getMediaKit } from '@/lib/mediakit/data'
import { formatCount, totalReach } from '@/lib/mediakit-types'

// Data-driven OpenGraph/Twitter share card (Phase 7). Next AUTO-INJECTS the
// og:image / twitter:image meta tags from this file — so app/page.tsx's
// generateMetadata deliberately does NOT set openGraph.images (that would emit
// duplicate tags). nodejs runtime so it can reuse the Supabase data layer.
//
// FRESHNESS: opengraph-image is its own route segment and does NOT inherit the
// page's revalidate. Without this, the card would freeze at the build-time read;
// revalidate regenerates it on the ISR clock so it tracks profile/follower edits.
//
// FONT: rendered in next/og's bundled default face. Satori (next/og) only handles
// STATIC font files — a variable-weight TTF makes it throw mid-stream ("reading
// '256'"), which can't be caught. To get the editorial Playfair serif on the card,
// commit a STATIC PlayfairDisplay-Bold.ttf under assets/ and load it via
// fs.readFile into the `fonts` option (a fetched variable font will NOT work).
export const runtime = 'nodejs'
export const revalidate = 3600
export const alt = 'simxmargo — Media Kit'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  const { profile, socials } = await getMediaKit()
  const reach = formatCount(totalReach(profile, socials))
  const name = profile.displayName || 'simxmargo'
  const tagline = profile.tagline || ''
  const niche = profile.niche || ''

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#0b0b0d',
          color: '#f5f1ea',
          padding: 72,
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 26,
            letterSpacing: 10,
            textTransform: 'uppercase',
            color: '#c9a6a0',
          }}
        >
          Media Kit
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 104, lineHeight: 1.04, fontWeight: 700 }}>{name}</div>
          {tagline ? (
            <div
              style={{
                display: 'flex',
                fontSize: 34,
                marginTop: 20,
                maxWidth: 940,
                color: 'rgba(245,241,234,0.8)',
              }}
            >
              {tagline}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 34 }}>
          <div style={{ display: 'flex', color: '#c9a6a0', fontWeight: 700 }}>{reach} followers</div>
          {niche ? <div style={{ display: 'flex', color: 'rgba(245,241,234,0.6)' }}>· {niche}</div> : null}
        </div>
      </div>
    ),
    size,
  )
}
