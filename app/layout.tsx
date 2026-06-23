import type { Metadata } from 'next'
import './globals.css'

// "/" is the PUBLIC media kit, so these are public-facing defaults (indexable).
// metadataBase makes OG/Twitter image URLs resolve to the production origin.
// The private studio (/admin) overrides with noindex in app/admin/layout.tsx.
export const metadata: Metadata = {
  metadataBase: new URL('https://simxmargo.com'),
  title: { default: 'sim x margo — Media Kit', template: '%s · sim x margo' },
  description:
    'Fashion & beauty creator · 4.4M followers across TikTok, Instagram & Facebook. Collaborate with sim x margo.',
  openGraph: {
    siteName: 'sim x margo',
    type: 'website',
    url: '/',
    title: 'sim x margo — Media Kit',
    description: 'Fashion & beauty creator · 4.4M followers. Collaborate with sim x margo.',
  },
  twitter: { card: 'summary_large_image' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
