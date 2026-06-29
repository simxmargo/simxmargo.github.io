// `brand-meta` Edge Function — "Add brand from URL" for the admin Portfolio editor.
//
// The static /admin SPA has no server, and a browser can't fetch an arbitrary
// brand's homepage (cross-origin HTML is blocked by CORS). So this Deno function
// does the server-side fetch: given a brand URL it pulls the page, extracts a
// clean brand NAME + square LOGO (+ a short blurb), and returns them for the
// editor to PREFILL. It writes NOTHING — the browser persists the reviewed brand
// via RLS (is_admin()), exactly like pull-videos.
//
// Invoke (admin "Fetch" button):  POST { "url": "https://brand.com" }
// Returns:  { brand, logoUrl, website, blurb, note? }   (any string field may be '')
//
// Auth: admin-only (requireAdmin → is_admin() gate). SSRF-guarded: refuses URLs
// whose host OR resolved IPs point at our own network (loopback / link-local /
// RFC1918), since this function runs inside Supabase's network.
//
// Deploy:  npm run sb -- functions deploy brand-meta
// Env: LOGO_DEV_TOKEN (optional — a publishable logo.dev token gives the cleanest
//      square logos; without it we fall back to the page's own icons).

import { json, preflight } from '../_shared/http.ts'
import { requireAdmin } from '../_shared/auth.ts'
import {
  GENERIC_SITE_NAMES,
  PLATFORM_DOMAINS,
  SCRAPE_USER_AGENT,
  deriveBrandName,
  extractAppleTouchIcon,
  extractFavicon,
  extractJsonLdLogo,
  extractMetaDescription,
  extractOgImage,
  extractSiteName,
  extractTitle,
  isBlockedHost,
  logoDevUrl,
  toUrl,
} from '../_shared/meta.ts'

const FETCH_TIMEOUT_MS = 8_000
const MAX_CHARS = 600_000 // only the <head> matters; cap so a giant page can't OOM us

// Resolve A + AAAA and block if ANY resolved IP points at our own network — the
// DNS-rebinding defense the hostname check alone can't provide (a public name can
// resolve to 127.0.0.1). Best-effort: if resolution fails, we let the later fetch
// error out naturally rather than hard-blocking a name that only has odd records.
async function resolvesToBlockedIp(host: string): Promise<boolean> {
  for (const kind of ['A', 'AAAA'] as const) {
    try {
      const ips = await Deno.resolveDns(host, kind)
      if (ips.some((ip) => isBlockedHost(ip))) return true
    } catch {
      /* no record of this kind / resolver error — ignore */
    }
  }
  return false
}

// Fetch page HTML as text, capped + timed-out. Returns '' on any failure / non-HTML
// so the caller can degrade to a name + logo.dev logo instead of erroring.
async function fetchHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': SCRAPE_USER_AGENT, accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      await res.body?.cancel()
      return ''
    }
    const ct = res.headers.get('content-type') ?? ''
    if (ct && !/text\/html|text\/plain|application\/xhtml/i.test(ct)) {
      await res.body?.cancel()
      return ''
    }
    const text = await res.text()
    return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text
  } catch {
    return ''
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  // Admin-only: this function runs server-side with network egress — gate it on
  // is_admin() before any external fetch (the anon key alone must not reach it).
  const denied = await requireAdmin(req)
  if (denied) return denied

  let body: { url?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Expected a JSON body { url }.' }, 400)
  }

  const input = typeof body.url === 'string' ? body.url : ''
  const u = toUrl(input)
  if (!u) return json({ error: 'Enter a valid http(s) URL.' }, 400)

  const host = u.hostname.toLowerCase()
  if (isBlockedHost(host) || (await resolvesToBlockedIp(host))) {
    return json({ error: 'That address is not allowed.' }, 400)
  }

  const domain = host.replace(/^www\./, '')
  const token = Deno.env.get('LOGO_DEV_TOKEN') ?? ''
  const isPlatform = PLATFORM_DOMAINS.has(host)
  const html = await fetchHtml(u.toString())

  // Couldn't read the page (blocked, JS-only, timeout). Still hand back a sensible
  // name + (non-platform) logo.dev logo so the admin can finish from the editor.
  if (!html) {
    return json({
      brand: deriveBrandName('', domain),
      logoUrl: isPlatform ? '' : logoDevUrl(domain, token),
      website: u.toString(),
      blurb: '',
      note: 'Could not read that page — filled in what we could.',
    })
  }

  const siteName = extractSiteName(html)
  const isGenericSite = GENERIC_SITE_NAMES.has(siteName.toLowerCase())
  const brand = siteName && !isGenericSite ? siteName : deriveBrandName(extractTitle(html), domain)

  // Logo preference: a clean logo.dev square (by domain) wins when we have a token
  // and it's a real brand domain; otherwise the page's own declared marks, with the
  // social BANNER (og:image) and tiny favicon only as last resorts.
  const logoDev = !isPlatform && token ? logoDevUrl(domain, token) : ''
  const logoUrl =
    logoDev ||
    extractJsonLdLogo(html, u) ||
    extractAppleTouchIcon(html, u) ||
    extractOgImage(html, u) ||
    extractFavicon(html, u)

  const blurb = extractMetaDescription(html).slice(0, 300)

  return json({ brand, logoUrl, website: u.toString(), blurb })
})
