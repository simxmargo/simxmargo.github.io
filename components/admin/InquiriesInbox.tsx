'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Inbox,
  Archive,
  ArchiveRestore,
  Ban,
  Mail,
  MailOpen,
  Building2,
  Calendar,
  ChevronDown,
  ChevronRight,
  Wallet,
  Tag,
  AlertTriangle,
  CheckCheck,
  Undo2,
  Reply,
  X,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { updateInquiry, updateInquiries, setInquirySpam } from '@/lib/admin/resources/inquiries'
import { useAdminResource, adminKeys, AdminFetchError } from '@/lib/admin/queries'
import { ListSkeleton } from '@/components/admin/Skeleton'

// Triage inbox for the public "Work with me" form (collab_inquiries).
//
// ── Interaction model (replaced the per-row Status <select> in Jul 2026) ─────────
// A dropdown made you CLASSIFY a message; this makes you ACT on one. `status` is
// still the only column written — it's just derived from verbs now:
//
//   folder tabs   Inbox = new|read|replied · Archived = archived · Spam = spam
//   open a row  → 'new' becomes 'read' automatically (silent, optimistic)
//   ✉ toggle    → read ⇄ unread ('read'/'replied' ⇄ 'new')
//   Archive     → 'archived'      Spam → 'spam'      Restore → 'read'
//   Reply       → opens mailto: AND marks the row 'replied'
//
// Every destructive-feeling move (archive/spam/restore) offers Undo for 8s, so none
// of the one-click verbs need a confirm dialog.
//
// KNOWN TRADE-OFF: `status` is one column doing two jobs (folder + read-state), so
// archiving a never-opened message loses its unread flag — restoring brings it back
// as 'read'. Separating those needs a `read_at` column; not worth a migration on a
// table the public form writes to until unread-in-archive is actually wanted.
//
// Reads flow through the shared admin query cache (adminKeys.inquiries) via
// readInquiries → admin RLS SELECT. Writes are RLS-gated `is_admin()` PATCHes.

type InquiryStatus = 'new' | 'read' | 'replied' | 'archived' | 'spam'
type Folder = 'inbox' | 'archived' | 'spam'

interface Inquiry {
  id: string
  name: string
  email: string
  company: string
  budget: string
  message: string
  deliverables: string[]
  status: InquiryStatus
  created_at: string
}

interface UndoState {
  id: string
  from: InquiryStatus
  label: string
}

const FOLDERS: { key: Folder; label: string; icon: typeof Inbox }[] = [
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'archived', label: 'Archived', icon: Archive },
  { key: 'spam', label: 'Spam', icon: Ban },
]

const UNDO_MS = 8_000

// Which tab a row lives in. Everything that isn't explicitly filed sits in the Inbox,
// so a status value added later can never make a message invisible.
function folderOf(status: InquiryStatus): Folder {
  if (status === 'archived') return 'archived'
  if (status === 'spam') return 'spam'
  return 'inbox'
}

const isUnread = (r: Inquiry): boolean => r.status === 'new'

// SPAM IS SENDER-LEVEL (migration 0015). Marking spam calls `set_inquiry_spam`, which
// adds the address to `blocked_senders`, sweeps every message that sender has already
// sent, and — via a BEFORE INSERT trigger on collab_inquiries — routes their future
// mail straight to Spam without it ever touching the inbox. "Not spam" is the exact
// inverse. Matching is on the FULL address, never the domain.

