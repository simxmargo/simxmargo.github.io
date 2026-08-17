// The shared cron credential. One copy, because a security primitive that lives in
// four files is a security primitive that will eventually differ in four files.
//
// pg_cron has no session to present, so scheduled callers carry CRON_SECRET in
// `x-cron-secret` instead of a JWT. The comparison is length-independent: a plain
// `===` short-circuits on the first differing byte and leaks the secret's prefix
// through timing. It costs nothing to not do that.
//
// Functions reachable by BOTH cron and the studio (scrape-static, discover-brands)
// check this first and fall back to requireAdmin(); cron-only functions (drain-queue,
// top-up-leads) reject outright when it fails.

/** Constant-time string equality. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Is this request the scheduler? False when CRON_SECRET is unset, so a
 * misconfigured project fails CLOSED rather than treating everyone as cron.
 */
export function isCronCaller(req: Request): boolean {
  const expected = Deno.env.get('CRON_SECRET') ?? ''
  if (!expected) return false
  return safeEqual(req.headers.get('x-cron-secret') ?? '', expected)
}
