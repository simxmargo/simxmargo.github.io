import type { ContactStatus } from '@/lib/types'

const STYLES: Record<ContactStatus, string> = {
  new: 'bg-stone-100 text-stone-600 ring-stone-200',
  queued: 'bg-amber-50 text-amber-700 ring-amber-200',
  sent: 'bg-sky-50 text-sky-700 ring-sky-200',
  replied: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  bounced: 'bg-red-50 text-red-700 ring-red-200',
  skip: 'bg-stone-50 text-stone-400 ring-stone-200',
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
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  )
}

// Small colored chip for the 1-10 AI fit score.
export function FitChip({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-stone-400">—</span>
  const tone =
    score >= 8
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : score >= 6
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-stone-100 text-stone-500 ring-stone-200'
  return (
    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset ${tone}`}>
      {score}
    </span>
  )
}
