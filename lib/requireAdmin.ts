import { timingSafeEqual } from 'node:crypto'

// The ENTIRE security boundary for admin writes. Every /api/admin/* Route Handler
// must call this before constructing the service-role client. Constant-time
// compare (never ===) so the passphrase can't be guessed via timing. Returns a
// 401 Response when the header is missing/wrong, else null (proceed).
//
// The passphrase travels as the `x-admin-secret` HEADER — never a query string
// (which would leak into logs / history / Referer). Node runtime only (uses
// node:crypto); keep admin handlers off the edge runtime.
export function requireAdmin(req: Request): Response | null {
  const got = req.headers.get('x-admin-secret') ?? ''
  const want = process.env.ADMIN_SECRET ?? ''

  // No secret configured server-side → deny everything (fail closed).
  if (!want) {
    return Response.json({ error: 'Admin is not configured (ADMIN_SECRET unset).' }, { status: 503 })
  }

  const a = Buffer.from(got)
  const b = Buffer.from(want)
  const ok = a.length === b.length && timingSafeEqual(a, b)
  return ok ? null : Response.json({ error: 'Unauthorized' }, { status: 401 })
}
