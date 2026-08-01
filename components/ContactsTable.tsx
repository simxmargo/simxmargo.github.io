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

  return (
    <div className="panel">
      <table className="table">
        <thead>
          <tr>
            <th>Brand</th>
            <th>Contact</th>
            <th>Country</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id}>
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
                          <Send size={13} aria-hidden="true" /> Queue for Outreach
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
