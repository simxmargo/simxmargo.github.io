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
    return <div className="empty">No contacts match your filters.</div>
  }

  return (
    <div className="panel">
      <table className="table">
        <thead>
          <tr>
            <th>Brand</th>
            <th>Contact</th>
            <th>Country</th>
            <th style={{ textAlign: 'center' }}>Fit</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id}>
              <td>
                <div style={{ fontWeight: 600 }}>{c.brand}</div>
                <a
                  href={`https://${c.website}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1"
                  style={{ fontSize: 12, color: 'var(--muted)', textDecoration: 'none' }}
                >
                  {c.website} <ExternalLink size={11} aria-hidden="true" />
                </a>
              </td>
              <td>
                <div>{c.email}</div>
                <div style={{ fontSize: 12, color: 'var(--faint)', textTransform: 'capitalize' }}>{c.emailType}</div>
              </td>
              <td style={{ color: 'var(--muted)' }}>{c.country}</td>
              <td style={{ textAlign: 'center' }} title={c.fitReason}>
                <FitChip score={c.fitScore} />
              </td>
              <td>
                <StatusBadge status={c.status} />
              </td>
              <td>
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => onDraft(c)} className="btn btn-primary btn-sm">
                    <Mail size={13} aria-hidden="true" /> Draft
                  </button>
                  <button
                    onClick={() => onSkip(c)}
                    title="Skip this brand"
                    aria-label="Skip this brand"
                    className="btn btn-danger btn-sm"
                  >
                    <Ban size={13} aria-hidden="true" />
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
