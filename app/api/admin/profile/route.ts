import { requireAdmin } from '@/lib/requireAdmin'
import { getSupabaseAdmin, getAdminReadClient } from '@/lib/supabase/admin'

// Admin API for the single public_profile row (id=1) — the "sim x margo" media-kit
// identity. GET reads it (service-role, or anon fallback for live public fields);
// PUT applies a whitelisted partial update. requireAdmin gates BOTH methods.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Map a snake_case public_profile row → the camelCase shape ProfileEditor reads
// directly off res.json() (NOT wrapped in { data }). Mirrors lib/mediakit/data.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProfile(r: any) {
  return {
    displayName: r.display_name ?? '',
    tagline: r.tagline ?? '',
    niche: r.niche ?? '',
    location: r.location ?? '',
    bioMd: r.bio_md ?? '',
    avatarUrl: r.avatar_url ?? '',
    heroImageUrl: r.hero_image_url ?? '',
    rateCard: Array.isArray(r.rate_card) ? r.rate_card : [],
    pressLogos: Array.isArray(r.press_logos) ? r.press_logos : [],
    seo: r.seo ?? {},
    totalFollowers: r.total_followers ?? null,
    isPublished: Boolean(r.is_published),
  }
}

export async function GET(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const sb = getAdminReadClient()
  const { data, error } = await sb
    .from('public_profile')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  // ProfileEditor reads the profile as a DIRECT camelCase object (not { data }).
  return Response.json(data ? mapProfile(data) : null)
}

export async function PUT(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  let sb
  try {
    sb = getSupabaseAdmin()
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 503 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be a JSON object' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  // Whitelist client camelCase fields → snake_case columns. Only keys actually
  // present in the body are mapped, so PUT is a partial update. Never trust the
  // client to name columns directly.
  const updates: Record<string, unknown> = {}
  if ('displayName' in b) updates.display_name = b.displayName
  if ('tagline' in b) updates.tagline = b.tagline
  if ('bioMd' in b) updates.bio_md = b.bioMd
  if ('avatarUrl' in b) updates.avatar_url = b.avatarUrl
  if ('heroImageUrl' in b) updates.hero_image_url = b.heroImageUrl
  if ('location' in b) updates.location = b.location
  if ('niche' in b) updates.niche = b.niche
  if ('totalFollowers' in b) updates.total_followers = b.totalFollowers
  if ('rateCard' in b) updates.rate_card = b.rateCard
  if ('pressLogos' in b) updates.press_logos = b.pressLogos
  if ('seo' in b) updates.seo = b.seo
  if ('isPublished' in b) updates.is_published = b.isPublished

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No updatable fields provided' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()

  const { data, error } = await sb
    .from('public_profile')
    .update(updates)
    .eq('id', 1)
    .select('*')
    .maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data })
}
