'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Plus,
  ShieldCheck,
  Info,
  ChevronLeft,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Send,
  X,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@/lib/store'
import { StatsBar } from '@/components/StatsBar'
import { FilterBar, type Filters } from '@/components/FilterBar'
import { ContactsTable } from '@/components/ContactsTable'
import { SendQueuePanel } from '@/components/admin/SendQueuePanel'
import { EmailTemplateEditor } from '@/components/admin/EmailTemplateEditor'
import { BulkQueueConfirm } from '@/components/admin/BulkQueueConfirm'
import { ScrapeRunPanel } from '@/components/admin/ScrapeRunPanel'
import { SCRAPE_BATCH, buildBatch, startScrapeRun, useScrapeRun } from '@/lib/admin/scrapeRun'
import { oneContactPerCompany } from '@/lib/admin/dedupeContacts'
import { useAdminResource, adminKeys } from '@/lib/admin/queries'
import { queueForOutreach, SEND_DELAY_MINUTES, type SendQueueRow } from '@/lib/admin/resources/sendQueue'
import { saveSettings } from '@/lib/admin/resources/settings'
import type { SendingAccount } from '@/lib/admin/resources/sendingAccount'
import { buildDraft } from '@/lib/emailTemplate'
import type { SignatureSource } from '@/lib/emailSignature'

const PAGE_SIZE = 10

interface ProfileShape {
  displayName?: string
  handle?: string
  replyToEmail?: string
  ogImageUrl?: string
  content?: Record<string, unknown>
}
import type { Contact } from '@/lib/types'

// The merged outreach workspace: leads on the left, what's going out on the right.
//
// Contacts and Send Queue used to be separate pages, which made the core loop —
// pick a brand, watch it send — a navigation round trip. Side by side, queuing a
// contact produces visible movement in the same viewport, so the consequence of the
// click is never off-screen.

