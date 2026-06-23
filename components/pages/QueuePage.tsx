'use client'

import { Trash2, Send, ShieldCheck } from 'lucide-react'
import { useStore } from '@/lib/store'

export function QueuePage() {
  const { queue, contacts, dailyCap, sentToday, removeFromQueue, markQueuedAsSent } = useStore()
  const remaining = Math.max(0, dailyCap - sentToday)
  const brandFor = (contactId: string) => contacts.find((c) => c.id === contactId)?.brand ?? '—'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-stone-900">Send Queue</h1>
        <p className="text-sm text-stone-500">Review each draft, then send. Nothing sends without your click.</p>
      </div>

      {/* Daily cap meter — the visible guardrail that protects your sending account. */}
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-medium text-stone-700">
            <ShieldCheck size={16} className="text-emerald-600" /> Daily send cap
          </span>
          <span className="text-stone-500">
            {sentToday} / {dailyCap} sent today · {remaining} left
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-stone-100">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${Math.min(100, (sentToday / dailyCap) * 100)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-stone-400">
          Low caps + warmup keep your sending account healthy. Adjust in Settings.
        </p>
      </div>

      {queue.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white py-16 text-center text-sm text-stone-400">
          Queue is empty. Draft emails from the Contacts tab to add them here.
        </div>
      ) : (
        <div className="space-y-3">
          {queue.map((q) => (
            <div key={q.id} className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium text-stone-900">{brandFor(q.contactId)}</span>
                <div className="flex gap-2">
                  {/* TODO(studio-backend): real send via Gmail-API Edge Function. */}
                  <button
                    onClick={() => markQueuedAsSent(q.id)}
                    disabled={remaining <= 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-plum-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-plum-700 disabled:opacity-40"
                  >
                    <Send size={13} /> Approve &amp; send
                  </button>
                  <button
                    onClick={() => removeFromQueue(q.id)}
                    className="rounded-lg border border-stone-200 px-2 py-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-600"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div className="text-sm font-medium text-stone-700">{q.subject}</div>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-xs leading-relaxed text-stone-500">
                {q.body}
              </pre>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-stone-400">
        Note: “Approve &amp; send” is mocked in this UI shell. Real sending via the Gmail API
        (secondary account, Reply-To → you) is documented in{' '}
        <span className="text-stone-500">docs/BACKEND_DESIGN.md</span>.
      </p>
    </div>
  )
}
