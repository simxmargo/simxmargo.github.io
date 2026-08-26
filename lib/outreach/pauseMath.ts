// The bounce breaker's math — one definition shared by the copy that ENFORCES it
// (drain-queue: trip AND auto-resume) and the copy that EXPLAINS it
// (SendingSafetyCard's "resumes around…" line).
//
// The breaker and its reset MUST share a predicate. If pausing says "3 bounces in
// 7 days" while resuming says "48 hours elapsed", the system holds two opinions
// about what safe means and oscillates between them: a timer un-pauses while the
// bounced sends are still inside the window, and the next daily sweep trips it
// again — with up to a full day of sending in between, against a condition the
// breaker already called dangerous. Resuming on the predicate's own negation
// cannot flap: nothing sends while paused, so the counts only ever decay.
//
// Dependency-free on purpose — imported by the Deno edge bundle, the Next bundle,
// and anything else that needs to agree (same arrangement as pickEmail.ts).

/** The rolling horizon every count below is taken over. */
export const BOUNCE_WINDOW_DAYS = 7

const WINDOW_MS = BOUNCE_WINDOW_DAYS * 24 * 60 * 60 * 1000

// The cutoff every count is taken from, as an ISO timestamp for a `.gte` filter.
// Exported so the enforcing count (drain-queue) and the browser's evidence read derive
// the window from one place — they had the same arithmetic written out twice, and the
// estimate below a third time with a stricter boundary than either query used.
export function bounceWindowSince(now: number = Date.now()): string {
  return new Date(now - WINDOW_MS).toISOString()
}

/** Pause outright at this many bounced addresses inside the window… */
export const BOUNCE_PAUSE_COUNT = 3

/** …or at this bounce rate, once there are enough sends for a rate to mean anything. */
export const BOUNCE_PAUSE_RATE = 0.08
export const BOUNCE_RATE_MIN_SENDS = 10

export interface BounceStats {
  /** Contacts emailed inside the window (bounced or not). */
  sends: number
  /** Of those, how many are now status 'bounced'. */
  dead: number
}

/** The breaker's one predicate: true = sending is in trouble, pause (or stay paused). */
export function bounceTripped({ sends, dead }: BounceStats): boolean {
  return (
    dead >= BOUNCE_PAUSE_COUNT ||
    (sends >= BOUNCE_RATE_MIN_SENDS && dead / sends > BOUNCE_PAUSE_RATE)
  )
}

// The EARLIEST an auto pause could lift — a floor, not a prediction. Counts are
// anchored on last_emailed_at, so each bounced row leaves the window exactly
// BOUNCE_WINDOW_DAYS after the send that produced it, and the COUNT branch clears once
// all but (BOUNCE_PAUSE_COUNT - 1) have aged out.
//
// It is only a floor because the RATE branch can outlive that: total sends decay out of
// the window alongside the bounces, so 5-of-22 dropping to 2-of-15 still reads 13% and
// stays tripped. Modelling that needs every send's timestamp, not just the bounced ones
// — so the UI says "no earlier than", and drain-queue's tick, which re-counts both
// numbers for real, is what actually decides.
export function estimateResumeAt(
  bouncedLastEmailedAt: readonly string[],
  now: number = Date.now(),
): Date | null {
  const since = Date.parse(bounceWindowSince(now))
  const inWindow = bouncedLastEmailedAt
    .map((iso) => Date.parse(iso))
    .filter((t) => Number.isFinite(t) && t >= since) // `.gte`, matching both queries
    .sort((a, b) => a - b)

  if (inWindow.length === 0) return null
  const idx =
    inWindow.length >= BOUNCE_PAUSE_COUNT
      ? inWindow.length - BOUNCE_PAUSE_COUNT // when this one ages out, dead drops below the count trip
      : inWindow.length - 1 // rate-only trip: floor is the newest bounce aging out
  return new Date(inWindow[idx] + WINDOW_MS)
}
