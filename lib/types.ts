// Shared data shapes. These mirror the planned Supabase `contacts` table so the
// UI can swap from mock data to the live DB without changing components.

export type ContactStatus =
  | 'new' // scraped by us, never touched — a cold lead
  | 'inbound' // THEY reached out first (a Work-with-me inquiry) — arrives warm
  | 'queued' // scheduled in send_queue, sending shortly
  | 'sent' // pitched, awaiting a reply
  | 'replied' // they answered our pitch (the goal!)
  | 'bounced' // delivery failed
  | 'skip' // you decided not to contact

export type EmailType = 'partnerships' | 'press' | 'generic' | 'named'

export interface Contact {
  id: string
  brand: string
  email: string
  emailType: EmailType
  country: string
  website: string
  status: ContactStatus
  notes: string
  lastEmailedAt: string | null
  createdAt: string
}

// Drives the email template merge-fields. Edited in Settings.
export interface CreatorProfile {
  name: string
  handle: string
  niche: string
  location: string // e.g. "Philippines" — used in the pitch intro
  followers: string
  avgViews: string
  engagement: string
  audience: string
  realEmail: string // Reply-To — where interested brands reach you
  mailingAddress: string // CAN-SPAM requires a real postal address (a city / PO box is fine)
  mediaKitUrl: string
}

export interface QueuedEmail {
  id: string
  contactId: string
  subject: string
  body: string
  createdAt: string
}
