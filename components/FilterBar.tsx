'use client'

import { Search } from 'lucide-react'
import type { ContactStatus } from '@/lib/types'

export interface Filters {
  search: string
  status: ContactStatus | 'all'
  country: string
  minFit: number
}

const SELECT = 'rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:border-plum-500 focus:outline-none focus:ring-1 focus:ring-plum-500'

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
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <input
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          placeholder="Search brand or email…"
          className="w-full rounded-lg border border-stone-200 bg-white py-2 pl-9 pr-3 text-sm text-stone-700 placeholder:text-stone-400 focus:border-plum-500 focus:outline-none focus:ring-1 focus:ring-plum-500"
        />
      </div>

      <select
        value={filters.status}
        onChange={(e) => setFilters({ ...filters, status: e.target.value as Filters['status'] })}
        className={SELECT}
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
        className={SELECT}
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
        className={SELECT}
      >
        <option value={0}>Any fit</option>
        <option value={6}>Fit ≥ 6</option>
        <option value={8}>Fit ≥ 8</option>
      </select>
    </div>
  )
}