export function OutreachPage() {
  const qc = useQueryClient()
  const { contacts, profile, emailTemplate, setStatus, hydrate, dailyCap, sentToday } = useStore()

  // Defaults to NEW: the job on this page is working through untouched leads, and a
  // list that opens on everything buries them under brands already dealt with.
  const [filters, setFilters] = useState<Filters>({ search: '', status: 'new', country: 'all' })
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [queueError, setQueueError] = useState('')
  const [page, setPage] = useState(0)

  // ── Bulk queue ───────────────────────────────────────────────────────────────
  // Selection deliberately SURVIVES paging (picking brands across pages then queuing
  // once is the point) but is cleared whenever the filters change — a selection that
  // refers to rows you can no longer see is how people mass-mail the wrong list.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null)
  const [bulkResult, setBulkResult] = useState('')
  const [confirmBulk, setConfirmBulk] = useState(false)

  useEffect(() => {
    setSelected(new Set())
    setBulkResult('')
  }, [filters.status, filters.country, filters.search])

  // ── Daily cap, moved here from Settings ──────────────────────────────────────
  // The floor is what has ALREADY gone out in the last 24 hours. A cap under that
  // would put the account instantly over its own limit and block every send, which
  // reads as a broken app rather than a setting someone chose.
  const capFloor = Math.max(1, sentToday)
  const capMax = Math.max(100, capFloor) // never let the floor exceed the ceiling
  const [capDraft, setCapDraft] = useState<number | null>(null)
  const [capSave, setCapSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [capError, setCapError] = useState('')
  // null draft = follow the store, so a save elsewhere still shows up here.
  const cap = Math.min(capMax, Math.max(capFloor, capDraft ?? dailyCap))

  const profileQ = useAdminResource<ProfileShape>('profile')
  const signatureSource: SignatureSource = useMemo(
    () => ({
      displayName: profileQ.data?.displayName ?? '',
      handle: profileQ.data?.handle ?? '',
      replyToEmail: profileQ.data?.replyToEmail ?? '',
      ogImageUrl: profileQ.data?.ogImageUrl ?? '',
      content: profileQ.data?.content ?? null,
    }),
    [profileQ.data],
  )

  const queueQ = useAdminResource<SendQueueRow[]>('sendQueue')
  const rows = useMemo(() => queueQ.data ?? [], [queueQ.data])

  // Contacts with a live row — drives the "Queued" state in the table.
  const queuedContactIds = useMemo(
    () => new Set(rows.filter((r) => r.status === 'queued' || r.status === 'sending').map((r) => r.contactId)),
    [rows],
  )

  const accountQ = useAdminResource<SendingAccount>('sendingAccount')
  const account = accountQ.data
  // Same gate the old Send Queue enforced: an account must exist AND have sent at
  // least once, so a brand can never be this account's first-ever recipient.
  const blockedReason = accountQ.isLoading
    ? ''
    : account?.connected !== true
      ? 'Connect a Gmail account in Settings before queuing outreach.'
      : !account.lastSendAt
        ? 'Send yourself a test email first (Settings → Sending account). Queuing unlocks once it lands.'
        : sentToday >= dailyCap
          ? `Daily cap reached — ${sentToday} of ${dailyCap} sent in the last 24 hours.`
          : ''

  const countries = useMemo(() => Array.from(new Set(contacts.map((c) => c.country))).sort(), [contacts])

  // Scrape state lives in its own store so a run survives switching admin tabs.
  const scrapePhase = useScrapeRun((s) => s.phase)
  const scrapeBusy = scrapePhase === 'scraping' || scrapePhase === 'finishing'

  const filtered = useMemo(() => {
    const q = filters.search.toLowerCase()
    return (
      contacts
        // 'all' means all ACTIVE. Archiving is a request to stop seeing a brand, so no
        // view except the explicit Archived filter brings it back.
        .filter((c) =>
          filters.status === 'all' ? c.status !== 'skip' : c.status === filters.status,
        )
        .filter((c) => filters.country === 'all' || c.country === filters.country)
        .filter((c) => !q || c.brand.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
        // Fit scores are never populated by the scraper, so sorting by them was a no-op
        // that just froze the order. Newest first is the useful default.
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    )
  }, [contacts, filters])

  // One click queues. There is no confirmation step because the 5-minute delay IS
  // the confirmation: the row lands in the queue on the right with a live countdown
  // and a Cancel button, in the same viewport as the button just pressed. A modal in
  // front of that asked people to approve the same email twice — and the queue card
  // is the honest place to catch a mistake, since it shows what will ACTUALLY send.
  async function queueContact(c: Contact): Promise<void> {
    setPendingId(c.id)
    setQueueError('')
    try {
      // The pitch is rendered NOW and stored on the row, so what goes out in five
      // minutes is exactly this — not whatever the template happens to say by then.
      const draft = buildDraft(c, profile, emailTemplate)
      await queueForOutreach({ contactId: c.id, subject: draft.subject, body: draft.body })
      await qc.invalidateQueries({ queryKey: adminKeys.sendQueue })
      void hydrate()
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : 'Could not queue that contact.')
    } finally {
      setPendingId(null)
    }
  }

  function toggleSelect(id: string): void {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function togglePage(ids: string[], select: boolean): void {
    setSelected((s) => {
      const next = new Set(s)
      for (const id of ids) if (select) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // Sequential, not Promise.all: each queue is a write plus a cap read, and firing
  // twenty at once would race the cap check and hammer the API for no gain. One
  // failure must not abandon the rest either — the loop records it and carries on.
  async function queueSelected(): Promise<void> {
    const targets = bulkTargets
    if (targets.length === 0) return

    setQueueError('')
    setBulkResult('')
    setBulk({ done: 0, total: targets.length })

    let queued = 0
    const failed: string[] = []
    for (const c of targets) {
      try {
        const draft = buildDraft(c, profile, emailTemplate)
        await queueForOutreach({ contactId: c.id, subject: draft.subject, body: draft.body })
        queued++
      } catch {
        failed.push(c.brand)
      }
      setBulk((b) => (b ? { ...b, done: b.done + 1 } : b))
    }

    await qc.invalidateQueries({ queryKey: adminKeys.sendQueue })
    void hydrate()
    setSelected(new Set())
    setBulk(null)
    setConfirmBulk(false)
    setBulkResult(
      failed.length === 0
        ? `Queued ${queued} brand${queued === 1 ? '' : 's'}.`
        : `Queued ${queued} of ${targets.length}. Failed: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`,
    )
  }

  // Committed on release rather than on every change: an <input type="range"> fires
  // onChange for each step, which would be one write per pixel dragged.
  async function commitCap(): Promise<void> {
    if (capDraft === null || cap === dailyCap) {
      setCapDraft(null)
      return
    }
    setCapSave('saving')
    setCapError('')
    try {
      await saveSettings({ dailyCap: cap })
      await qc.invalidateQueries({ queryKey: adminKeys.settings })
      await hydrate() // refreshes dailyCap + the blocked-reason gate below
      setCapDraft(null)
      setCapSave('saved')
    } catch (e) {
      setCapError(e instanceof Error ? e.message : 'Could not save the cap.')
      setCapSave('error')
    }
  }

  // Filters changing can leave you stranded on a page that no longer exists.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  // Two different bars: how much of the cap is spent, and where the cap itself sits.
  const usagePct = `${Math.min(100, (sentToday / Math.max(1, cap)) * 100)}%`
  const capThumbPct = `${capMax > capFloor ? ((cap - capFloor) / (capMax - capFloor)) * 100 : 100}%`

  const selectedCount = selected.size
  // Selection can outlive a queue action (rows queued elsewhere, or paging), so the
  // targets are recomputed rather than trusted — the confirm must list exactly what
  // will be queued, not what was ticked at some earlier point.
  // One address per company. A brand's contact page often yields several (meandem.com
  // produced 21, one per store), and queueing all of them pitches the same company
  // repeatedly — sendPitch would refuse the extras, but only after they were queued.
  const { picked: bulkTargets, skipped: bulkDuplicates } = useMemo(
    () =>
      oneContactPerCompany(
        contacts.filter((c) => selected.has(c.id) && !queuedContactIds.has(c.id)),
      ),
    [contacts, selected, queuedContactIds],
  )
  // Queuing past the cap isn't blocked — drain-queue defers those rows by 30 minutes
  // rather than failing them — but saying so up front beats a queue that looks stuck.
  const remainingToday = Math.max(0, cap - sentToday)

  return (
    <>
      <header className="main-head outreach-head">
        <div>
          <h1 className="page-title display">Outreach</h1>
          <p className="page-sub">
            Queue a brand and it sends in {SEND_DELAY_MINUTES} minutes — even if you close this tab.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* One click, no dialog: discovery finds the brands, the server crawls them.
              Progress shows in the collapsed row below, and you can keep queueing
              while it runs. */}
          <button
            type="button"
            onClick={() => void startScrapeRun(() => buildBatch(), () => void hydrate())}
            disabled={scrapeBusy}
            title={`Find ${SCRAPE_BATCH} new brands on Instagram and collect their contact addresses`}
            className="btn btn-primary"
          >
            {scrapeBusy ? (
              <>
                <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Scraping…
              </>
            ) : (
              <>
                <Plus size={15} aria-hidden="true" /> Scrape new brands
              </>
            )}
          </button>
        </div>
      </header>

      <div className="outreach-grid">
        {/* ── Left: the leads ─────────────────────────────────────────────── */}
        <div className="stack outreach-main">
          <StatsBar
            contacts={contacts}
            active={filters.status}
            onSelect={(status) => {
              setFilters({ ...filters, status })
              setPage(0) // a new filter with fewer results must not land you on a dead page
            }}
          />
          <FilterBar filters={filters} setFilters={setFilters} countries={countries} />

          {blockedReason && (
            <div className="banner banner-warn" role="status">
              <Info size={18} aria-hidden="true" />
              <span>{blockedReason}</span>
            </div>
          )}
          {queueError && (
            <div className="banner banner-error" role="alert">
              <Info size={18} aria-hidden="true" />
              <span>{queueError}</span>
            </div>
          )}

          <ScrapeRunPanel />

          {bulkResult && (
            <div className="banner" role="status">
              <CheckCircle2 size={18} aria-hidden="true" />
              <span>{bulkResult}</span>
            </div>
          )}

          {/* Only appears once rows are ticked, so it can't be hit by accident — and it
              names the count, because "Queue 12" is a very different click to "Queue". */}
          {selectedCount > 0 && (
            <div className="bulk-bar" role="region" aria-label="Bulk actions">
              <span className="bulk-count">
                {selectedCount} selected
                {bulkDuplicates.length > 0 && (
                  <span className="muted-sm">
                    {' '}
                    · {bulkDuplicates.length} duplicate{bulkDuplicates.length === 1 ? '' : 's'} skipped
                  </span>
                )}
                {bulkTargets.length > remainingToday && (
                  <span className="muted-sm">
                    {' '}
                    · {remainingToday} can go out today, the rest wait
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                {/* Opens a confirm rather than queuing straight away — see
                    BulkQueueConfirm for why bulk is the one action that still asks. */}
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setConfirmBulk(true)}
                  disabled={bulk !== null || bulkTargets.length === 0 || Boolean(blockedReason)}
                  title={blockedReason || `Queue ${bulkTargets.length} brand${bulkTargets.length === 1 ? '' : 's'}`}
                >
                  <Send size={13} aria-hidden="true" /> Queue {bulkTargets.length}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelected(new Set())}
                  disabled={bulk !== null}
                >
                  <X size={13} aria-hidden="true" /> Clear
                </button>
              </div>
            </div>
          )}

          <ContactsTable
            contacts={pageRows}
            totalCount={contacts.length}
            onQueue={(c) => void queueContact(c)}
            onSkip={(c) => setStatus(c.id, 'skip')}
            queuedContactIds={queuedContactIds}
            pendingId={pendingId}
            disabledReason={blockedReason}
            selectedIds={selected}
            onToggleSelect={toggleSelect}
            onTogglePage={togglePage}
          />

          {filtered.length > PAGE_SIZE && (
            <nav className="pager" aria-label="Contacts pages">
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
                  aria-label="Previous page"
                >
                  <ChevronLeft size={14} aria-hidden="true" /> Prev
                </button>
                <span className="muted-sm">
                  Page {safePage + 1} of {pageCount}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={safePage >= pageCount - 1}
                  aria-label="Next page"
                >
                  Next <ChevronRight size={14} aria-hidden="true" />
                </button>
              </div>
            </nav>
          )}
        </div>

        {/* ── Right: what's going out ─────────────────────────────────────── */}
        <div className="stack outreach-side">
          <section className="card">
            <div className="card-head">
              <span className="ico-badge">
                <ShieldCheck size={18} aria-hidden="true" />
              </span>
              <h2 className="card-title">Daily cap</h2>
            </div>
            <div className="card-body">
              {/* Consumption — read-only. */}
              <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                <span className="muted-sm">Last 24 hours</span>
                <span className="muted-sm">
                  {sentToday} / {cap}
                </span>
              </div>
              <div className="slider-track" style={{ position: 'relative', height: 6 }}>
                <div className="slider-fill" style={{ width: usagePct, transition: 'width 0.3s' }} />
              </div>

              {/* The control — a separate row so "how much is spent" and "what the
                  ceiling is" never read as the same bar. */}
              <div
                className="flex items-center justify-between"
                style={{ marginTop: 20, marginBottom: 2 }}
              >
                <label htmlFor="daily-cap" className="muted-sm">
                  Send cap
                </label>
                <span style={{ fontSize: 14.5, fontWeight: 600 }}>{cap}</span>
              </div>
              <div className="slider">
                <div className="slider-track">
                  <div className="slider-fill" style={{ width: capThumbPct }} />
                </div>
                <div className="slider-thumb" style={{ left: capThumbPct }} />
                <input
                  id="daily-cap"
                  className="slider-input"
                  type="range"
                  min={capFloor}
                  max={capMax}
                  value={cap}
                  onChange={(e) => {
                    setCapDraft(Number(e.target.value))
                    if (capSave !== 'idle') setCapSave('idle')
                  }}
                  onPointerUp={() => void commitCap()}
                  onKeyUp={() => void commitCap()}
                  onBlur={() => void commitCap()}
                  aria-label="Daily send cap"
                  aria-describedby="cap-hint"
                />
              </div>
              <div className="flex justify-between" style={{ marginTop: 8 }}>
                <span className="muted-sm">{capFloor}</span>
                <span className="muted-sm">{capMax}</span>
              </div>

              <p id="cap-hint" className="field-hint hint-icon" style={{ marginTop: 12 }}>
                <Info size={12} aria-hidden="true" />
                <span>
                  {sentToday > 0
                    ? `Can’t go below ${sentToday} — that’s already gone out in the last 24 hours.`
                    : 'Start low and ramp slowly to keep your sending account healthy.'}
                </span>
              </p>

              {capSave === 'saving' && (
                <p className="field-hint hint-icon" style={{ marginTop: 6 }}>
                  <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                  <span>Saving…</span>
                </p>
              )}
              {capSave === 'saved' && (
                <p className="field-hint hint-ok" style={{ marginTop: 6 }} role="status">
                  <CheckCircle2 size={12} aria-hidden="true" /> Saved
                </p>
              )}
              {capSave === 'error' && (
                <p className="field-hint hint-warn" style={{ marginTop: 6 }} role="alert">
                  <AlertTriangle size={12} aria-hidden="true" /> {capError}
                </p>
              )}
            </div>
          </section>

          <SendQueuePanel
            rows={rows}
            loading={queueQ.isLoading}
            signatureSource={signatureSource}
            onChanged={() => void hydrate()}
          />
        </div>
      </div>

      {/* The pitch every brand above receives, edited on the page it sends from —
          it used to live in Settings, two clicks away from the button that uses it. */}
      <div className="outreach-foot">
        <EmailTemplateEditor />
      </div>

      {confirmBulk && bulkTargets.length > 0 && (
        <BulkQueueConfirm
          contacts={bulkTargets}
          remainingToday={remainingToday}
          progress={bulk}
          onConfirm={() => void queueSelected()}
          onClose={() => setConfirmBulk(false)}
        />
      )}

    </>
  )
}
