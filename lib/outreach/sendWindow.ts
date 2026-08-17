// The send window and the warm-up ramp — one definition the whole studio describes from.
//
// `drain-queue` ENFORCES these rules server-side; nothing here guards anything. The
// point is that the studio should not re-derive them. It used to: the Outreach header
// promised "sends in 5 minutes" while the server was waiting for the next weekday
// morning, and the Daily cap card showed the raw setting while the ramp allowed less.
// Both were written before the window existed and drifted silently.
//
// Dependency-free on purpose, so the Deno side can import it too if the enforcing copy
// is ever consolidated here (see supabase/functions/_shared/sendPitch.ts →
// effectiveDailyCap, and drain-queue's window gate).

/** Asia/Manila is UTC+8 with no DST — fixed arithmetic beats bundling timezone data. */
export const PH_OFFSET_MS = 8 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

/** The window knobs, as `app_settings` stores them (migration 0017). */
export interface SendWindow {
  sendWeekdaysOnly: boolean
  sendWindowStart: number
  sendWindowEnd: number
}

/** PH wall-clock hour and weekday for an instant. Shift, then read UTC fields. */
export function phFields(at: number): { hour: number; day: number } {
  const d = new Date(at + PH_OFFSET_MS)
  return { hour: d.getUTCHours(), day: d.getUTCDay() }
}

/** UTC epoch ms of midnight, PH time, on the day containing `at`. */
export function phDayStart(at: number): number {
  const ph = new Date(at + PH_OFFSET_MS)
  return Date.UTC(ph.getUTCFullYear(), ph.getUTCMonth(), ph.getUTCDate()) - PH_OFFSET_MS
}

export function isWeekendPH(at: number): boolean {
  const { day } = phFields(at)
  return day === 0 || day === 6
}

/** Is `at` inside the window a tick would send in? Mirrors drain-queue's two gates. */
export function isSendableAt(at: number, w: SendWindow): boolean {
  if (w.sendWeekdaysOnly && isWeekendPH(at)) return false
  const { hour } = phFields(at)
  return hour >= w.sendWindowStart && hour < w.sendWindowEnd
}

// The earliest instant from `from` onwards at which a cron tick could send. Returns
// `from` itself when the window is already open. Walks whole PH days rather than
// looping hours, and gives up after 8 — with a sane window that is unreachable, but an
// infinite loop in a render path is not a failure mode worth leaving open.
export function nextSendOpportunity(from: number, w: SendWindow): number {
  const base = phDayStart(from)
  for (let i = 0; i < 8; i++) {
    const dayStart = base + i * DAY_MS
    if (w.sendWeekdaysOnly && isWeekendPH(dayStart + 12 * HOUR_MS)) continue
    const close = dayStart + w.sendWindowEnd * HOUR_MS
    if (from < close) return Math.max(from, dayStart + w.sendWindowStart * HOUR_MS)
  }
  return NaN
}

// When a queued row can actually leave: its grace period has to elapse AND the window
// has to be open. "Send now" clears the grace period, never the window.
export function nextSendForRow(scheduledForIso: string, w: SendWindow, now: number): number {
  const due = Date.parse(scheduledForIso)
  return nextSendOpportunity(Math.max(now, Number.isFinite(due) ? due : now), w)
}

export function fmtHourPH(h: number): string {
  const twelve = h % 12 === 0 ? 12 : h % 12
  return `${twelve} ${h < 12 ? 'AM' : 'PM'}`
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "weekday mornings, 8–11 AM PH" — the one sentence that describes the schedule. */
export function describeWindow(w: SendWindow): string {
  const from = fmtHourPH(w.sendWindowStart)
  const to = fmtHourPH(w.sendWindowEnd)
  // Drop the repeated meridiem on a window that doesn't straddle noon: "8–11 AM",
  // not "8 AM–11 AM".
  const [fromHour, fromMeridiem] = from.split(' ')
  const span = fromMeridiem === to.split(' ')[1] ? `${fromHour}–${to}` : `${from}–${to}`

  const partOfDay =
    w.sendWindowEnd <= 12 ? 'mornings' : w.sendWindowStart >= 12 ? 'afternoons' : 'daytimes'
  return w.sendWeekdaysOnly ? `weekday ${partOfDay}, ${span} PH` : `every day, ${span} PH`
}

// Badge text for one queued row. Inside the hour a countdown is the honest answer;
// beyond it the hour alone is, because the exact minute is jitter's to decide.
export function describeNextSend(at: number, now: number): string {
  if (!Number.isFinite(at)) return 'Waiting for a send window'

  const ms = at - now
  if (ms <= 0) return 'Sends this window'
  if (ms < HOUR_MS) {
    const total = Math.ceil(ms / 1000)
    return `Sends in ${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  }

  const time = fmtHourPH(phFields(at).hour)
  const days = Math.round((phDayStart(at) - phDayStart(now)) / DAY_MS)
  if (days <= 0) return `Sends at ${time}`
  if (days === 1) return `Sends tomorrow, ${time}`
  return `Sends ${WEEKDAY[phFields(at).day]}, ${time}`
}

// Today's ENFORCED ceiling, which is not `daily_cap` until the ramp has caught up:
// the cap starts at warmup_start and grows by that much each full week since the first
// real send, because sudden volume from a quiet Gmail account reads as a takeover.
// Mirrors effectiveDailyCap() in supabase/functions/_shared/sendPitch.ts — that copy
// enforces, this one explains. Keep the formula identical.
export function effectiveCap(
  dailyCap: number,
  warmupStart: number,
  firstSendAt: string | null,
  now: number = Date.now(),
): number {
  const first = firstSendAt ? Date.parse(firstSendAt) : NaN
  const start = Math.max(1, warmupStart)
  if (!Number.isFinite(first)) return Math.min(dailyCap, start)
  const weeks = Math.max(0, Math.floor((now - first) / (7 * DAY_MS)))
  return Math.min(dailyCap, start * (1 + weeks))
}
