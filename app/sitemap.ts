import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/siteUrl'

// Emit a flat sitemap.xml at build time — required for `output: 'export'`
// (lastModified/SITE_URL would otherwise mark this route dynamic).
export const dynamic = 'force-static'

// /sitemap.xml — the public media kit is a single-page site, so one entry. The
// private /admin surface is intentionally excluded (also blocked in robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ]
}
