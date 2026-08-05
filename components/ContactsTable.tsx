'use client'

import { ExternalLink, Send, Archive, Loader2, Check } from 'lucide-react'
import type { Contact } from '@/lib/types'
import { StatusBadge } from './StatusBadge'

export function ContactsTable({
  contacts,
  totalCount,
  onQueue,
  onSkip,
  queuedContactIds,
  pendingId,
  disabledReason,
  selectedIds,
  onToggleSelect,
  onTogglePage,
}: {
  contacts: Contact[]
  /** Unfiltered contact count — lets the empty state tell "no data yet" apart
   *  from "your filters excluded everything". Blaming the filters when the table
   *  is simply empty reads as a bug and sends you hunting for one. */
  totalCount: number
  onQueue: (c: Contact) => void
  onSkip: (c: Contact) => void
  /** Contacts with a live send_queue row — their button becomes a non-action. */
  queuedContactIds: Set<string>
  /** The row mid-request, so only that button spins. */
  pendingId: string | null
  /** Non-empty when sending is blocked (no account / no test sent yet). */
  disabledReason: string
  /** Rows ticked for a bulk queue. */
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  /** Select/clear every SELECTABLE row on this page (already-queued rows excluded). */
  onTogglePage: (ids: string[], select: boolean) => void
}) {
  if (contacts.length === 0) {
    return (
      <div className="empty">
        {totalCount === 0
          ? 'No contacts yet — use “Scrape new brands” above to find brand inboxes.'
          : 'No contacts match your filters.'}
      </div>
    )
  }

  // Already-queued rows can't be queued again, so they're not tickable either —
  // otherwise "select all" would promise work it can't do.
  const selectable = contacts.filter((c) => !queuedContactIds.has(c.id)).map((c) => c.id)
  const selectedHere = selectable.filter((id) => selectedIds.has(id)).length
  const allSelected = selectable.length > 0 && selectedHere === selectable.length

  return (
    <div className="panel">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 34 }}>
              <input
                type="checkbox"
                className="tick"
                checked={allSelected}
                // Partial selection has to LOOK partial: an unchecked box beside six
                // ticked rows reads as "nothing selected".
                ref={(el) => {
                  if (el) el.indeterminate = selectedHere > 0 && !allSelected
                }}
                onChange={() => onTogglePage(selectable, !allSelected)}
                disabled={selectable.length === 0 || Boolean(disabledReason)}
                aria-label={allSelected ? 'Clear selection on this page' : 'Select every brand on this page'}
              />
            </th>
            <th>Brand</th>
            <th>Contact</th>
            <th>Country</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id} data-selected={selectedIds.has(c.id) ? '' : undefined}>
              <td>
                <input
                  type="checkbox"
                  className="tick"
                  checked={selectedIds.has(c.id)}
                  onChange={() => onToggleSelect(c.id)}
                  disabled={queuedContactIds.has(c.id) || Boolean(disabledReason)}
                  aria-label={`Select ${c.brand}`}
                />
              </td>
              <td>
                <div style={{ fontWeight: 600 }}>{c.brand}</div>
                <a
                  href={`https://${c.website}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1"
                  style={{ fontSize: 12, color: 'var(--muted)', textDecoration: 'none' }}
                >
                  {c.website} <ExternalLink size={11} aria-hidden="true" />
                </a>
              </td>
              <td>
                <div>{c.email}</div>
                <div style={{ fontSize: 12, color: 'var(--faint)', textTransform: 'capitalize' }}>{c.emailType}</div>
              </td>
              <td style={{ color: 'var(--muted)' }}>{c.country}</td>
              <td>
                <StatusBadge status={c.status} since={c.createdAt} />
              </td>
              <td>
                <div className="flex justify-end gap-1.5">
                  {/* Already queued is shown as a STATE, not a disabled button with the
                      same label — a greyed-out "Queue for Outreach" reads as broken,
                      whereas "Queued" reads as done. */}
                  {queuedContactIds.has(c.id) ? (
                    <span className="pill pill-ok" style={{ whiteSpace: 'nowrap' }}>
                      <Check size={12} aria-hidden="true" /> Queued
                    </span>
                  ) : (
                    <button
                      onClick={() => onQueue(c)}
                      disabled={pendingId !== null || Boolean(disabledReason)}
                      title={disabledReason || `Queue an outreach email to ${c.brand}`}
                      className={`btn btn-primary btn-sm${
                        pendingId !== null || disabledReason ? ' is-disabled' : ''
                      }`}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {pendingId === c.id ? (
                        <>
                          <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Queuing…
                        </>
                      ) : (
                        <>
                          <Send size={13} aria-hidden="true" /> Queue
                        </>
                      )}
                    </button>
                  )}
                  {/* Archive, not delete: the row stays (and keeps its scrape history)
                      but leaves every default view. Reachable again via the Archived
                      filter, so this is never a decision you can't walk back. */}
                  <button
                    onClick={() => onSkip(c)}
                    title={`Archive ${c.brand}`}
                    aria-label={`Archive ${c.brand}`}
                    className="btn btn-ghost btn-sm"
                  >
                    <Archive size={13} aria-hidden="true" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
