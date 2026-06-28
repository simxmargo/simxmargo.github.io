import type { Metadata } from 'next'
import { Archivo } from 'next/font/google'
import localFont from 'next/font/local'
import { getFaviconUrl, getThemeAccent } from '@/lib/mediakit/data'
import { themeFaviconDataUrl } from '@/lib/mediakit/favicon'
import { SITE_URL } from '@/lib/siteUrl'
import './globals.css'

// Druk Wide Bold (self-hosted .ttf) is the DISPLAY face — wide, heavy, editorial —
// used for headers / wordmark / big numbers across .mk (public) + .studio (admin).
// Archivo (sans) stays the body + UI face. Both are exposed as CSS vars consumed in
// globals.css. next/font self-hosts + preloads (no @import flash-of-fallback).
// NOTE: Druk Wide is a commercial face (Commercial Type); the bundled .ttf must be
// properly licensed for web use before this ships publicly.
const druk = localFont({
  src: '../assets/og/DrukWideBold.ttf',
  weight: '700',
  style: 'normal',
  display: 'swap',
  variable: '--font-druk',
  fallback: ['Archivo Black', 'system-ui', 'sans-serif'],
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
    // No hardcoded follower count here — the live count lives on the OG image (which
    // regenerates each deploy) and in app/page.tsx's computed description for "/".
    description:
      'Fashion & beauty creator across TikTok, Instagram & Facebook. Collaborate with simxmargo.',
    icons: { icon: favicon, shortcut: favicon, apple: favicon },
    openGraph: {
      siteName: 'simxmargo',
      type: 'website',
      url: '/',
      title: 'simxmargo — Media Kit',
      description: 'Fashion & beauty creator across TikTok, Instagram & Facebook. Collaborate with simxmargo.',
    },
    twitter: { card: 'summary_large_image' },
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${druk.variable} ${archivo.variable}`}>
      <body>{children}</body>
    </html>
  )
}
