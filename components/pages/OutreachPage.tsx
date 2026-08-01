'use client'

import { useMemo, useState } from 'react'
import { Plus, ShieldCheck, Info, ChevronLeft, ChevronRight } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@/lib/store'
import { StatsBar } from '@/components/StatsBar'
import { FilterBar, type Filters } from '@/components/FilterBar'
import { ContactsTable } from '@/components/ContactsTable'
import { ScrapeBrandsModal } from '@/components/admin/ScrapeBrandsModal'
import { SendQueuePanel } from '@/components/admin/SendQueuePanel'
import { useAdminResource, adminKeys } from '@/lib/admin/queries'
import { queueForOutreach, SEND_DELAY_MINUTES, type SendQueueRow } from '@/lib/admin/resources/sendQueue'
import type { SendingAccount } from '@/lib/admin/resources/sendingAccount'
import { buildDraft } from '@/lib/emailTemplate'
import { normalizeDomain } from '@/lib/brandDirectory'
import { QueuePreviewModal } from '@/components/admin/QueuePreviewModal'
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
  const [scraping, setScraping] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [queueError, setQueueError] = useState('')
  const [page, setPage] = useState(0)
  // The contact awaiting confirmation — queuing now shows the real email first.
  const [previewFor, setPreviewFor] = useState<Contact | null>(null)

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

  // Lets the brand picker grey out anything already scraped, so you can't spend a run
  // re-fetching a brand you already have.
  const existingDomains = useMemo(
    () => new Set(contacts.map((c) => normalizeDomain(c.website)).filter(Boolean)),
    [contacts],
  )

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

  async function confirmQueue(): Promise<void> {
    const c = previewFor
    if (!c) return
    setPendingId(c.id)
    setQueueError('')
    try {
      // The pitch is rendered NOW and stored on the row, so what sends in five
      // minutes is exactly what was previewed and approved — not whatever the
      // template happens to say by then.
      const draft = buildDraft(c, profile, emailTemplate)
      await queueForOutreach({ contactId: c.id, subject: draft.subject, body: draft.body })
      await qc.invalidateQueries({ queryKey: adminKeys.sendQueue })
      void hydrate()
      setPreviewFor(null)
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : 'Could not queue that contact.')
      setPreviewFor(null)
    } finally {
      setPendingId(null)
    }
  }

  // Filters changing can leave you stranded on a page that no longer exists.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  const capPct = `${Math.min(100, (sentToday / Math.max(1, dailyCap)) * 100)}%`

  return (
    <>
      <header className="main-head outreach-head">
        <div>
          <h1 className="page-title display">Outreach</h1>
          <p className="page-sub">
            Queue a brand and it sends in {SEND_DELAY_MINUTES} minutes — even if you close this tab.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setScraping(true)}
          title="Find brand contacts by scraping their sites"
          className="btn btn-ghost"
        >
          <Plus size={15} aria-hidden="true" /> Scrape new brands
        </button>
      </header>

      <div className="outreach-grid">
        {/* ── Left: the leads ─────────────────────────────────────────────── */}
        <div className="stack">
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

          <ContactsTable
            contacts={pageRows}
            totalCount={contacts.length}
            onQueue={(c) => setPreviewFor(c)}
            onSkip={(c) => setStatus(c.id, 'skip')}
            queuedContactIds={queuedContactIds}
            pendingId={pendingId}
            disabledReason={blockedReason}
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
              <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                <span className="muted-sm">Last 24 hours</span>
                <span className="muted-sm">
                  {sentToday} / {dailyCap}
                </span>
              </div>
              <div className="slider-track" style={{ position: 'relative', height: 6 }}>
                <div className="slider-fill" style={{ width: capPct, transition: 'width 0.3s' }} />
              </div>
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

      {previewFor && (
        <QueuePreviewModal
          brand={previewFor.brand}
          email={previewFor.email}
          draft={buildDraft(previewFor, profile, emailTemplate)}
          signatureSource={signatureSource}
          delayMinutes={SEND_DELAY_MINUTES}
          busy={pendingId !== null}
          onConfirm={() => void confirmQueue()}
          onClose={() => setPreviewFor(null)}
        />
      )}

      {scraping && (
        <ScrapeBrandsModal
          onClose={() => setScraping(false)}
          onScraped={() => void hydrate()}
          existingDomains={existingDomains}
        />
      )}
    </>
  )
}
