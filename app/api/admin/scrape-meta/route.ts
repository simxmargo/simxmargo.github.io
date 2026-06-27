import { lookup } from 'node:dns/promises'
import { requireAdmin } from '@/lib/requireAdmin'
import {
  SCRAPE_USER_AGENT,
  GENERIC_SITE_NAMES,
  PLATFORM_DOMAINS,
  toUrl,
  isBlockedHost,
  normalizeDomain,
  logoDevUrl,
  extractOgImage,
  extractFavicon,
  extractAppleTouchIcon,
  extractJsonLdLogo,
  extractMetaDescription,
  extractTitle,
  extractSiteName,
  deriveBrandName,
} from '@/lib/scrape/meta'

// Admin-only "Add brand from URL" (Phase 6). Fetches a brand's homepage and
// derives a DRAFT portfolio_brands row from its OpenGraph/meta tags. It returns
// the draft ONLY — it never writes the DB; the admin reviews + saves it via
// POST /api/admin/brands (the existing service-role write path).
//
// requireAdmin is the same x-admin-secret boundary as every /api/admin/* route.
// Because this makes an OUTBOUND fetch to an arbitrary URL it's an SSRF surface,
// so on TOP of the passphrase gate we (a) block private/loopback/metadata hosts,
// (b) DNS-resolve the host and re-check every resolved IP (catches a public-looking
// domain that points at a private address), (c) restrict ports to 80/443, and
// (d) follow redirects MANUALLY, re-validating each hop (redirect:'follow' would
// silently re-target an internal host). A residual DNS-rebinding TOCTOU gap
// remains between resolve and connect — full closure needs egress firewalling at
// the deploy; documented here rather than papered over.
//
// docs/MEDIAKIT_PLAN.md sketched this as a Supabase Edge Function reusing the Deno
// _shared/scrape.ts; we implement it as a Next Route Handler so it's consistent
// with the other admin writes, type-checked, and deploy-free in dev. The pure
// extractors + host guard live in lib/scrape/meta.ts.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_HOPS = 3
const MAX_BYTES = 1_000_000 // parse window for <head> meta
const MAX_CONTENT_LENGTH = 5_000_000 // reject obviously-huge declared bodies

// Returns an error message if the URL must not be fetched, else null.
async function assertFetchable(u: URL): Promise<string | null> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http(s) URLs are allowed.'
  if (u.port && u.port !== '80' && u.port !== '443') return 'That port is not allowed.'
  if (isBlockedHost(u.hostname)) return 'That host is not allowed.'
  // Resolve and re-check EVERY address (a public-looking domain may point inward).
  let addrs: { address: string }[]
  try {
    addrs = await lookup(u.hostname, { all: true })
  } catch {
    return 'Could not resolve that host.'
  }
  if (addrs.length === 0) return 'Could not resolve that host.'
  if (addrs.some((a) => isBlockedHost(a.address))) {
    return 'That host resolves to a non-public address.'
  }
  return null
}

// Read the response body with a hard byte cap so a giant/hostile page can't
// exhaust memory (res.text() would buffer the WHOLE body first). Decodes
// incrementally and cancels the stream once the cap is reached.
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, MAX_BYTES)
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let out = ''
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        out += decoder.decode(value, { stream: true })
        if (total >= MAX_BYTES) {
          await reader.cancel().catch(() => {})
          break
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
  out += decoder.decode()
  return out.slice(0, MAX_BYTES)
}

export async function POST(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const rawUrl = (body as { url?: unknown })?.url
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return Response.json({ error: 'url is required' }, { status: 400 })
  }
  const target = toUrl(rawUrl)
  if (!target) {
    return Response.json({ error: 'Could not parse that URL.' }, { status: 400 })
  }

  // Fetch the homepage like a browser, but follow redirects MANUALLY so each hop
  // is SSRF-validated before we connect. On any failure we 4xx/5xx with a message
  // that nudges the admin to enter details manually (the feature degrades, never
  // blocks, and never reveals internal response bodies).
  let html: string
  let finalBase: URL
  try {
    let current = target
    let res: Response | null = null
    for (let hop = 0; ; hop++) {
      if (hop > MAX_HOPS) {
        return Response.json({ error: 'Too many redirects.' }, { status: 502 })
      }
      const blocked = await assertFetchable(current)
      if (blocked) return Response.json({ error: blocked }, { status: 400 })

      res = await fetch(current.toString(), {
        headers: { 'user-agent': SCRAPE_USER_AGENT, accept: 'text/html,application/xhtml+xml' },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      })

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) break // 3xx without a Location → treat as terminal
        let next: URL
        try {
          next = new URL(loc, current)
        } catch {
          return Response.json({ error: 'Bad redirect target.' }, { status: 502 })
        }
        current = next
        continue
      }
      break
    }

    finalBase = current
    if (!res || !res.ok) {
      return Response.json(
        { error: `The site returned ${res?.status ?? 'no response'}. Enter the brand details manually.` },
        { status: 502 },
      )
    }
    const ct = res.headers.get('content-type') ?? ''
    if (!/text\/html|application\/xhtml/i.test(ct)) {
      return Response.json(
        { error: `That URL isn't an HTML page (${ct || 'unknown type'}). Enter details manually.` },
        { status: 415 },
      )
    }
    const declared = Number(res.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > MAX_CONTENT_LENGTH) {
      return Response.json({ error: 'That page is too large to read.' }, { status: 413 })
    }
    html = await readCapped(res)
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    return Response.json(
      {
        error: `${timedOut ? 'The site took too long to respond.' : 'Could not reach that URL.'} Enter the brand details manually.`,
      },
      { status: 504 },
    )
  }

  // Resolve relative og:image/favicon against the FINAL (post-redirect) URL.
  const domain = normalizeDomain(finalBase.toString())
  const title = extractTitle(html)

  // Brand name: prefer og:site_name, BUT ignore generic platform names
  // ("App Store", "Google Play") — fall back to the page title in that case.
  const siteName = extractSiteName(html)
  const cleanSiteName = siteName && !GENERIC_SITE_NAMES.has(siteName.toLowerCase()) ? siteName : ''
  const brand = cleanSiteName || deriveBrandName(title, domain)

  // Logo priority. The bug we're fixing: og:image is usually a social/HERO BANNER
  // (e.g. Flighthouse's full-bleed homepage shot), NOT a logo — so it must NOT win.
  // Prefer a real square mark: logo.dev (by domain) → apple-touch-icon → schema.org
  // logo, and only fall back to og:image/favicon if none exist. App-store/platform
  // pages are the exception (there the og:image IS the app icon), so og:image leads.
  const logoDevToken = process.env.LOGO_DEV_TOKEN ?? ''
  const isPlatform = PLATFORM_DOMAINS.has(domain)
  const appleIcon = extractAppleTouchIcon(html, finalBase)
  const jsonLdLogo = extractJsonLdLogo(html, finalBase)
  const ogImage = extractOgImage(html, finalBase)
  const favicon = extractFavicon(html, finalBase)
  const logoUrl =
    (isPlatform
      ? [ogImage, appleIcon, jsonLdLogo, favicon]
      : [logoDevUrl(domain, logoDevToken), appleIcon, jsonLdLogo, ogImage, favicon]
    ).find(Boolean) ?? ''

  const blurb = extractMetaDescription(html)

  // Draft only — camelCase, matching the BrandEditor form. `campaignTitle` is left
  // blank for the admin to fill (a homepage title rarely names a campaign).
  return Response.json({
    brand,
    website: domain ? `https://${domain}` : rawUrl.trim(),
    logoUrl,
    blurb,
    campaignTitle: '',
  })
}
