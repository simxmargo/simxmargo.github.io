import { requireAdmin } from '@/lib/requireAdmin'

// Cheap endpoint the client gate hits to validate the passphrase. The actual
// protection is requireAdmin running on EVERY admin route, not just this one.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied
  return Response.json({ ok: true })
}
