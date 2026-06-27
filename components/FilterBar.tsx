'use client'

import { Search } from 'lucide-react'
import type { ContactStatus } from '@/lib/types'

export interface Filters {
  search: string
  status: ContactStatus | 'all'
  country: string
  minFit: number
}

export function FilterBar({
  filters,
  setFilters,
  countries,
}: {
  filters: Filters
  setFilters: (f: Filters) => void
  countries: string[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--faint)' }}
        />
        <input
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          placeholder="Search brand or email…"
          aria-label="Search brand or email"
          className="input"
          style={{ paddingLeft: 36 }}
        />
      </div>

      <select
        value={filters.status}
        onChange={(e) => setFilters({ ...filters, status: e.target.value as Filters['status'] })}
        aria-label="Filter by status"
        className="select"
        style={{ width: 'auto' }}
      >
        <option value="all">All statuses</option>
        <option value="new">New</option>
        <option value="queued">Queued</option>
        <option value="sent">Sent</option>
        <option value="replied">Replied</option>
        <option value="skip">Skipped</option>
      </select>

      <select
        value={filters.country}
        onChange={(e) => setFilters({ ...filters, country: e.target.value })}
        aria-label="Filter by country"
        className="select"
        style={{ width: 'auto' }}
      >
        <option value="all">All countries</option>
        {countries.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        value={filters.minFit}
        onChange={(e) => setFilters({ ...filters, minFit: Number(e.target.value) })}
        aria-label="Filter by minimum fit score"
        className="select"
        style={{ width: 'auto' }}
      >
        <option value={0}>Any fit</option>
        <option value={6}>Fit ≥ 6</option>
        <option value={8}>Fit ≥ 8</option>
      </select>
    </div>
  )
}