// Date + time in the viewer's local timezone (created_at is stored UTC).
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function InquiriesInbox() {
  const qc = useQueryClient()
  const q = useAdminResource<Inquiry[]>('inquiries')

  const [folder, setFolder] = useState<Folder>('inbox')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [pending, setPending] = useState<Set<string>>(() => new Set())
  const [undo, setUndo] = useState<UndoState | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveBlocked, setSaveBlocked] = useState(false)

  const undoTimer = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    }
  }, [])

  // The query cache is the SINGLE source of truth — no local mirror of the rows.
  // Optimistic writes go through qc.setQueryData, so a failed PATCH rolls back to a
  // snapshot rather than racing a separate useState copy of the list.
  const rows = useMemo(() => (Array.isArray(q.data) ? q.data : []), [q.data])

  const counts = useMemo(() => {
    let unread = 0
    const byFolder: Record<Folder, number> = { inbox: 0, archived: 0, spam: 0 }
    for (const r of rows) {
      byFolder[folderOf(r.status)] += 1
      if (isUnread(r)) unread += 1
    }
    return { unread, byFolder }
  }, [rows])

  const visible = useMemo(() => rows.filter((r) => folderOf(r.status) === folder), [rows, folder])

  function showUndo(next: UndoState | null): void {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    setUndo(next)
    if (next) {
      undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS)
    }
  }

  function markPending(id: string, on: boolean): void {
    setPending((cur) => {
      const s = new Set(cur)
      if (on) s.add(id)
      else s.delete(id)
      return s
    })
  }

  function reportError(e: unknown): void {
    const msg = e instanceof Error ? e.message : 'Could not reach the server.'
    // supabaseBrowser is null when env isn't set → calm "blocked" banner, not an error.
    if (msg === 'Studio is not configured.') setSaveBlocked(true)
    else setSaveError(msg || 'Could not reach the server.')
  }

  // One optimistic status write. `undoLabel` opts the action into the Undo toast —
  // omitted for silent automations (auto-read on open) and for the undo itself.
  async function setStatus(id: string, next: InquiryStatus, undoLabel?: string): Promise<void> {
    const before = qc.getQueryData<Inquiry[]>(adminKeys.inquiries) ?? rows
    const row = before.find((r) => r.id === id)
    if (!row || row.status === next) return
    const from = row.status

    qc.setQueryData<Inquiry[]>(adminKeys.inquiries, (old) =>
      (old ?? []).map((r) => (r.id === id ? { ...r, status: next } : r)),
    )
    markPending(id, true)
    setSaveError(null)
    setSaveBlocked(false)

    // Spam transitions go through the RPC instead of a plain status write: they also
    // block (or unblock) the sender and sweep their other messages. That touches rows
    // beyond this one, so unlike every other action here the optimistic cache is NOT
    // the whole truth — refetch afterwards rather than just marking stale.
    const spamTransition = next === 'spam' || from === 'spam'

    try {
      if (spamTransition) {
        await setInquirySpam(id, next === 'spam')
        await qc.invalidateQueries({ queryKey: adminKeys.inquiries })
      } else {
        await updateInquiry(id, { status: next })
        // Mark stale WITHOUT refetching: the optimistic value is exactly what we just
        // wrote, and archiving three messages in a row shouldn't fire three list GETs.
        // The next mount (or a manual retry) reconciles with the server.
        void qc.invalidateQueries({ queryKey: adminKeys.inquiries, refetchType: 'none' })
      }
      if (undoLabel) showUndo({ id, from, label: undoLabel })
    } catch (e) {
      qc.setQueryData<Inquiry[]>(adminKeys.inquiries, (old) =>
        (old ?? []).map((r) => (r.id === id ? { ...r, status: from } : r)),
      )
      reportError(e)
    } finally {
      markPending(id, false)
    }
  }

  async function markAllRead(): Promise<void> {
    const ids = rows.filter(isUnread).map((r) => r.id)
    if (ids.length === 0) return
    const idSet = new Set(ids)

    qc.setQueryData<Inquiry[]>(adminKeys.inquiries, (old) =>
      (old ?? []).map((r) => (idSet.has(r.id) ? { ...r, status: 'read' as InquiryStatus } : r)),
    )
    setSaveError(null)
    setSaveBlocked(false)

    try {
      await updateInquiries(ids, { status: 'read' })
      void qc.invalidateQueries({ queryKey: adminKeys.inquiries, refetchType: 'none' })
    } catch (e) {
      // The batch is all-or-nothing, so restoring every touched row to 'new' is exact.
      qc.setQueryData<Inquiry[]>(adminKeys.inquiries, (old) =>
        (old ?? []).map((r) => (idSet.has(r.id) ? { ...r, status: 'new' as InquiryStatus } : r)),
      )
      reportError(e)
    }
  }

  // Opening a message IS reading it — the automation that replaced "set status to
  // Read" in the dropdown. Silent and optimistic: no spinner, no toast.
  function toggleExpand(row: Inquiry): void {
    const opening = expandedId !== row.id
    setExpandedId(opening ? row.id : null)
    if (opening && row.status === 'new') void setStatus(row.id, 'read')
  }

  function onUndo(): void {
    if (!undo) return
    void setStatus(undo.id, undo.from)
    showUndo(null)
  }

  // Reply is the one action that infers status from intent: handing the address to a
  // mail client is as close to "replied" as this app can observe. Recoverable — the
  // ✉ toggle sends it back to unread.
  function onReply(row: Inquiry): void {
    if (row.status !== 'archived' && row.status !== 'spam') void setStatus(row.id, 'replied')
  }

  const loading = q.isLoading
  const loadError = q.isError
    ? ((q.error as AdminFetchError | null)?.message ?? 'Could not reach the server.')
    : null

  return (
    <>
      <header className="main-head">
        <div>
          <h1 className="page-title display">Collaboration inquiries</h1>
          <p className="page-sub">
            Messages from your public media kit. Open one to read it, then archive or flag it in a click.
          </p>
        </div>
        {!loading && counts.unread > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void markAllRead()}>
            <CheckCheck size={14} aria-hidden="true" />
            Mark all read
          </button>
        )}
      </header>

      <div className="stack">
        {/* Folder tabs — the "where are my archives" answer. Always rendered once
            loaded (even when a folder is empty) so the archive is never hidden. */}
        {!loading && !loadError && rows.length > 0 && (
          <div className="inq-toolbar">
            <div className="seg" role="tablist" aria-label="Message folder">
              {FOLDERS.map(({ key, label, icon: Icon }) => {
                const active = folder === key
                // Only Inbox carries a badge, and only for UNREAD. A count on Archived
                // or Spam is a number you can do nothing about — it decorates a tab
                // rather than prompting anything, and it competes for attention with
                // the one count that does need acting on.
                const badge = key === 'inbox' ? counts.unread : 0
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    id={`folder-tab-${key}`}
                    aria-selected={active}
                    aria-controls="inquiry-folder-panel"
                    onClick={() => {
                      setFolder(key)
                      setExpandedId(null)
                    }}
                    className={`seg-btn${active ? ' active' : ''}`}
                  >
                    <Icon size={14} aria-hidden="true" />
                    {label}
                    {badge > 0 && (
                      <span className={`seg-count${key === 'inbox' ? ' is-unread' : ''}`}>{badge}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {saveBlocked && (
          <div className="banner banner-warn" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>Saving needs the studio Supabase environment variables to be set.</span>
          </div>
        )}

        {saveError && (
          <div className="banner banner-error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{saveError}</span>
          </div>
        )}

        {loadError && (
          <div className="banner banner-error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{loadError}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void q.refetch()}>
              Retry
            </button>
          </div>
        )}

        {loading && <ListSkeleton />}

        {/* Everything the folder tabs switch between lives in one labelled panel, so
            the tablist above actually controls something. Without aria-controls +
            a matching tabpanel, a screen reader announces "tab, selected" and then
            gives no way to reach what changed. */}
        <div
          id="inquiry-folder-panel"
          role="tabpanel"
          aria-labelledby={`folder-tab-${folder}`}
          className="space-y-5"
        >
        {!loading && !loadError && rows.length === 0 && (
          <div className="empty">
            <span
              className="flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: 'var(--field)', color: 'var(--faint)', margin: '0 auto 14px' }}
            >
              <Inbox size={22} />
            </span>
            <div>
              <p style={{ color: 'var(--ink)', fontWeight: 600, fontSize: 14.5 }}>No inquiries yet</p>
              <p style={{ marginTop: 6, color: 'var(--muted)' }}>
                Messages from your public &ldquo;Work with me&rdquo; form will appear here.
              </p>
            </div>
          </div>
        )}

        {/* An empty FOLDER (rows exist elsewhere) gets its own copy — "nothing here"
            reads very differently from "you have no messages at all". */}
        {!loading && !loadError && rows.length > 0 && visible.length === 0 && (
          <div className="empty">
            <p style={{ color: 'var(--ink)', fontWeight: 600, fontSize: 14.5 }}>
              {folder === 'inbox' ? 'Inbox zero' : folder === 'archived' ? 'Nothing archived' : 'No spam'}
            </p>
            <p style={{ marginTop: 6, color: 'var(--muted)' }}>
              {folder === 'inbox'
                ? 'Everything has been archived or filed.'
                : `Messages you send to ${folder === 'archived' ? 'the archive' : 'spam'} land here.`}
            </p>
          </div>
        )}

        {!loading && visible.length > 0 && (
          <ul className="space-y-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {visible.map((row) => {
              const expanded = expandedId === row.id
              const unread = isUnread(row)
              const busy = pending.has(row.id)
              return (
                <li key={row.id} className={`panel inq-item${unread ? ' inq-unread' : ''}`}>
                  {/* The expand toggle and the row actions are SIBLINGS, never nested:
                      a <button> inside a <button> is invalid HTML and breaks both
                      keyboard activation and screen-reader labelling. */}
                  <div className="inq-row">
                    <button
                      type="button"
                      onClick={() => toggleExpand(row)}
                      aria-expanded={expanded}
                      aria-controls={`inquiry-detail-${row.id}`}
                      className="inq-main"
                    >
                      <span style={{ color: 'var(--faint)', flex: 'none' }}>
                        {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </span>
                      <span className={`inq-dot${unread ? '' : ' is-read'}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="inq-name truncate">
                            {row.name}
                            {unread && <span className="sr-only"> (unread)</span>}
                          </span>
                          <span
                            className="inline-flex items-center gap-1 truncate"
                            style={{ fontSize: 13.5, color: 'var(--muted)' }}
                          >
                            <Mail size={13} className="shrink-0" style={{ color: 'var(--faint)' }} />
                            {row.email}
                          </span>
                          {row.status === 'replied' && <span className="pill pill-ok">Replied</span>}
                        </span>
                        <span
                          className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1"
                          style={{ fontSize: 12, color: 'var(--faint)' }}
                        >
                          {row.company && (
                            <span className="inline-flex items-center gap-1">
                              <Building2 size={12} className="shrink-0" />
                              {row.company}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <Calendar size={12} className="shrink-0" />
                            {formatDate(row.created_at)}
                          </span>
                        </span>
                      </span>
                    </button>

                    <div className="inq-actions">
                      <RowActions row={row} folder={folder} busy={busy} setStatus={setStatus} />
                    </div>
                  </div>

                  {expanded && (
                    <div
                      id={`inquiry-detail-${row.id}`}
                      className="space-y-4"
                      style={{
                        borderTop: '1px solid var(--line)',
                        background: 'var(--field)',
                        padding: '16px 18px',
                      }}
                    >
                      {row.budget && (
                        <div>
                          <div className="flabel">Budget</div>
                          <p
                            className="mt-1 inline-flex items-center gap-1.5"
                            style={{ fontSize: 14, color: 'var(--ink)' }}
                          >
                            <Wallet size={14} style={{ color: 'var(--faint)' }} />
                            {row.budget}
                          </p>
                        </div>
                      )}

                      {row.deliverables.length > 0 && (
                        <div>
                          <div className="flabel">Deliverables</div>
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            {row.deliverables.map((d, i) => (
                              <span key={`${row.id}-deliv-${i}`} className="tag inline-flex items-center gap-1">
                                <Tag size={11} style={{ color: 'var(--faint)' }} />
                                {d}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <div className="flabel">Message</div>
                        <p
                          className="mt-1 whitespace-pre-wrap"
                          style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink)' }}
                        >
                          {row.message}
                        </p>
                      </div>

                      <div
                        className="flex flex-wrap items-center gap-3"
                        style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}
                      >
                        <a
                          href={`mailto:${row.email}`}
                          className="btn btn-primary btn-sm"
                          style={{ minHeight: 40 }}
                          onClick={() => onReply(row)}
                        >
                          <Reply size={14} aria-hidden="true" />
                          Reply by email
                        </a>
                        <span className="ml-auto flex items-center gap-1">
                          <RowActions row={row} folder={folder} busy={busy} setStatus={setStatus} />
                        </span>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        </div>
      </div>

      {undo && (
        <div className="toast" role="status">
          <span>{undo.label}</span>
          <button type="button" className="toast-btn" onClick={onUndo}>
            <Undo2 size={14} aria-hidden="true" />
            Undo
          </button>
          <button type="button" className="icon-btn" onClick={() => showUndo(null)} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}
    </>
  )
}

// The verb buttons. Rendered twice per row (collapsed header + expanded footer) so the
// same action is always within reach; keeping them in one component means the two
// copies can never drift apart.
function RowActions({
  row,
  folder,
  busy,
  setStatus,
}: {
  row: Inquiry
  folder: Folder
  busy: boolean
  setStatus: (id: string, next: InquiryStatus, undoLabel?: string) => Promise<void>
}) {
  const unread = isUnread(row)

  if (folder === 'inbox') {
    return (
      <>
        <button
          type="button"
          className="icon-btn"
          disabled={busy}
          title={unread ? 'Mark as read' : 'Mark as unread'}
          aria-label={unread ? 'Mark as read' : 'Mark as unread'}
          onClick={() => void setStatus(row.id, unread ? 'read' : 'new')}
        >
          {unread ? <MailOpen size={16} /> : <Mail size={16} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={busy}
          title="Archive"
          aria-label="Archive"
          onClick={() => void setStatus(row.id, 'archived', 'Moved to Archived.')}
        >
          <Archive size={16} />
        </button>
        <button
          type="button"
          className="icon-btn danger"
          disabled={busy}
          title="Mark as spam — blocks this sender, so their existing and future messages go straight to Spam"
          aria-label="Mark as spam and block this sender"
          onClick={() => void setStatus(row.id, 'spam', 'Marked as spam.')}
        >
          <Ban size={16} />
        </button>
      </>
    )
  }

  // Archived / Spam: the useful verbs are "get it back" and (from the archive) "and
  // actually, it was junk".
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        disabled={busy}
        title="Move back to Inbox"
        aria-label="Move back to Inbox"
        onClick={() => void setStatus(row.id, 'read', 'Moved back to Inbox.')}
      >
        <ArchiveRestore size={16} />
      </button>
      {folder === 'archived' && (
        <button
          type="button"
          className="icon-btn danger"
          disabled={busy}
          title="Mark as spam — blocks this sender, so their existing and future messages go straight to Spam"
          aria-label="Mark as spam and block this sender"
          onClick={() => void setStatus(row.id, 'spam', 'Marked as spam.')}
        >
          <Ban size={16} />
        </button>
      )}
    </>
  )
}
