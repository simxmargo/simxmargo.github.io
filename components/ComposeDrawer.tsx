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
      <div className="absolute inset-0 bg-stone-900/20" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-stone-200 px-5 py-4">
          <div>
            <div className="font-display text-lg font-semibold text-stone-900">{contact.brand}</div>
            <div className="text-sm text-stone-500">{contact.email}</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50 px-5 py-2 text-xs text-stone-500">
          <FitChip score={contact.fitScore} />
          <span>{contact.fitReason}</span>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-stone-400">
              Reply-To (your real email)
            </span>
            <div className="mt-1 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">
              {profile.realEmail}
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-stone-400">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-plum-500 focus:outline-none focus:ring-1 focus:ring-plum-500"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-stone-400">Message</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              className="mt-1 w-full resize-none rounded-lg border border-stone-200 px-3 py-2 text-[13px] leading-relaxed focus:border-plum-500 focus:outline-none focus:ring-1 focus:ring-plum-500"
            />
          </label>
        </div>

        <div className="flex items-center justify-between border-t border-stone-200 px-5 py-4">
          <span className="text-xs text-stone-400">Review before queueing — nothing sends automatically.</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-stone-200 px-4 py-2 text-sm text-stone-600 hover:bg-stone-100"
            >
              Cancel
            </button>
            <button
              onClick={() => onQueue(subject, body)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700"
            >
              <Send size={15} /> Add to queue
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
