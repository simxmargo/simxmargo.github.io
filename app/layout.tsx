import type { Metadata } from 'next'
import { Bodoni_Moda, Archivo } from 'next/font/google'
import { getFaviconUrl, getThemeAccent } from '@/lib/mediakit/data'
import { themeFaviconDataUrl } from '@/lib/mediakit/favicon'
import { SITE_URL } from '@/lib/siteUrl'
import './globals.css'

// Self-hosted + preloaded via next/font (replaces the slow CSS @import waterfall
// that caused a flash-of-fallback on first paint). Bodoni Moda keeps its `opsz`
// axis so the big display type renders in the high-contrast optical cut; both
// fonts are exposed as CSS vars consumed by the .mk (public) and .studio (admin)
// scopes in globals.css.
const bodoni = Bodoni_Moda({
  subsets: ['latin'],
  axes: ['opsz'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-bodoni',
})
const archivo = Archivo({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-archivo',
})

// "/" is the PUBLIC media kit, so these are public-facing defaults (indexable).
// metadataBase makes OG/Twitter image URLs resolve to the production origin.
// The private studio (/admin) overrides with noindex in app/admin/layout.tsx.
// generateMetadata (not a static object) so the favicon is the influencer's
// uploaded image from Settings (public_profile.favicon_url), site-wide. Driving
// icons here — with a generated data-URL fallback (themeFaviconDataUrl), not a
// static icon file — means the uploaded favicon actually wins (the app/icon file
// convention would otherwise override the metadata.icons field).
export async function generateMetadata(): Promise<Metadata> {
  // Custom upload wins; otherwise the dynamic theme-tinted brand mark (its accent "x"
  // tracks the selected theme colour).
  const [uploaded, accent] = await Promise.all([getFaviconUrl(), getThemeAccent()])
  const favicon = uploaded || themeFaviconDataUrl(accent)
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: 'simxmargo — Media Kit', template: '%s · simxmargo' },
    description:
      'Fashion & beauty creator · 4.4M followers across TikTok, Instagram & Facebook. Collaborate with simxmargo.',
    icons: { icon: favicon, shortcut: favicon, apple: favicon },
    openGraph: {
      siteName: 'simxmargo',
      type: 'website',
      url: '/',
      title: 'simxmargo — Media Kit',
      description: 'Fashion & beauty creator · 4.4M followers. Collaborate with simxmargo.',
    },
    twitter: { card: 'summary_large_image' },
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bodoni.variable} ${archivo.variable}`}>
      <body>{children}</body>
    </html>
  )
}
