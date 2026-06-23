'use client'

import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useStore } from '@/lib/store'
import { StatsBar } from '@/components/StatsBar'
import { FilterBar, type Filters } from '@/components/FilterBar'
import { ContactsTable } from '@/components/ContactsTable'
import { ComposeDrawer } from '@/components/ComposeDrawer'
import type { Contact } from '@/lib/types'

export function ContactsPage() {
  const { contacts, profile, setStatus, queueDraft } = useStore()
  const [filters, setFilters] = useState<Filters>({ search: '', status: 'all', country: 'all', minFit: 0 })
  const [drafting, setDrafting] = useState<Contact | null>(null)

  const countries = useMemo(
    () => Array.from(new Set(contacts.map((c) => c.country))).sort(),
    [contacts],
  )

  const filtered = useMemo(() => {
    const q = filters.search.toLowerCase()
    return contacts
      .filter((c) => filters.status === 'all' || c.status === filters.status)
      .filter((c) => filters.country === 'all' || c.country === filters.country)
      .filter((c) => (c.fitScore ?? 0) >= filters.minFit)
      .filter((c) => !q || c.brand.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
      .sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0))
  }, [contacts, filters])

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-stone-900">Contacts</h1>
          <p className="text-sm text-stone-500">
            Brand leads to pitch, ranked by fit. Draft an email, then review it in the queue.
          </p>
        </div>
        {/* TODO(studio-backend): wire to the scrape + enrich Edge Function. */}
        <button
          disabled
          title="Backend pending — see docs/BACKEND_DESIGN.md"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-400"
        >
          <Plus size={15} /> Scrape new brands
        </button>
      </div>

      <StatsBar contacts={contacts} />
      <FilterBar filters={filters} setFilters={setFilters} countries={countries} />
      <ContactsTable
        contacts={filtered}
        onDraft={setDrafting}
        onSkip={(c) => setStatus(c.id, 'skip')}
      />

      <ComposeDrawer
        contact={drafting}
        profile={profile}
        onClose={() => setDrafting(null)}
        onQueue={(subject, body) => {
          if (drafting) queueDraft(drafting.id, subject, body)
          setDrafting(null)
        }}
      />
    </div>
  )
}
