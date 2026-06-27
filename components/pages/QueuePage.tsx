'use client'

import { Trash2, Send, ShieldCheck } from 'lucide-react'
import { useStore } from '@/lib/store'

export function QueuePage() {
  const { queue, contacts, dailyCap, sentToday, removeFromQueue, markQueuedAsSent } = useStore()
  const remaining = Math.max(0, dailyCap - sentToday)
  const brandFor = (contactId: string) => contacts.find((c) => c.id === contactId)?.brand ?? '—'
  const capPct = `${Math.min(100, (sentToday / dailyCap) * 100)}%`

  return (
    <>
      <header className="main-head">
        <div>
          <h1 className="page-title display">Send Queue</h1>
          <p className="page-sub">Review each draft, then send. Nothing sends without your click.</p>
        </div>
      </header>

      <div className="stack">
        {/* Daily cap meter — the visible guardrail that protects your sending account. */}
        <section className="card">
          <div className="card-head">
            <span className="ico-badge"><ShieldCheck size={18} aria-hidden="true" /></span>
            <h2 className="card-title">Daily send cap</h2>
          </div>
          <div className="card-body">
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <span className="muted-sm">Today’s sending</span>
              <span className="muted-sm">
                {sentToday} / {dailyCap} sent today · {remaining} left
              </span>
            </div>
            <div className="slider-track" style={{ position: 'relative', height: 6 }}>
              <div className="slider-fill" style={{ width: capPct, transition: 'width 0.3s' }} />
            </div>
            <p className="card-sub" style={{ marginTop: 14 }}>
              Low caps + warmup keep your sending account healthy. Adjust in Settings.
            </p>
          </div>
        </section>

        {queue.length === 0 ? (
          <div className="empty">Queue is empty. Draft emails from the Contacts tab to add them here.</div>
        ) : (
          queue.map((q) => (
            <section key={q.id} className="card">
              <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                <span className="card-title">{brandFor(q.contactId)}</span>
                <div className="flex" style={{ gap: 8 }}>
                  {/* TODO(studio-backend): real send via Gmail-API Edge Function. */}
                  <button
                    type="button"
                    onClick={() => markQueuedAsSent(q.id)}
                    disabled={remaining <= 0}
                    className={`btn btn-primary btn-sm${remaining <= 0 ? ' is-disabled' : ''}`}
                  >
                    <Send size={13} aria-hidden="true" /> Approve &amp; send
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFromQueue(q.id)}
                    className="btn btn-danger btn-sm"
                    aria-label="Remove from queue"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{q.subject}</div>
              <pre
                style={{
                  marginTop: 8,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'var(--muted)',
                }}
              >
                {q.body}
              </pre>
            </section>
          ))
        )}

        <p className="card-sub">
          Note: “Approve &amp; send” is mocked in this UI shell. Real sending via the Gmail API
          (secondary account, Reply-To → you) is documented in{' '}
          <span style={{ color: 'var(--ink)' }}>docs/BACKEND_DESIGN.md</span>.
        </p>
      </div>
    </>
  )
}
