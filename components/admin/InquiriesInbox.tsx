'use client'

import { useEffect, useState } from 'react'
import {
  Inbox,
  Mail,
  Building2,
  Calendar,
  ChevronDown,
  ChevronRight,
  Wallet,
  Tag,
  AlertTriangle,
  Loader2,
  CheckCircle2,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { adminFetch } from '@/lib/adminClient'
import { useAdminResource, adminKeys, AdminFetchError } from '@/lib/admin/queries'
import { ListSkeleton } from '@/components/admin/Skeleton'

// Triage inbox for the public "Work with me" form (collab_inquiries).
// Reads via the shared admin query cache (key adminKeys.inquiries); PATCH { id, status } per row.
// Reads/writes both need SUPABASE_SERVICE_ROLE_KEY on the server:
//  - GET may return { note } instead of { data } → friendly empty state + amber line.
//  - PATCH may 503 (key unset) → calm amber banner.

type InquiryStatus = 'new' | 'read' | 'replied' | 'archived' | 'spam'

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

// Shape parsed from GET /api/admin/inquiries (the same wrapper the old fetch read).
interface InquiriesResponse {
  data?: Inquiry[]
  note?: string
}

const STATUS_OPTIONS: { value: InquiryStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'read', label: 'Read' },
  { value: 'replied', label: 'Replied' },
  { value: 'archived', label: 'Archived' },
  { value: 'spam', label: 'Spam' },
]

// Status → editorial pill variant (dark studio).
const STATUS_PILL: Record<InquiryStatus, string> = {
  new: 'pill pill-accent',
  read: 'pill',
  replied: 'pill pill-ok',
  archived: 'pill',
  spam: 'pill pill-danger',
}

