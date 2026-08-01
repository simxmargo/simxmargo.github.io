import type { ContactStatus } from '@/lib/types'

// Map each lead status to a ".studio" pill variant (defined in globals.css):
//   pill        — neutral (new / skipped)
//   pill-accent — in-flight (queued / sent)
//   pill-ok     — success (replied)
//   pill-danger — failure (bounced)
const STYLES: Record<ContactStatus, string> = {
  new: 'pill',
  inbound: 'pill pill-ok',
  queued: 'pill pill-accent',
  sent: 'pill pill-accent',
  replied: 'pill pill-ok',
  bounced: 'pill pill-danger',
  skip: 'pill pill-muted',
}

const LABELS: Record<ContactStatus, string> = {
  new: 'New',
  // "They emailed us" rather than "Inbound" — the point of this status is that the
  // brand made the first move, and a plain noun buries that.
  inbound: 'They emailed us',
  queued: 'Queued',
  sent: 'Sent',
  replied: 'Replied',
  bounced: 'Bounced',
  // The DB value stays 'skip' (it's in the contacts CHECK constraint and predates
  // this wording); only the label changed, because "Archived" is what the action
  // now says and a badge that disagreed with its own button would read as a bug.
  skip: 'Archived',
}

/** Whole days since an ISO date, or null if it isn't parseable. */
function daysSince(iso: string): number | null {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86_400_000)
}

export function StatusBadge({ status, since }: { status: ContactStatus; since?: string }) {
  // "New" with no qualifier is true on day one and still true six weeks later, which
  // is how a whole column ends up meaning nothing. Ageing it turns a label into a
  // nudge: a lead sitting at "New · 21d" is visibly waiting on you.
  const age = status === 'new' && since ? daysSince(since) : null
  return (
    <span className={STYLES[status]}>
      {LABELS[status]}
      {age !== null && age >= 1 && (
        <span style={{ opacity: 0.65, fontWeight: 500 }}>· {age}d</span>
      )}
    </span>
  )
}

// Small colored chip for the 1-10 AI fit score.
export function FitChip({ score }: { score: number | null }) {
  if (score == null) return <span style={{ fontSize: 12, color: 'var(--faint)' }}>—</span>
  const tone = score >= 8 ? 'pill pill-ok' : score >= 6 ? 'pill pill-accent' : 'pill'
  return (
    <span
      className={tone}
      style={{
        display: 'inline-flex',
        height: 26,
        width: 26,
        padding: 0,
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
      }}
    >
      {score}
    </span>
  )
}
