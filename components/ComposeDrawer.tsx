'use client'

import { useEffect, useState } from 'react'
import { X, Send } from 'lucide-react'
import type { Contact, CreatorProfile } from '@/lib/types'
import { buildDraft } from '@/lib/emailTemplate'
import { FitChip } from './StatusBadge'

export function ComposeDrawer({
  contact,
  profile,
  onClose,
  onQueue,
}: {
  contact: Contact | null
  profile: CreatorProfile
  onClose: () => void
  onQueue: (subject: string, body: string) => void
}) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  // Re-fill the editable draft whenever a new contact is opened.
  useEffect(() => {
    if (contact) {
      const draft = buildDraft(contact, profile)
      setSubject(draft.subject)
      setBody(draft.body)
    }
  }, [contact, profile])

  if (!contact) return null

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0" style={{ background: 'rgba(10, 9, 8, 0.6)' }} onClick={onClose} />
      <div
        className="relative flex h-full w-full max-w-xl flex-col"
        style={{
          background: 'var(--panel)',
          borderLeft: '1px solid var(--line)',
          boxShadow: '-24px 0 60px -30px rgba(0, 0, 0, 0.7)',
        }}
      >
        <div
          className="flex items-start justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--line)' }}
        >
          <div>
            <div className="display" style={{ fontSize: 19, fontWeight: 600, color: 'var(--ink)' }}>
              {contact.brand}
            </div>
            <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 2 }}>{contact.email}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="btn btn-ghost btn-sm"
            style={{ padding: 8 }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div
          className="flex items-center gap-2 px-5 py-3"
          style={{ borderBottom: '1px solid var(--line)', background: 'var(--field)', fontSize: 13 }}
        >
          <FitChip score={contact.fitScore} />
          <span style={{ color: 'var(--muted)' }}>{contact.fitReason}</span>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="field">
            <span className="flabel">Reply-To (your real email)</span>
            <div className="input is-readonly">{profile.realEmail}</div>
          </div>

          <label className="field">
            <span className="flabel">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="input" />
          </label>

          <label className="field">
            <span className="flabel">Message</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              className="textarea"
              style={{ resize: 'none', fontSize: 13, lineHeight: 1.6 }}
            />
          </label>
        </div>

        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderTop: '1px solid var(--line)' }}
        >
          <span style={{ fontSize: 12, color: 'var(--faint)' }}>
            Review before queueing — nothing sends automatically.
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-ghost">
              Cancel
            </button>
            <button onClick={() => onQueue(subject, body)} className="btn btn-primary">
              <Send size={15} aria-hidden="true" /> Add to queue
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
