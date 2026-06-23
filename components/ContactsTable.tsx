'use client'

import { ExternalLink, Mail, Ban } from 'lucide-react'
import type { Contact } from '@/lib/types'
import { StatusBadge, FitChip } from './StatusBadge'

export function ContactsTable({
  contacts,
  onDraft,
  onSkip,
}: {
  contacts: Contact[]
  onDraft: (c: Contact) => void
  onSkip: (c: Contact) => void
}) {
  if (contacts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-300 bg-white py-16 text-center text-sm text-stone-400">
        No contacts match your filters.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
            <th className="px-4 py-3 font-medium">Brand</th>
            <th className="px-4 py-3 font-medium">Contact</th>
            <th className="px-4 py-3 font-medium">Country</th>
            <th className="px-4 py-3 text-center font-medium">Fit</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50/60">
              <td className="px-4 py-3">
                <div className="font-medium text-stone-900">{c.brand}</div>
                <a
                  href={`https://${c.website}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-plum-600"
                >
                  {c.website} <ExternalLink size={11} />
                </a>
              </td>
              <td className="px-4 py-3">
                <div className="text-stone-700">{c.email}</div>
                <div className="text-xs capitalize text-stone-400">{c.emailType}</div>
              </td>
              <td className="px-4 py-3 text-stone-600">{c.country}</td>
              <td className="px-4 py-3 text-center" title={c.fitReason}>
                <FitChip score={c.fitScore} />
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={c.status} />
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1">
                  <button
                    onClick={() => onDraft(c)}
                    className="inline-flex items-center gap-1 rounded-lg bg-plum-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-plum-700"
                  >
                    <Mail size={13} /> Draft
                  </button>
                  <button
                    onClick={() => onSkip(c)}
                    title="Skip this brand"
                    className="rounded-lg border border-stone-200 px-2 py-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
                  >
                    <Ban size={13} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
