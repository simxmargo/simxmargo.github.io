'use client'

import { create } from 'zustand'
import type { Contact, ContactStatus, CreatorProfile, QueuedEmail } from './types'
import { mockContacts } from './mock/contacts'
import { buildDraft } from './emailTemplate'
import { isSupabaseConfigured, supabase } from './supabase'

// EDIT these defaults in the Settings screen — they fill the template. When
// Supabase is configured they're overwritten by app_settings.profile on hydrate.
const defaultProfile: CreatorProfile = {
  name: 'Your Name', // EDIT
  handle: '@yourhandle', // EDIT
  niche: 'beauty & fashion', // EDIT
  followers: '25k', // EDIT
  avgViews: '40k', // EDIT
  engagement: '6%', // EDIT
  audience: 'women 18–34 in SE Asia, with a growing US following', // EDIT
  realEmail: 'you@example.com', // EDIT — Reply-To, where brands reach you
  mailingAddress: 'City, Country', // EDIT — CAN-SPAM requires a real postal address
  mediaKitUrl: '', // EDIT — optional
}

// The `contacts` row shape (snake_case) → our camelCase Contact. Keeping the
// mapping in one place means components never see the DB naming.
interface ContactRow {
  id: string
  brand: string
  email: string
  email_type: Contact['emailType']
  country: string | null
  website: string | null
  fit_score: number | null
  fit_reason: string | null
  status: ContactStatus
  notes: string | null
  last_emailed_at: string | null
  created_at: string
}

function rowToContact(r: ContactRow): Contact {
  return {
    id: r.id,
    brand: r.brand,
    email: r.email,
    emailType: r.email_type,
    country: r.country ?? '',
    website: r.website ?? '',
    fitScore: r.fit_score,
    fitReason: r.fit_reason ?? '',
    status: r.status,
    notes: r.notes ?? '',
    lastEmailedAt: r.last_emailed_at,
    createdAt: r.created_at,
  }
}

// Debounced, merged writes to the single app_settings row — so typing in Settings
// doesn't fire a request per keystroke. No-op when Supabase isn't configured.
let pendingSettings: Record<string, unknown> = {}
let settingsTimer: ReturnType<typeof setTimeout> | undefined
function persistSettings(patch: Record<string, unknown>) {
  if (!supabase) return
  pendingSettings = { ...pendingSettings, ...patch }
  clearTimeout(settingsTimer)
  settingsTimer = setTimeout(() => {
    const body = { ...pendingSettings, updated_at: new Date().toISOString() }
    pendingSettings = {}
    supabase!
      .from('app_settings')
      .update(body)
      .eq('id', 1)
      .then(({ error }) => error && console.error('[studio] settings persist failed:', error.message))
  }, 600)
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
  updateProfile: (patch: Partial<CreatorProfile>) => void
  setDailyCap: (n: number) => void

  queueDraft: (contactId: string, subject: string, body: string) => void
  removeFromQueue: (queueId: string) => void
  // TODO(studio-backend): replace with a real Gmail-API send via the send-one Edge Function.
  markQueuedAsSent: (queueId: string) => void
}

export const useStore = create<StudioState>((set, get) => ({
  // Start on mock data so the UI renders instantly; hydrate() swaps in live data
  // when Supabase is configured AND reachable (else we stay on mock).
  contacts: mockContacts,
  profile: defaultProfile,
  queue: [],
  dailyCap: 20,
  sentToday: mockContacts.filter((c) => c.status === 'sent').length,
  source: 'mock',
  loading: false,

  hydrate: async () => {
    if (!isSupabaseConfigured || !supabase) return // no backend → keep mock data
    set({ loading: true })
    try {
      const [contactsRes, settingsRes] = await Promise.all([
        supabase.from('contacts').select('*').order('fit_score', { ascending: false, nullsFirst: false }),
        supabase.from('app_settings').select('profile, daily_cap').eq('id', 1).maybeSingle(),
      ])
      if (contactsRes.error) throw contactsRes.error

      const rows = (contactsRes.data ?? []) as ContactRow[]
      const settings = settingsRes.data as { profile?: Partial<CreatorProfile>; daily_cap?: number } | null
      const hasProfile = settings?.profile && Object.keys(settings.profile).length > 0

      set((s) => ({
        contacts: rows.map(rowToContact),
        source: 'live',
        loading: false,
        sentToday: rows.filter((r) => r.status === 'sent').length,
        profile: hasProfile ? { ...s.profile, ...settings!.profile } : s.profile,
        dailyCap: settings?.daily_cap ?? s.dailyCap,
      }))
    } catch (err) {
      // Tables not created yet, offline, etc. — degrade to the mock data already loaded.
      console.error('[studio] hydrate failed; staying on mock data:', err instanceof Error ? err.message : err)
      set({ loading: false })
    }
  },

  setStatus: (id, status) => {
    set((s) => ({ contacts: s.contacts.map((c) => (c.id === id ? { ...c, status } : c)) }))
    if (supabase) {
      supabase
        .from('contacts')
        .update({ status })
        .eq('id', id)
        .then(({ error }) => error && console.error('[studio] setStatus persist failed:', error.message))
    }
  },

  updateNotes: (id, notes) => {
    set((s) => ({ contacts: s.contacts.map((c) => (c.id === id ? { ...c, notes } : c)) }))
    if (supabase) {
      supabase
        .from('contacts')
        .update({ notes })
        .eq('id', id)
        .then(({ error }) => error && console.error('[studio] updateNotes persist failed:', error.message))
    }
  },

  updateProfile: (patch) => {
    const profile = { ...get().profile, ...patch }
    set({ profile })
    persistSettings({ profile }) // whole profile jsonb, debounced
  },

  setDailyCap: (n) => {
    const dailyCap = Math.max(1, Math.min(50, n))
    set({ dailyCap })
    persistSettings({ daily_cap: dailyCap })
  },

  queueDraft: (contactId, subject, body) =>
    // Queue stays session-local until the send-one Edge Function exists; we don't
    // write 'queued' to the DB so the contacts table never claims a send that
    // hasn't been wired. setStatus is the persisted path.
    set((s) => ({
      queue: [
        ...s.queue,
        { id: `q_${contactId}_${s.queue.length}`, contactId, subject, body, createdAt: new Date().toISOString() },
      ],
      contacts: s.contacts.map((c) => (c.id === contactId ? { ...c, status: 'queued' } : c)),
    })),

  removeFromQueue: (queueId) => set((s) => ({ queue: s.queue.filter((q) => q.id !== queueId) })),

  markQueuedAsSent: (queueId) =>
    // MOCKED send (no email actually goes out yet) — intentionally session-local,
    // so we don't record a false 'sent' in the DB. Real sending will flow through
    // send_queue → pg_cron → send-one (docs/BACKEND_DESIGN.md §6).
    set((s) => {
      const item = s.queue.find((q) => q.id === queueId)
      if (!item) return s
      return {
        queue: s.queue.filter((q) => q.id !== queueId),
        sentToday: s.sentToday + 1,
        contacts: s.contacts.map((c) =>
          c.id === item.contactId ? { ...c, status: 'sent', lastEmailedAt: new Date().toISOString() } : c,
        ),
      }
    }),
}))

// Convenience selector used by the compose drawer.
export function draftForContact(contact: Contact, profile: CreatorProfile) {
  return buildDraft(contact, profile)
}
