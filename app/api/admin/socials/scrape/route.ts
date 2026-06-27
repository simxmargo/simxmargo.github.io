import { lookup } from 'node:dns/promises'
import { requireAdmin } from '@/lib/requireAdmin'
import { getAdminReadClient } from '@/lib/supabase/admin'
import { isBlockedHost } from '@/lib/scrape/meta'
import {
  extractFollowerCount,
  isAllowedProfileHost,
  userAgentFor,
  BROWSER_UA,
  CRAWLER_UA,
  IG_WEB_APP_ID,
  instagramWebProfileUrl,
  handleFromProfileUrl,
  type ScrapeResult,
} from '@/lib/social/scrape'

// Best-effort follower pre-fill from a public profile — no API keys (except the
// OPTIONAL Facebook Graph token). Resolves the platform's profile_url + handle from
// social_stats, fetches it with a PLATFORM-SPECIFIC strategy, and parses the count.
// Does NOT write the DB — it returns the number for the influencer to confirm + Save
// via the normal social_stats PUT (the manual value stays the source of truth).
//   • TikTok    → fetch page as a browser, read rehydration JSON.            (works)
//   • Instagram → JSON web-profile API (exact, best-effort) → crawler-UA og. (works)
//   • Facebook  → Graph API if FACEBOOK_GRAPH_TOKEN set, else honest manual. (token)
// Hosts are whitelisted to the 3 platforms (+ graph.facebook.com), re-checked on
// every redirect hop, so this is not an open SSRF surface.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 1_500_000
const MAX_HOPS = 3
const TIMEOUT_MS = 9000

// A URL is fetchable only if it's http(s), on the platform allowlist, AND doesn't
// resolve to a private/loopback/metadata address. Re-run on EVERY redirect hop so a
// whitelisted profile link can't 3xx-redirect us into the internal network (SSRF).
async function assertFetchable(u: URL): Promise<string | null> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Profile URL must be http(s).'
  if (!isAllowedProfileHost(u.hostname)) return 'Profile URL must be a tiktok.com / instagram.com / facebook.com link.'
  if (isBlockedHost(u.hostname)) return 'That profile host is not allowed.'
  let addrs: { address: string }[]
  try {
    addrs = await lookup(u.hostname, { all: true })
  } catch {
    return 'Could not resolve the profile host.'
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedHost(a.address))) {
    return 'The profile host resolves to a non-public address.'
  }
  return null
}

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
  return (out + decoder.decode()).slice(0, MAX_BYTES)
}

