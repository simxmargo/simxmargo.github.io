import type { Contact } from '@/lib/types'

export function StatsBar({ contacts }: { contacts: Contact[] }) {
  const count = (pred: (c: Contact) => boolean) => contacts.filter(pred).length
  const stats = [
    { label: 'Total leads', value: contacts.length, tone: 'text-stone-900' },
    { label: 'New', value: count((c) => c.status === 'new'), tone: 'text-stone-900' },
    { label: 'Queued', value: count((c) => c.status === 'queued'), tone: 'text-amber-600' },
    { label: 'Sent', value: count((c) => c.status === 'sent'), tone: 'text-sky-600' },
    { label: 'Replied', value: count((c) => c.status === 'replied'), tone: 'text-emerald-600' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((s) => (
        <div key={s.label} className="rounded-xl border border-stone-200 bg-white px-4 py-3">
          <div className={`font-display text-2xl font-semibold ${s.tone}`}>{s.value}</div>
          <div className="text-xs font-medium uppercase tracking-wide text-stone-400">{s.label}</div>
        </div>
      ))}
    </div>
  )
}
