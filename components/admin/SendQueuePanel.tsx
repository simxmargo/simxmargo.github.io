'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Clock, Check, AlertTriangle, Loader2, X, Send, RotateCcw, Search } from 'lucide-react'
import { adminKeys } from '@/lib/admin/queries'
import {
  cancelQueued,
  requeue,
  sendQueuedNow,
  SEND_DELAY_MINUTES,
  type SendQueueRow,
} from '@/lib/admin/resources/sendQueue'
import { QueuePreviewModal } from '@/components/admin/QueuePreviewModal'
import type { SignatureSource } from '@/lib/emailSignature'

// The right-hand column of the Outreach workspace: what is about to go out, what
// already went, and what broke.
//
// Everything here is a view over `send_queue` rows. The countdown is cosmetic — the
// actual send is pg_cron's job, so a closed tab still sends and a stopped clock never
// means a stopped queue. Due rows wait for the MORNING SEND WINDOW (Settings →
// Sending safety); "Send now" skips the grace period, not the window.

const LIVE = new Set<SendQueueRow['status']>(['queued', 'sending'])
// 4 rows is what the fixed-height list holds without an inner scrollbar. The height is
// fixed so the card doesn't resize every time a send lands or a filter changes — the
// Daily cap above it and the page below would otherwise jump under the cursor.
const PAGE_SIZE = 4

type FilterKey = 'active' | 'sent' | 'problem' | 'all'

const FILTERS: { key: FilterKey; label: string; match: (r: SendQueueRow) => boolean }[] = [
  { key: 'active', label: 'Queued', match: (r) => LIVE.has(r.status) },
  { key: 'sent', label: 'Sent', match: (r) => r.status === 'sent' },
  { key: 'problem', label: 'Needs attention', match: (r) => r.status === 'failed' || r.status === 'canceled' },
  { key: 'all', label: 'All', match: () => true },
]

