import { requireAdmin } from '@/lib/requireAdmin'
import { getSupabaseAdmin, getAdminReadClient } from '@/lib/supabase/admin'

// Admin API for the "sim x margo" social_stats table.
// GET  — list all rows (incl. hidden), ordered by sort_order asc.
// PUT  — update editable fields for one platform (the natural key).
// Every method is passphrase-gated by requireAdmin BEFORE any client is built.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Map a snake_case social_stats row → the camelCase shape SocialStatsEditor reads
// directly off res.json() (a DIRECT array, NOT wrapped in { data }). The editor
// also expects a UI `visible` flag derived from the is_visible column.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSocial(r: any) {
  return {
    platform: r.platform,
    handle: r.handle ?? '',
    profileUrl: r.profile_url ?? '',
    followers: Number(r.followers ?? 0),
    avgViews: r.avg_views != null ? Number(r.avg_views) : null,
    engagementRate: r.engagement_rate != null ? Number(r.engagement_rate) : null,
    growth30d: r.growth_30d != null ? Number(r.growth_30d) : null,
    history: Array.isArray(r.history) ? r.history : [],
    isVisible: r.is_visible ?? true,
    visible: r.is_visible ?? true,
    // Integration provenance for the admin UI (manual vs API + last sync time).
    source: r.source ?? 'manual',
    syncedAt: r.synced_at ?? null,
  }
}

export async function GET(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const sb = getAdminReadClient()
  const { data, error } = await sb
    .from('social_stats')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  // SocialStatsEditor reads a DIRECT camelCase array (not { data }).
  return Response.json((data ?? []).map(mapSocial))
}

export async function PUT(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  // Writes require the real service-role client; 503 if the key is unset.
  let sb
  try {
    sb = getSupabaseAdmin()
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 503 })
  }

  // Parse + validate the body.
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const platform = body.platform
  if (typeof platform !== 'string' || platform.trim() === '') {
    return Response.json({ error: 'platform (string) is required.' }, { status: 400 })
  }

  // Whitelist only editable fields, mapped camelCase → snake_case. Never trust
  // the client with id/source/synced_at/history/followers-source-of-truth keys
  // beyond what's listed here.
  const updates: Record<string, unknown> = {}

  if ('handle' in body) {
    if (body.handle !== null && typeof body.handle !== 'string') {
      return Response.json({ error: 'handle must be a string or null.' }, { status: 400 })
    }
    updates.handle = body.handle
  }

  if ('profileUrl' in body) {
    if (body.profileUrl !== null && typeof body.profileUrl !== 'string') {
      return Response.json({ error: 'profileUrl must be a string or null.' }, { status: 400 })
    }
    updates.profile_url = body.profileUrl
  }

  if ('followers' in body) {
    if (body.followers !== null && !Number.isFinite(Number(body.followers))) {
      return Response.json({ error: 'followers must be a number or null.' }, { status: 400 })
    }
    updates.followers = body.followers === null ? null : Math.trunc(Number(body.followers))
  }

  if ('avgViews' in body) {
    if (body.avgViews !== null && !Number.isFinite(Number(body.avgViews))) {
      return Response.json({ error: 'avgViews must be a number or null.' }, { status: 400 })
    }
    updates.avg_views = body.avgViews === null ? null : Math.trunc(Number(body.avgViews))
  }

  if ('engagementRate' in body) {
    if (body.engagementRate !== null && !Number.isFinite(Number(body.engagementRate))) {
      return Response.json({ error: 'engagementRate must be a number or null.' }, { status: 400 })
    }
    updates.engagement_rate = body.engagementRate === null ? null : Number(body.engagementRate)
  }

  if ('growth30d' in body) {
    if (body.growth30d !== null && !Number.isFinite(Number(body.growth30d))) {
      return Response.json({ error: 'growth30d must be a number or null.' }, { status: 400 })
    }
    updates.growth_30d = body.growth30d === null ? null : Number(body.growth30d)
  }

  if ('isVisible' in body) {
    if (typeof body.isVisible !== 'boolean') {
      return Response.json({ error: 'isVisible must be a boolean.' }, { status: 400 })
    }
    updates.is_visible = body.isVisible
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No editable fields supplied.' }, { status: 400 })
  }

  updates.updated_at = new Date().toISOString()

  const { data, error } = await sb
    .from('social_stats')
    .update(updates)
    .eq('platform', platform)
    .select('*')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}