function statusLabel(s: InquiryStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function InquiriesInbox() {
  const qc = useQueryClient()
  const q = useAdminResource<InquiriesResponse>('inquiries')

  const [inquiries, setInquiries] = useState<Inquiry[]>([])
  const [note, setNote] = useState<string | null>(null) // service-role-required hint from GET
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saveBlocked, setSaveBlocked] = useState<boolean>(false) // PATCH 503
  const [saveError, setSaveError] = useState<string | null>(null)

  // Seed local editable state from cached query data. q.data is a stable reference
  // while cached, so this runs only on first load + after an invalidation — the
  // same parse the old fetch's .then ran (note → empty + amber; else rows).
  useEffect(() => {
    if (!q.data) return
    const payload = q.data
    // GET may return { note } (service-role required) instead of rows.
    if (payload.note) {
      setNote(payload.note)
      setInquiries([])
      return
    }
    setNote(null)
    setInquiries(Array.isArray(payload.data) ? payload.data : [])
  }, [q.data])

  const loading = q.isLoading
  const loadError = q.isError
    ? (q.error as AdminFetchError | null)?.message ?? 'Could not reach the server.'
    : null

  async function updateStatus(id: string, status: InquiryStatus): Promise<void> {
    const prev = inquiries.find((q) => q.id === id)?.status
    if (prev === status) return

    // Optimistic local update.
    setInquiries((list) => list.map((q) => (q.id === id ? { ...q, status } : q)))
    setSavingId(id)
    setSavedId(null)
    setSaveBlocked(false)
    setSaveError(null)

    try {
      const res = await adminFetch('/api/admin/inquiries', {
        method: 'PATCH',
        body: JSON.stringify({ id, status }),
      })
      if (res.status === 503) {
        setSaveBlocked(true)
        // Roll back the optimistic change — the write did not land.
        if (prev) setInquiries((list) => list.map((q) => (q.id === id ? { ...q, status: prev } : q)))
        return
      }
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        setSaveError(payload.error ?? `Could not save (${res.status}).`)
        if (prev) setInquiries((list) => list.map((q) => (q.id === id ? { ...q, status: prev } : q)))
        return
      }
      setSavedId(id)
      window.setTimeout(() => {
        setSavedId((cur) => (cur === id ? null : cur))
      }, 2000)
      // Reconcile the shared cache with the server after a successful write.
      void qc.invalidateQueries({ queryKey: adminKeys.inquiries })
    } catch (e) {
      setSaveError((e as Error).message || 'Could not reach the server.')
      if (prev) setInquiries((list) => list.map((q) => (q.id === id ? { ...q, status: prev } : q)))
    } finally {
      setSavingId((cur) => (cur === id ? null : cur))
    }
  }

  function toggleExpand(id: string): void {
    setExpandedId((cur) => (cur === id ? null : id))
  }

  return (
    <>
      {/* Heading */}
      <header className="main-head">
        <div>
          <h1 className="page-title display">Collaboration inquiries</h1>
          <p className="page-sub">
            Triage messages from your public media kit — read, reply, archive, or flag spam.
          </p>
        </div>
        {!loading && !note && inquiries.length > 0 && (
          <span className="chip">
            {inquiries.length} {inquiries.length === 1 ? 'inquiry' : 'inquiries'}
          </span>
        )}
      </header>

      <div className="stack">
        {/* PATCH 503 — calm amber banner */}
        {saveBlocked && (
          <div className="banner banner-warn">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>Saving needs SUPABASE_SERVICE_ROLE_KEY set on the server.</span>
          </div>
        )}

        {/* PATCH other error */}
        {saveError && (
          <div className="banner banner-error">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{saveError}</span>
          </div>
        )}

        {/* GET error */}
        {loadError && (
          <div className="banner banner-error">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{loadError}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void q.refetch()}>
              Retry
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && <ListSkeleton />}

        {/* Empty state (no rows, or service-role required) */}
        {!loading && !loadError && inquiries.length === 0 && (
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
            {note && (
              <p
                className="inline-flex items-center gap-2 banner banner-warn"
                style={{ marginTop: 16, justifyContent: 'center' }}
              >
                <AlertTriangle size={16} aria-hidden="true" />
                Reading inquiries needs SUPABASE_SERVICE_ROLE_KEY.
              </p>
            )}
          </div>
        )}

        {/* Triage list */}
        {!loading && inquiries.length > 0 && (
          <ul className="space-y-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {inquiries.map((q) => {
              const expanded = expandedId === q.id
              return (
                <li key={q.id} className="panel">
                  {/* Row header — click to expand */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(q.id)}
                    aria-expanded={expanded}
                    aria-controls={`inquiry-detail-${q.id}`}
                    className="flex w-full cursor-pointer items-center gap-3 text-left"
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '16px 18px',
                      fontFamily: 'inherit',
                      color: 'var(--ink)',
                    }}
                  >
                    <span style={{ color: 'var(--faint)' }}>
                      {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="truncate" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                          {q.name}
                        </span>
                        <span
                          className="inline-flex items-center gap-1 truncate"
                          style={{ fontSize: 13.5, color: 'var(--muted)' }}
                        >
                          <Mail size={13} className="shrink-0" style={{ color: 'var(--faint)' }} />
                          {q.email}
                        </span>
                      </span>
                      <span
                        className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1"
                        style={{ fontSize: 12, color: 'var(--faint)' }}
                      >
                        {q.company && (
                          <span className="inline-flex items-center gap-1">
                            <Building2 size={12} className="shrink-0" />
                            {q.company}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Calendar size={12} className="shrink-0" />
                          {formatDate(q.created_at)}
                        </span>
                      </span>
                    </span>
                    <span className={`shrink-0 ${STATUS_PILL[q.status]}`}>{statusLabel(q.status)}</span>
                  </button>

                  {/* Expanded detail */}
                  {expanded && (
                    <div
                      id={`inquiry-detail-${q.id}`}
                      className="space-y-4"
                      style={{
                        borderTop: '1px solid var(--line)',
                        background: 'var(--field)',
                        padding: '16px 18px',
                      }}
                    >
                      {q.budget && (
                        <div>
                          <div className="flabel">Budget</div>
                          <p
                            className="mt-1 inline-flex items-center gap-1.5"
                            style={{ fontSize: 14, color: 'var(--ink)' }}
                          >
                            <Wallet size={14} style={{ color: 'var(--faint)' }} />
                            {q.budget}
                          </p>
                        </div>
                      )}

                      {q.deliverables.length > 0 && (
                        <div>
                          <div className="flabel">Deliverables</div>
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            {q.deliverables.map((d, i) => (
                              <span key={`${q.id}-deliv-${i}`} className="tag inline-flex items-center gap-1">
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
                          {q.message}
                        </p>
                      </div>

                      {/* Status control */}
                      <div
                        className="flex flex-wrap items-center gap-3"
                        style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}
                      >
                        <label htmlFor={`status-${q.id}`} className="flabel">
                          Status
                        </label>
                        <select
                          id={`status-${q.id}`}
                          value={q.status}
                          disabled={savingId === q.id}
                          onChange={(e) => void updateStatus(q.id, e.target.value as InquiryStatus)}
                          className="select cursor-pointer disabled:opacity-50"
                          style={{ width: 'auto', minHeight: 44 }}
                        >
                          {STATUS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {savingId === q.id && (
                          <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--muted)' }}>
                            <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />
                            Saving…
                          </span>
                        )}
                        {savedId === q.id && savingId !== q.id && (
                          <span className="save-ok">
                            <CheckCircle2 size={14} />
                            Saved
                          </span>
                        )}
                        <a
                          href={`mailto:${q.email}`}
                          className="btn btn-ghost btn-sm ml-auto"
                          style={{ minHeight: 44 }}
                        >
                          Reply by email
                        </a>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