// Fetch a URL following redirects MANUALLY, re-validating the host allowlist +
// private-IP guard on EVERY hop (so a whitelisted link can't 3xx us into the
// network). UA + accept are per-call so we can present as a browser (TikTok) or a
// link-preview crawler (Instagram). Returns the terminal Response, or a {note}.
async function fetchGuarded(
  start: URL,
  ua: string,
  accept: string,
): Promise<{ res?: Response; note?: string }> {
  let current = start
  for (let hop = 0; ; hop++) {
    if (hop > MAX_HOPS) return { note: 'Too many redirects from the profile.' }
    const blocked = await assertFetchable(current)
    if (blocked) return { note: blocked }
    const res = await fetch(current.toString(), {
      headers: { 'user-agent': ua, accept, 'accept-language': 'en-US,en;q=0.9' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return { res } // 3xx without a Location → treat as terminal
      try {
        current = new URL(loc, current)
      } catch {
        return { note: 'Bad redirect from the profile.' }
      }
      continue
    }
    return { res }
  }
}

function platformName(p: string): string {
  return p === 'tiktok' ? 'TikTok' : p === 'instagram' ? 'Instagram' : p === 'facebook' ? 'Facebook' : p
}

// --- Instagram: exact JSON API (best-effort) → crawler-UA og:description -----------
async function resolveInstagram(handle: string, profileUrl: string): Promise<ScrapeResult> {
  const igHandle = handleFromProfileUrl(profileUrl, handle)

  // 1) PRECISION (best-effort): the public web-profile JSON API gives the exact
  //    count. Frequently 429'd from datacenter IPs → treat any non-200 as "skip".
  if (igHandle) {
    try {
      const apiUrl = new URL(instagramWebProfileUrl(igHandle))
      if (!(await assertFetchable(apiUrl))) {
        const res = await fetch(apiUrl.toString(), {
          headers: {
            'user-agent': BROWSER_UA,
            'x-ig-app-id': IG_WEB_APP_ID,
            accept: '*/*',
            'accept-language': 'en-US,en;q=0.9',
            'x-requested-with': 'XMLHttpRequest',
            referer: `https://www.instagram.com/${encodeURIComponent(igHandle)}/`,
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(7000),
        })
        if (res.ok) {
          const exact = extractFollowerCount('instagram', (await readCapped(res)))
          if (exact != null) return { platform: 'instagram', followers: exact, found: true }
        }
      }
    } catch {
      // throttled / unreachable → fall through to the reliable og path
    }
  }

  // 2) RELIABLE: fetch the profile page AS A PREVIEW CRAWLER and read the
  //    og:description follower count (rounded, e.g. "1M", but consistently served).
  if (!profileUrl) {
    return { platform: 'instagram', followers: null, found: false, note: 'No Instagram profile URL set. Add one first.' }
  }
  let url: URL
  try {
    url = new URL(profileUrl)
  } catch {
    return { platform: 'instagram', followers: null, found: false, note: 'The Instagram profile URL is malformed.' }
  }
  try {
    const { res, note } = await fetchGuarded(url, CRAWLER_UA, 'text/html,application/xhtml+xml')
    if (note) return { platform: 'instagram', followers: null, found: false, note }
    if (!res || !res.ok) {
      return { platform: 'instagram', followers: null, found: false, note: `Instagram returned ${res?.status ?? 'no response'} (likely a login wall). Enter it manually.` }
    }
    const followers = extractFollowerCount('instagram', await readCapped(res))
    return followers != null
      ? { platform: 'instagram', followers, found: true }
      : { platform: 'instagram', followers: null, found: false, note: 'Couldn’t read Instagram’s count. Enter it manually.' }
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    return { platform: 'instagram', followers: null, found: false, note: timedOut ? 'Instagram took too long to respond.' : 'Couldn’t reach Instagram. Enter the number manually.' }
  }
}

// --- Facebook: NOT auto-fetchable (manual only) -----------------------------------
// Facebook exposes no follower count to unauthenticated requests, and the Graph API
// path needs a Page access token + app review the creator can't get (they don't own
// the page). So Facebook is MANUAL ONLY: we don't attempt a fetch, and the UI doesn't
// offer one for FB. Kept as a function so the POST dispatch stays uniform.
function resolveFacebook(): ScrapeResult {
  return {
    platform: 'facebook',
    followers: null,
    found: false,
    note: 'Facebook can’t be auto-fetched — enter the number manually.',
  }
}

// --- TikTok + any other platform: page fetch + parse ------------------------------
async function resolveGeneric(platform: string, profileUrl: string): Promise<ScrapeResult> {
  if (!profileUrl) {
    return { platform, followers: null, found: false, note: `No profile URL set for ${platformName(platform)}. Add one first.` }
  }
  let url: URL
  try {
    url = new URL(profileUrl)
  } catch {
    return { platform, followers: null, found: false, note: 'The profile URL is malformed.' }
  }
  try {
    const { res, note } = await fetchGuarded(url, userAgentFor(platform), 'text/html,application/xhtml+xml')
    if (note) return { platform, followers: null, found: false, note }
    if (!res || !res.ok) {
      return { platform, followers: null, found: false, note: `${platformName(platform)} returned ${res?.status ?? 'no response'} (often a login wall). Enter the number manually.` }
    }
    const followers = extractFollowerCount(platform, await readCapped(res))
    return followers != null
      ? { platform, followers, found: true }
      : { platform, followers: null, found: false, note: `Couldn’t read ${platformName(platform)}’s count (likely a login wall). Enter it manually.` }
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    return { platform, followers: null, found: false, note: timedOut ? 'The profile took too long to respond.' : 'Couldn’t reach that profile. Enter the number manually.' }
  }
}

export async function POST(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  let platform: unknown
  try {
    platform = (await req.json())?.platform
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (typeof platform !== 'string' || !platform) {
    return Response.json({ error: 'platform is required.' }, { status: 400 })
  }

  // Resolve the profile URL + handle we'll fetch from social_stats (admin-read).
  const sb = getAdminReadClient()
  const { data, error } = await sb
    .from('social_stats')
    .select('profile_url, handle')
    .eq('platform', platform)
    .maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const profileUrl: string = data?.profile_url ?? ''
  const handle: string = data?.handle ?? ''

  let result: ScrapeResult
  if (platform === 'instagram') result = await resolveInstagram(handle, profileUrl)
  else if (platform === 'facebook') result = resolveFacebook()
  else result = await resolveGeneric(platform, profileUrl)

  return Response.json(result)
}
