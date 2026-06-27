'use client'

import { create } from 'zustand'
import type { Contact, ContactStatus, CreatorProfile, QueuedEmail } from './types'
import { mockContacts } from './mock/contacts'
import { buildDraft } from './emailTemplate'
import { adminFetch } from './adminClient'

// Placeholder identity shown for the instant first paint, before hydrate() pulls
// the real profile from /api/admin/settings (public_profile + derived metrics).
const defaultProfile: CreatorProfile = {
  name: 'sim x margo',
  handle: '@simxmargo',
  niche: 'Fashion, beauty & lifestyle',
  followers: '—',
  avgViews: '—',
  engagement: '—',
  audience: '',
  realEmail: '',
  mailingAddress: '',
  mediaKitUrl: '',
}

// /api/admin/settings GET shape → the email-template CreatorProfile. Identity comes
// from public_profile; followers/avgViews/engagement are DERIVED from social_stats
// (read-only here — the future TikTok/IG/FB sync writes social_stats, not this).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function settingsToProfile(s: any): CreatorProfile {
  const p = s?.profile ?? {}
  const m = s?.metrics ?? {}
  return {
    name: p.name ?? '',
    handle: p.handle ?? '',
    niche: p.niche ?? '',
    followers: m.followers ?? '—',
    avgViews: m.avgViews ?? '—',
    engagement: m.engagement ?? '—',
    audience: p.audience ?? '',
    realEmail: p.replyToEmail ?? '',
    mailingAddress: p.mailingAddress ?? '',
    mediaKitUrl: p.mediaKitUrl ?? '',
  }
}

interface StudioState {
  contacts: Contact[]
  profile: CreatorProfile
  queue: QueuedEmail[]
  dailyCap: number
  sentToday: number
  source: 'mock' | 'live' // where `contacts` came from (for an honest UI badge)
  loading: boolean

  hydrate: () => Promise<void>
  setStatus: (id: string, status: ContactStatus) => void
  updateNotes: (id: string, notes: string) => void

  queueDraft: (contactId: string, subject: string, body: string) => void
  removeFromQueue: (queueId: string) => void
  // TODO(studio-backend): replace with a real Gmail-API send via the send-one Edge Function.
  markQueuedAsSent: (queueId: string) => void
}

export const useStore = create<StudioState>((set, get) => ({
  // Mock paints instantly; hydrate() swaps in live data from the service-role admin
  // routes (contacts + app_settings have NO anon RLS policy, so the browser must
  // go through /api/admin/* — the anon client could never read them).
  contacts: mockContacts,
  profile: defaultProfile,
  queue: [],
  dailyCap: 20,
  sentToday: mockContacts.filter((c) => c.status === 'sent').length,
  source: 'mock',
  loading: false,

  hydrate: async () => {
    set({ loading: true })
    try {
      const [contactsRes, settingsRes] = await Promise.all([
        adminFetch('/api/admin/contacts'),
        adminFetch('/api/admin/settings'),
      ])
      if (!contactsRes.ok) throw new Error(`contacts ${contactsRes.status}`)

      const contacts = (await contactsRes.json()) as Contact[]
      const settings = settingsRes.ok ? await settingsRes.json() : null

      set((s) => ({
        contacts: Array.isArray(contacts) ? contacts : [],
        source: 'live',
        loading: false,
        sentToday: (Array.isArray(contacts) ? contacts : []).filter((c) => c.status === 'sent').length,
        profile: settings ? settingsToProfile(settings) : s.profile,
        dailyCap: settings?.dailyCap ?? s.dailyCap,
      }))
    } catch (err) {
      // Not authed yet / route unavailable / offline → keep the mock already loaded.
      console.error('[studio] hydrate failed; staying on mock data:', err instanceof Error ? err.message : err)
      set({ loading: false })
    }
  },

  setStatus: (id, status) => {
    set((s) => ({ contacts: s.contacts.map((c) => (c.id === id ? { ...c, status } : c)) }))
    adminFetch('/api/admin/contacts', { method: 'PATCH', body: JSON.stringify({ id, status }) })
      .then((r) => !r.ok && console.error('[studio] setStatus persist failed:', r.status))
      .catch((e) => console.error('[studio] setStatus persist failed:', e))
  },

  updateNotes: (id, notes) => {
    set((s) => ({ contacts: s.contacts.map((c) => (c.id === id ? { ...c, notes } : c)) }))
    adminFetch('/api/admin/contacts', { method: 'PATCH', body: JSON.stringify({ id, notes }) })
      .then((r) => !r.ok && console.error('[studio] updateNotes persist failed:', r.status))
      .catch((e) => console.error('[studio] updateNotes persist failed:', e))
  },

  queueDraft: (contactId, subject, body) => {
    // Queue stays session-local until the send-one Edge Function exists; we mark the
    // contact 'queued' (persisted via setStatus) but never claim a send not yet wired.
    const id = `q_${contactId}_${get().queue.length}`
    set((s) => ({
      queue: [...s.queue, { id, contactId, subject, body, createdAt: new Date().toISOString() }],
    }))
    get().setStatus(contactId, 'queued')
  },

  removeFromQueue: (queueId) => set((s) => ({ queue: s.queue.filter((q) => q.id !== queueId) })),

  markQueuedAsSent: (queueId) => {
    // MOCKED send (no email actually goes out yet) — session-local sentToday bump +
    // a persisted 'sent' status. Real sending flows through send_queue → pg_cron →
    // send-one (docs/BACKEND_DESIGN.md §6).
    const item = get().queue.find((q) => q.id === queueId)
    if (!item) return
    set((s) => ({ queue: s.queue.filter((q) => q.id !== queueId), sentToday: s.sentToday + 1 }))
    get().setStatus(item.contactId, 'sent')
  },
}))

// Convenience selector used by the compose drawer.
export function draftForContact(contact: Contact, profile: CreatorProfile) {
  return buildDraft(contact, profile)
}
