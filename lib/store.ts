'use client'

import { create } from 'zustand'
import type { Contact, ContactStatus, CreatorProfile } from './types'
import { buildDraft, DEFAULT_TEMPLATE, resolveTemplate, type EmailTemplate } from './emailTemplate'
import { readContacts, updateContact } from './admin/resources/contacts'
import { readSettings } from './admin/resources/settings'
import { readProfile, type ProfileReadResult } from './admin/resources/profile'

// NOTE: this store no longer owns a send queue. Queuing and sending live in
// `send_queue` (migration 0013) and are drained by pg_cron — see
// lib/admin/resources/sendQueue.ts. A client-side send path was deliberately removed
// rather than left unused: anything here that could call the send function directly
// would bypass the 5-minute grace window that makes queuing cancellable.

const DAY_MS = 24 * 60 * 60 * 1000

// Sends inside the trailing 24 hours — the SAME rolling window `send-email` enforces
// the cap on server-side. This used to count every contact with status 'sent', which
// is an all-time total: the meter read "18 / 20 sent today" on an account that had
// sent nothing for weeks, and would have kept climbing until the UI looked capped
// forever. Anything that claims to show today's sending has to be time-bounded.
function countSentLast24h(contacts: Contact[]): number {
  const since = Date.now() - DAY_MS
  return contacts.filter((c) => {
    if (!c.lastEmailedAt) return false
    const t = new Date(c.lastEmailedAt).getTime()
    return !Number.isNaN(t) && t >= since
  }).length
}

// Placeholder identity shown for the instant first paint, before hydrate() pulls
// the real profile from public_profile (+ metrics derived from social_stats).
const defaultProfile: CreatorProfile = {
  name: 'simxmargo',
  handle: '@simxmargo',
  niche: 'Fashion, beauty & lifestyle',
  location: '',
  followers: '—',
  avgViews: '—',
  engagement: '—',
  audience: '',
  realEmail: '',
  mailingAddress: '',
  mediaKitUrl: '',
}

// public_profile (+ metrics derived from social_stats) → the email-template
// CreatorProfile. Identity is the profile row; followers/avgViews/engagement are
// DERIVED read-only metrics (the TikTok/IG/FB sync writes social_stats, not this).
//
// This used to map from readSettings(), but that resource was narrowed to
// `{ dailyCap }` in an earlier refactor — every field silently fell back to
// ''/'—', so EVERY generated pitch read "I'm , a creator … — followers".
// readProfile() is the resource that actually owns this data.
function profileToCreator(p: ProfileReadResult): CreatorProfile {
  return {
    name: p.displayName,
    handle: p.handle,
    niche: p.niche,
    location: p.location,
    followers: p.metrics.followers,
    avgViews: p.metrics.avgViews,
    engagement: p.metrics.engagement,
    audience: p.audience,
    realEmail: p.replyToEmail,
    mailingAddress: p.mailingAddress,
    mediaKitUrl: p.mediaKitUrl,
  }
}

interface StudioState {
  contacts: Contact[]
  profile: CreatorProfile
  /** The editable pitch, from public_profile.content.emailTemplate. */
  emailTemplate: EmailTemplate
  dailyCap: number
  sentToday: number
  source: 'mock' | 'live' // where `contacts` came from (for an honest UI badge)
  loading: boolean

  hydrate: () => Promise<void>
  setStatus: (id: string, status: ContactStatus) => void
  updateNotes: (id: string, notes: string) => void
}

export const useStore = create<StudioState>((set, get) => ({
  // Starts EMPTY; hydrate() loads live leads directly from Supabase (authed admin
  // session + is_admin() RLS). No mock seed — the studio only ever shows real contacts.
  contacts: [],
  profile: defaultProfile,
  emailTemplate: DEFAULT_TEMPLATE,
  dailyCap: 20,
  sentToday: 0,
  source: 'live',
  loading: false,

  hydrate: async () => {
    set({ loading: true })
    try {
      // contacts is the critical path (rejection ⇒ stay on mock); settings is
      // best-effort (null on failure), mirroring the old `settingsRes.ok ? … : null`.
      const [contacts, settings, profile] = await Promise.all([
        readContacts(),
        readSettings().catch(() => null),
        readProfile().catch(() => null),
      ])

      set((s) => ({
        contacts: Array.isArray(contacts) ? contacts : [],
        source: 'live',
        loading: false,
        sentToday: countSentLast24h(Array.isArray(contacts) ? contacts : []),
        profile: profile ? profileToCreator(profile) : s.profile,
        // resolveTemplate defaults FIELD BY FIELD, so a partially-saved template can
        // never blank out a block of the email.
        emailTemplate: profile
          ? resolveTemplate((profile.content as Record<string, unknown> | undefined)?.emailTemplate)
          : s.emailTemplate,
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
    updateContact(id, { status }).catch((e) =>
      console.error('[studio] setStatus persist failed:', e instanceof Error ? e.message : e),
    )
  },

  updateNotes: (id, notes) => {
    set((s) => ({ contacts: s.contacts.map((c) => (c.id === id ? { ...c, notes } : c)) }))
    updateContact(id, { notes }).catch((e) =>
      console.error('[studio] updateNotes persist failed:', e instanceof Error ? e.message : e),
    )
  },

}))

// Convenience selector — always renders through the CURRENT saved template.
export function draftForContact(contact: Contact, profile: CreatorProfile, template?: EmailTemplate) {
  return buildDraft(contact, profile, template)
}