/** mm:ss remaining, or null once it's due. */
function countdown(iso: string, now: number): string | null {
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return null
  const total = Math.ceil(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function sentAgo(iso: string | null, now: number): string {
  if (!iso) return ''
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function SendQueuePanel({
  rows,
  loading,
  signatureSource,
  onChanged,
}: {
  rows: SendQueueRow[]
  loading: boolean
  signatureSource: SignatureSource
  /** Queue actions also move contact status, which lives in the Zustand store rather
   *  than react-query — so the parent re-hydrates it. */
  onChanged: () => void
}) {
  const qc = useQueryClient()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmRow, setConfirmRow] = useState<SendQueueRow | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<FilterKey>('active')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  // A cancelled or failed attempt is history right up until you retry it — at which
  // point the SAME brand has a live row, and showing the dead one beside it is just
  // noise you have to mentally filter. Sent rows are kept: "sent 2h ago, sending
  // again in 4:53" is genuinely two different facts.
  const visible = useMemo(() => {
    const liveContacts = new Set(rows.filter((r) => LIVE.has(r.status)).map((r) => r.contactId))
    return rows.filter(
      (r) =>
        !(
          (r.status === 'canceled' || r.status === 'failed') && liveContacts.has(r.contactId)
        ),
    )
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rule = FILTERS.find((f) => f.key === filter) ?? FILTERS[3]
    return visible
      .filter(rule.match)
      .filter((r) => !q || r.brand.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
  }, [visible, filter, search])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  // One shared clock rather than a timer per row, and only while something is actually
  // counting down — a 1s interval ticking forever on a settled queue is battery burn
  // for a UI that never changes.
  const live = visible.some((r) => LIVE.has(r.status))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [live])

  // The send happens server-side, so the browser has to ask whether it happened.
  // Polling only while something is live keeps this off the idle path entirely.
  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => {
      void qc.invalidateQueries({ queryKey: adminKeys.sendQueue })
    }, 15_000)
    return () => window.clearInterval(t)
  }, [live, qc])

  // Latest callback without making it an effect dependency — the parent passes an
  // inline arrow, which would otherwise re-run the scan below on every render.
  const onChangedRef = useRef(onChanged)
  useEffect(() => {
    onChangedRef.current = onChanged
  }, [onChanged])

  // A row settling server-side ALSO moves contacts.status + contacts.last_emailed_at,
  // and those live in the Zustand store, NOT react-query — so the poll above cannot
  // refresh them. Without this the contacts list keeps reading "Queued" and the Daily
  // cap keeps reading 0/20 long after the mail went out. It cannot self-correct
  // either: `live` flips false the moment the last row settles, which STOPS the poll
  // at precisely the point the contact data became wrong. So watch for the
  // queued/sending → settled edge and re-hydrate once, when it actually happens.
  const prevStatus = useRef(new Map<string, SendQueueRow['status']>())
  useEffect(() => {
    const seen = prevStatus.current
    let settled = false
    for (const r of rows) {
      const before = seen.get(r.id)
      if (before !== undefined && LIVE.has(before) && !LIVE.has(r.status)) settled = true
      seen.set(r.id, r.status)
    }
    if (settled) onChangedRef.current()
  }, [rows])

  async function run(id: string, fn: () => Promise<unknown>): Promise<void> {
    setBusyId(id)
    setError('')
    try {
      await fn()
      await qc.invalidateQueries({ queryKey: adminKeys.sendQueue })
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.')
    } finally {
      setBusyId(null)
      setConfirmRow(null)
    }
  }

  const waiting = visible.filter((r) => LIVE.has(r.status)).length

  return (
    <section className="card" aria-label="Send queue">
      <div className="card-head">
        <span className="ico-badge">
          <Send size={18} aria-hidden="true" />
        </span>
        <h2 className="card-title">Send Queue</h2>
        {waiting > 0 && <span className="pill">{waiting} waiting</span>}
      </div>

      <div className="card-body">
        {error && (
          <div className="banner banner-error" role="alert" style={{ marginBottom: 12 }}>
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Filters stay visible even when a bucket is empty — a chip that vanishes is a
            chip you can't discover, and "where did my sent items go?" is worse than an
            empty list that explains itself. */}
        <div className="dir-cats" style={{ marginBottom: 10 }}>
          {FILTERS.map((f) => {
            const n = visible.filter(f.match).length
            return (
              <button
                key={f.key}
                type="button"
                className={`tpl-chip${filter === f.key ? ' active' : ''}`}
                onClick={() => {
                  setFilter(f.key)
                  setPage(0)
                }}
                aria-pressed={filter === f.key}
              >
                {f.label} {n > 0 && <span style={{ opacity: 0.6 }}>{n}</span>}
              </button>
            )
          })}
        </div>

        {visible.length > PAGE_SIZE && (
          <div className="relative" style={{ marginBottom: 10 }}>
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--faint)' }}
            />
            <input
              className="input"
              placeholder="Search the queue…"
              aria-label="Search the send queue"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(0)
              }}
              style={{ paddingLeft: 34 }}
            />
          </div>
        )}

        <div className="queue-list">
          {loading && rows.length === 0 && <div className="queue-empty">Loading queue…</div>}

          {!loading && filtered.length === 0 && (
            <div className="queue-empty">
              {visible.length === 0 ? (
                <>
                  Nothing queued. Use <strong>Queue for Outreach</strong> on a contact to schedule a
                  pitch.
                </>
              ) : (
                'Nothing in this view.'
              )}
            </div>
          )}

          {pageRows.map((r) => {
            const busy = busyId === r.id
            const left = r.status === 'queued' ? countdown(r.scheduledFor, now) : null

            return (
              <article
                key={r.id}
                className="queue-row"
                data-status={r.status}
                aria-label={`${r.brand} — ${r.status}`}
              >
                <div className="flex items-center justify-between" style={{ gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="queue-brand">{r.brand}</div>
                    <div className="queue-meta">{r.email}</div>
                  </div>

                  {/* Status is carried by an icon + a word, never colour alone. */}
                  {r.status === 'sent' && (
                    <span className="pill pill-ok" style={{ whiteSpace: 'nowrap' }}>
                      <Check size={12} aria-hidden="true" /> Sent {sentAgo(r.sentAt, now)}
                    </span>
                  )}
                  {r.status === 'sending' && (
                    <span className="pill" style={{ whiteSpace: 'nowrap' }}>
                      <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Sending
                    </span>
                  )}
                  {r.status === 'queued' && (
                    <span className="pill" style={{ whiteSpace: 'nowrap' }}>
                      <Clock size={12} aria-hidden="true" />
                      {left ? `Ready in ${left}` : 'Sends in the next window'}
                    </span>
                  )}
                  {r.status === 'failed' && (
                    <span className="pill pill-danger" style={{ whiteSpace: 'nowrap' }}>
                      <AlertTriangle size={12} aria-hidden="true" /> Failed
                    </span>
                  )}
                  {r.status === 'canceled' && <span className="pill pill-muted">Canceled</span>}
                </div>

                <div className="queue-subject">{r.subject}</div>

                {r.error && r.status !== 'sent' && <div className="queue-error">{r.error}</div>}

                <div className="flex items-center gap-2" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                  {r.status === 'queued' && (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => setConfirmRow(r)}
                      >
                        <Send size={13} aria-hidden="true" /> Review &amp; send
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={busy}
                        onClick={() => void run(r.id, () => cancelQueued(r.id, r.contactId))}
                      >
                        <X size={13} aria-hidden="true" /> Cancel
                      </button>
                    </>
                  )}

                  {(r.status === 'sent' || r.status === 'failed' || r.status === 'canceled') && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => setConfirmRow(r)}
                    >
                      <RotateCcw size={13} aria-hidden="true" />{' '}
                      {r.status === 'sent' ? 'Send again' : 'Retry'}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>

        {/* Always rendered when there is anything at all, so the card's footer doesn't
            appear and disappear as you move between filters. */}
        {filtered.length > 0 && (
          <nav className="pager" style={{ marginTop: 12 }} aria-label="Send queue pages">
            <span className="muted-sm">
              {safePage * PAGE_SIZE + 1}–{Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)} of{' '}
              {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
              >
                Prev
              </button>
              <span className="muted-sm">
                {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
              >
                Next
              </button>
            </div>
          </nav>
        )}
      </div>

      {/* Every path that puts mail on the wire goes through the same preview — sending
          now, retrying, and sending again included. The row already stores the exact
          subject and body that will be used, so this shows the real message rather
          than a re-render that could have drifted from it. */}
      {confirmRow && (
        <QueuePreviewModal
          brand={confirmRow.brand}
          email={confirmRow.email}
          draft={{ subject: confirmRow.subject, body: confirmRow.body }}
          signatureSource={signatureSource}
          delayMinutes={confirmRow.status === 'queued' ? 0 : SEND_DELAY_MINUTES}
          busy={busyId === confirmRow.id}
          confirmLabel={confirmRow.status === 'queued' ? 'Send now' : 'Queue it'}
          onConfirm={() =>
            void run(confirmRow.id, () =>
              confirmRow.status === 'queued' ? sendQueuedNow(confirmRow.id) : requeue(confirmRow),
            )
          }
          onClose={() => setConfirmRow(null)}
        />
      )}
    </section>
  )
}
