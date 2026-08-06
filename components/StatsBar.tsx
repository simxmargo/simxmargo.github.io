'use client'

import { Sparkles, Clock, Send, Archive } from 'lucide-react'
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
// FOUR TILES, PLAIN COUNTS. This is a scrape-fire-forget tool, so the shape of the
// job is New → Queued → Sent, plus Archived. "Active" was New+Queued+Sent restated,
// and "Replied" counted a status this app never sets — nothing writes it, so the tile
// could only ever read 0. The per-tile percentages went with them: they were a share
// of the Active total, so removing that tile left them measuring a denominator no
// longer on screen. The bar under each number was the same percentage drawn, so it
// went too rather than sitting there as a figure with nothing to compare against.
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

  const stats: {
    label: string
    value: number
    tone: string
    icon: typeof Sparkles
    filter: Filters['status']
  }[] = [
    { label: 'New', value: count((c) => c.status === 'new'), tone: 'var(--ink)', icon: Sparkles, filter: 'new' },
    { label: 'Queued', value: count((c) => c.status === 'queued'), tone: 'var(--accent)', icon: Clock, filter: 'queued' },
    { label: 'Sent', value: count((c) => c.status === 'sent'), tone: 'var(--accent)', icon: Send, filter: 'sent' },
    { label: 'Archived', value: count((c) => c.status === 'skip'), tone: 'var(--faint)', icon: Archive, filter: 'skip' },
  ]

  return (
    <div className="stat-strip" role="group" aria-label="Filter leads by status">
      {stats.map((s) => {
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
            </span>
          </button>
        )
      })}
    </div>
  )
}
