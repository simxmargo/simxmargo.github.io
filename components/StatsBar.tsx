import type { Contact } from '@/lib/types'

export function StatsBar({ contacts }: { contacts: Contact[] }) {
  const count = (pred: (c: Contact) => boolean) => contacts.filter(pred).length
  const stats = [
    { label: 'Total leads', value: contacts.length, tone: 'var(--ink)' },
    { label: 'New', value: count((c) => c.status === 'new'), tone: 'var(--ink)' },
    { label: 'Queued', value: count((c) => c.status === 'queued'), tone: 'var(--accent)' },
    { label: 'Sent', value: count((c) => c.status === 'sent'), tone: 'var(--accent)' },
    { label: 'Replied', value: count((c) => c.status === 'replied'), tone: 'var(--ok)' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((s) => (
        <div key={s.label} className="card" style={{ padding: '16px 18px', borderRadius: 12 }}>
          <div className="display" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, color: s.tone }}>
            {s.value}
          </div>
          <div className="flabel" style={{ marginTop: 8 }}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  )
}
