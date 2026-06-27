// Single source of truth for the public origin (canonical URLs, sitemap, robots,
// OG/metadataBase). Defaults to the GitHub Pages org site; override with
// NEXT_PUBLIC_SITE_URL to point at a custom domain later — ONE env var, no code
// edits. Trailing slash stripped so `${SITE_URL}/path` never doubles up.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://simxmargo.github.io').replace(/\/+$/, '')

// Bare hostname (no scheme) — robots.txt's `host` directive wants this form.
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, '')
