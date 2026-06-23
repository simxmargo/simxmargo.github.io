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
import { adminFetch } from '@/lib/adminClient'

// Triage inbox for the public "Work with me" form (collab_inquiries).
// GET /api/admin/inquiries on mount; PATCH { id, status } per row.
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

const STATUS_OPTIONS: { value: InquiryStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'read', label: 'Read' },
  { value: 'replied', label: 'Replied' },
  { value: 'archived', label: 'Archived' },
  { value: 'spam', label: 'Spam' },
]

// Pill colours per status (light theme).
const STATUS_PILL: Record<InquiryStatus, string> = {
  new: 'bg-plum-50 text-plum-700 ring-1 ring-plum-100',
  read: 'bg-stone-100 text-stone-600 ring-1 ring-stone-200',
  replied: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  archived: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
  spam: 'bg-rose-50 text-rose-700 ring-1 ring-rose-100',
}

const card = 'rounded-xl border border-stone-200 bg-white p-5'
const label = 'text-xs font-medium uppercase tracking-wide text-stone-400'
const selectCls =
  'rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-plum-500 focus:outline-none focus:ring-1 focus:ring-plum-500'

function statusLabel(s: InquiryStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function InquiriesInbox() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null) // service-role-required hint from GET
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saveBlocked, setSaveBlocked] = useState<boolean>(false) // PATCH 503
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      setLoading(true)
      setLoadError(null)
      setNote(null)
      try {
        const res = await adminFetch('/api/admin/inquiries')
        const payload = (await res.json().catch(() => ({}))) as {
          data?: Inquiry[]
          note?: string
          error?: string
        }
        if (cancelled) return
        if (!res.ok) {
          setLoadError(payload.error ?? `Failed to load inquiries (${res.status}).`)
          setInquiries([])
          return
        }
        // GET may return { note } (service-role required) instead of rows.
        if (payload.note) {
          setNote(payload.note)
          setInquiries([])
          return
        }
        setInquiries(Array.isArray(payload.data) ? payload.data : [])
      } catch (e) {
        if (cancelled) return
        setLoadError((e as Error).message || 'Could not reach the server.')
        setInquiries([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

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
    <div className="space-y-6">
      {/* Heading */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-stone-900">Collaboration inquiries</h1>
          <p className="text-sm text-stone-500">
            Triage messages from your public media kit — read, reply, archive, or flag spam.
          </p>
        </div>
        {!loading && !note && inquiries.length > 0 && (
          <span className="shrink-0 rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-500">
            {inquiries.length} {inquiries.length === 1 ? 'inquiry' : 'inquiries'}
          </span>
        )}
      </div>

      {/* PATCH 503 — calm amber banner */}
      {saveBlocked && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>Saving needs SUPABASE_SERVICE_ROLE_KEY set on the server.</span>
        </div>
      )}

      {/* PATCH other error */}
      {saveError && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      {/* GET error */}
      {loadError && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className={`${card} flex items-center gap-3 text-sm text-stone-500`}>
          <Loader2 size={18} className="animate-spin text-plum-500" />
          Loading inquiries…
        </div>
      )}

      {/* Empty state (no rows, or service-role required) */}
      {!loading && !loadError && inquiries.length === 0 && (
        <div className={`${card} flex flex-col items-center gap-3 py-12 text-center`}>
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-400">
            <Inbox size={22} />
          </span>
          <div>
            <p className="text-sm font-medium text-stone-700">No inquiries yet</p>
            <p className="mt-1 text-sm text-stone-500">
              Messages from your public &ldquo;Work with me&rdquo; form will appear here.
            </p>
          </div>
          {note && (
            <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle size={16} className="shrink-0" />
              Reading inquiries needs SUPABASE_SERVICE_ROLE_KEY.
            </p>
          )}
        </div>
      )}

      {/* Triage list */}
      {!loading && inquiries.length > 0 && (
        <ul className="space-y-3">
          {inquiries.map((q) => {
            const expanded = expandedId === q.id
            return (
              <li key={q.id} className="overflow-hidden rounded-xl border border-stone-200 bg-white">
                {/* Row header — click to expand */}
                <button
                  type="button"
                  onClick={() => toggleExpand(q.id)}
                  aria-expanded={expanded}
                  aria-controls={`inquiry-detail-${q.id}`}
                  className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left transition hover:bg-stone-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-plum-500"
                >
                  <span className="text-stone-300">
                    {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="truncate text-sm font-medium text-stone-900">{q.name}</span>
                      <span className="inline-flex items-center gap-1 truncate text-sm text-stone-500">
                        <Mail size={13} className="shrink-0 text-stone-400" />
                        {q.email}
                      </span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-400">
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
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_PILL[q.status]}`}
                  >
                    {statusLabel(q.status)}
                  </span>
                </button>

                {/* Expanded detail */}
                {expanded && (
                  <div
                    id={`inquiry-detail-${q.id}`}
                    className="space-y-4 border-t border-stone-100 bg-stone-50/60 px-5 py-4"
                  >
                    {q.budget && (
                      <div>
                        <div className={label}>Budget</div>
                        <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-stone-700">
                          <Wallet size={14} className="text-stone-400" />
                          {q.budget}
                        </p>
                      </div>
                    )}

                    {q.deliverables.length > 0 && (
                      <div>
                        <div className={label}>Deliverables</div>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {q.deliverables.map((d, i) => (
                            <span
                              key={`${q.id}-deliv-${i}`}
                              className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-stone-600 ring-1 ring-stone-200"
                            >
                              <Tag size={11} className="text-stone-400" />
                              {d}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <div className={label}>Message</div>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">
                        {q.message}
                      </p>
                    </div>

                    {/* Status control */}
                    <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 pt-4">
                      <label
                        htmlFor={`status-${q.id}`}
                        className="text-xs font-medium uppercase tracking-wide text-stone-400"
                      >
                        Status
                      </label>
                      <select
                        id={`status-${q.id}`}
                        value={q.status}
                        disabled={savingId === q.id}
                        onChange={(e) => void updateStatus(q.id, e.target.value as InquiryStatus)}
                        className={`${selectCls} min-h-[44px] cursor-pointer disabled:opacity-50`}
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {savingId === q.id && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-stone-500">
                          <Loader2 size={14} className="animate-spin text-plum-500" />
                          Saving…
                        </span>
                      )}
                      {savedId === q.id && savingId !== q.id && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                          <CheckCircle2 size={14} />
                          Saved
                        </span>
                      )}
                      <a
                        href={`mailto:${q.email}`}
                        className="ml-auto inline-flex min-h-[44px] cursor-pointer items-center rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 transition hover:bg-stone-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-plum-500"
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
  )
}
