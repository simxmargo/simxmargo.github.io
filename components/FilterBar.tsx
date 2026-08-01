'use client'

import { Search } from 'lucide-react'
import type { ContactStatus } from '@/lib/types'

export interface Filters {
  search: string
  /** 'all' means every status EXCEPT archived — see OutreachPage. */
  status: ContactStatus | 'all'
  country: string
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

      {/* Status lives on the stat tiles above — the counts and the control that acts
          on them were two widgets saying the same thing. See StatsBar. */}
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

      {/* The fit filter is gone with the Fit column — the AI qualifier never scores
          these leads, so it only ever offered a way to hide all of them. */}
    </div>
  )
}
