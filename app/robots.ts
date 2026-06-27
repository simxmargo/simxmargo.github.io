import type { MetadataRoute } from 'next'
import { SITE_URL, SITE_HOST } from '@/lib/siteUrl'

// Emit a flat robots.txt at build time — required for `output: 'export'` (this
// metadata route reads SITE_URL, so Next would otherwise treat it as dynamic).
export const dynamic = 'force-static'

// /robots.txt — allow crawling the public media kit, but keep the private studio
// and API surface out of the index. Points crawlers at the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/api/'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
    // The robots Host directive wants a bare hostname (no scheme).
    host: SITE_HOST,
  }
}
