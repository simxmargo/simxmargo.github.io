import { requireAdmin } from '@/lib/requireAdmin'
import { getSupabaseAdmin, getAdminReadClient } from '@/lib/supabase/admin'

// Settings = Outreach Studio APP CONFIG only:
//   - faviconUrl: the whole-site browser-tab icon (public_profile.favicon_url)
//   - dailyCap:   the outreach send cap (app_settings.daily_cap)
// The creator identity (name/handle/niche/audience/reply-to/mailing/photos/OG/
// rate card/metrics) lives in the Profile tab → /api/admin/profile. requireAdmin
// gates both methods; writes go through the service-role client (anon RLS blocks
// app_settings).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const sb = getAdminReadClient()
  const [profileRes, settingsRes] = await Promise.all([
    sb.from('public_profile').select('favicon_url').eq('id', 1).maybeSingle(),
    sb.from('app_settings').select('daily_cap').eq('id', 1).maybeSingle(),
  ])
  if (profileRes.error) return Response.json({ error: profileRes.error.message }, { status: 500 })

  return Response.json({
    faviconUrl: profileRes.data?.favicon_url ?? '',
    dailyCap: settingsRes.data?.daily_cap ?? 20,
  })
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

  let b: Record<string, unknown>
  try {
    b = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (typeof b !== 'object' || b === null || Array.isArray(b)) {
    return Response.json({ error: 'Body must be a JSON object.' }, { status: 400 })
  }

  let touched = false

  // Favicon → public_profile.favicon_url (a dedicated column, not the seo blob).
  if ('faviconUrl' in b) {
    const { error } = await sb
      .from('public_profile')
      .update({ favicon_url: b.faviconUrl, updated_at: new Date().toISOString() })
      .eq('id', 1)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    touched = true
  }

  // Daily send cap → app_settings (outreach concern, clamped server-side).
  if ('dailyCap' in b) {
    const cap = Math.max(1, Math.min(200, Math.trunc(Number(b.dailyCap) || 0)))
    const { error } = await sb
      .from('app_settings')
      .update({ daily_cap: cap, updated_at: new Date().toISOString() })
      .eq('id', 1)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    touched = true
  }

  if (!touched) return Response.json({ error: 'No updatable fields provided.' }, { status: 400 })
  return Response.json({ ok: true })
}
