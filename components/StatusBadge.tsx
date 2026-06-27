import type { ContactStatus } from '@/lib/types'

// Map each lead status to a ".studio" pill variant (defined in globals.css):
//   pill        — neutral (new / skipped)
//   pill-accent — in-flight (queued / sent)
//   pill-ok     — success (replied)
//   pill-danger — failure (bounced)
const STYLES: Record<ContactStatus, string> = {
  new: 'pill',
  queued: 'pill pill-accent',
  sent: 'pill pill-accent',
  replied: 'pill pill-ok',
  bounced: 'pill pill-danger',
  skip: 'pill',
}

const LABELS: Record<ContactStatus, string> = {
  new: 'New',
  queued: 'Queued',
  sent: 'Sent',
  replied: 'Replied',
  bounced: 'Bounced',
  skip: 'Skipped',
}

export function StatusBadge({ status }: { status: ContactStatus }) {
  return <span className={STYLES[status]}>{LABELS[status]}</span>
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
