import { requireAdmin } from '@/lib/requireAdmin'
import { fetchProfilePosts } from '@/lib/social/scrapeCreators'

// Bulk supply tool: fetch a creator's OWN recent TikTok / Instagram posts by handle so
// the admin can auto-match them to brands instead of pasting each link. The actual fetch
// is delegated to the ScrapeCreators managed API (see lib/social/scrapeCreators.ts) —
// a direct server-side fetch of a TikTok profile only ever gets the SlardarWAF JS
// challenge shell (verified). Covers returned here are signed/expiring; they're re-hosted
// when committed (see /api/admin/brands/add-videos).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  let body: { platform?: unknown; handle?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const platform = body.platform === 'instagram' ? 'instagram' : body.platform === 'tiktok' ? 'tiktok' : null
  // Cap length before it's encoded into the upstream URL / reflected in messages — real
  // TikTok/IG handles are well under this, so this only fences off pathological input.
  const handle = typeof body.handle === 'string' ? body.handle.trim().replace(/^@/, '').slice(0, 80) : ''
  if (!platform) return Response.json({ error: 'platform must be "tiktok" or "instagram".' }, { status: 400 })
  if (!handle) return Response.json({ error: 'A profile handle is required.' }, { status: 400 })

  const result = await fetchProfilePosts(platform, handle)
  if (result.error) return Response.json({ error: result.error }, { status: result.status })
  return Response.json(result.note ? { videos: result.videos, note: result.note } : { videos: result.videos })
}
