'use client'

import { Users, Sparkles, Clock, Send, MessageSquare, Archive } from 'lucide-react'
import type { Contact } from '@/lib/types'
import type { Filters } from './FilterBar'

// The outreach funnel — and the status filter itself.
//
// These used to be read-only tiles sitting above a separate status dropdown, which
// meant the counts and the control that acted on them were two different widgets
// saying the same thing. You'd read "Queued 1" and then hunt for "Queued" in a select.
// The number IS the filter now: one glance, one click, and the tile's pressed state
// tells you what you're looking at.
//
// Archived earns a tile for a reason beyond symmetry — with the dropdown gone it would
// otherwise have no route back, making archiving a one-way door.

export function StatsBar({
  contacts,
  active,
  onSelect,
}: {
  contacts: Contact[]
  active: Filters['status']
  onSelect: (status: Filters['status']) => void
}) {
  const count = (pred: (c: Contact) => boolean) => contacts.filter(pred).length
  // Everything except archived — the denominator for every share below, and what
  // "Active" actually shows when clicked.
  const activeTotal = count((c) => c.status !== 'skip')

  const stats: {
    label: string
    value: number
    tone: string
    icon: typeof Users
    filter: Filters['status']
    isTotal?: boolean
  }[] = [
    { label: 'Active', value: activeTotal, tone: 'var(--ink)', icon: Users, filter: 'all', isTotal: true },
    { label: 'New', value: count((c) => c.status === 'new'), tone: 'var(--ink)', icon: Sparkles, filter: 'new' },
    { label: 'Queued', value: count((c) => c.status === 'queued'), tone: 'var(--accent)', icon: Clock, filter: 'queued' },
    { label: 'Sent', value: count((c) => c.status === 'sent'), tone: 'var(--accent)', icon: Send, filter: 'sent' },
    { label: 'Replied', value: count((c) => c.status === 'replied'), tone: 'var(--ok)', icon: MessageSquare, filter: 'replied' },
    { label: 'Archived', value: count((c) => c.status === 'skip'), tone: 'var(--faint)', icon: Archive, filter: 'skip' },
  ]

  return (
    <div className="stat-strip" role="group" aria-label="Filter leads by status">
      {stats.map((s) => {
        const pct = activeTotal > 0 && !s.isTotal ? Math.round((s.value / activeTotal) * 100) : 0
        const empty = s.value === 0
        const on = active === s.filter
        return (
          <button
            key={s.label}
            type="button"
            className="stat-tile"
            data-empty={empty ? 'true' : undefined}
            data-on={on ? 'true' : undefined}
            aria-pressed={on}
            onClick={() => onSelect(s.filter)}
          >
            <span className="stat-tile-head">
              <s.icon size={14} aria-hidden="true" />
              <span className="flabel">{s.label}</span>
            </span>

            <span className="stat-tile-row">
              {/* A zero takes the muted ink deliberately: accent colour should mean
                  "something is here". It's also legibility — at display weight the
                  druk zero has an almost-closed counter, so a dark-red 0 on the
                  near-black tile reads as a filled blob rather than a digit. */}
              <span className="display stat-value" style={{ color: empty ? 'var(--faint)' : s.tone }}>
                {s.value}
              </span>
              {!s.isTotal && !empty && <span className="stat-pct">{pct}%</span>}
            </span>

            {/* Decorative — the number and percent above already say it, so it isn't
                announced twice. */}
            {!s.isTotal && (
              <span className="stat-bar" aria-hidden="true">
                <span style={{ width: `${pct}%`, background: empty ? 'transparent' : s.tone }} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
