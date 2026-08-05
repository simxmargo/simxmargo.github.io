'use client'

import { useRef } from 'react'
import { X, Send, Loader2, Info } from 'lucide-react'
import { useDialog } from '@/lib/admin/useDialog'
import type { Contact } from '@/lib/types'

// Confirmation for a BULK queue — deliberately the one place in this workspace that
// still asks.
//
// Queuing a single brand needs no confirmation: the 5-minute delay plus the Cancel
// button on the queue card is the undo, and it sits in the same viewport as the click.
// That reasoning stops scaling in bulk. Undoing twenty is twenty cancels against a
// five-minute clock, and one stray "select all" followed by one stray click is the
// difference between a considered send and a mass-mail. So the cost of the action is
// stated before it happens: how many, to whom, and how many can actually go out today.
export function BulkQueueConfirm({
  contacts,
  remainingToday,
  progress,
  onConfirm,
  onClose,
}: {
  contacts: Contact[]
  /** Cap headroom in the last 24h — anything past this is queued but waits. */
  remainingToday: number
  /** Non-null while the queue loop is running. */
  progress: { done: number; total: number } | null
  onConfirm: () => void
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useDialog(panelRef, onClose)

  const n = contacts.length
  const busy = progress !== null
  const overflowCount = Math.max(0, n - remainingToday)

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose} role="presentation">
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bq-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="ico-badge">
            <Send size={18} aria-hidden="true" />
          </span>
          <h2 id="bq-title" className="modal-title">
            Queue {n} brand{n === 1 ? '' : 's'}?
          </h2>
          {/* Closing mid-run would orphan the progress indicator while the loop kept
              going, so the escape hatches are hidden rather than merely disabled. */}
          {!busy && (
            <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="field-hint hint-icon">
            <Info size={12} aria-hidden="true" />
            <span>
              Each one gets the current pitch and sends in 5 minutes. You can still cancel them
              individually from the queue until then.
            </span>
          </p>

          <ul className="bq-list">
            {contacts.map((c) => (
              <li key={c.id}>
                <span className="bq-brand">{c.brand}</span>
                <span className="bq-email">{c.email}</span>
              </li>
            ))}
          </ul>

          {overflowCount > 0 && (
            <p className="field-hint hint-warn">
              <Info size={12} aria-hidden="true" />
              {remainingToday} can go out today — the other {overflowCount} stay queued and send
              once the cap frees up.
            </p>
          )}

          <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Queuing{' '}
                  {progress.done} of {progress.total}…
                </>
              ) : (
                <>
                  <Send size={14} aria-hidden="true" /> Queue {n}
                </>
              )}
            </button>
            {!busy && (
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
