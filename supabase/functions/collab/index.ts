// `collab` Edge Function — public "Work with me" submissions → collab_inquiries
// + an email notification to the influencer's inbox.
//
// The static site has no server, so the public media-kit form POSTs here (via
// supabase.functions.invoke in lib/mediakit/collab.ts). Honeypot, server-side
// validation mirroring the DB CHECKs, and a salted SHA-256 of the caller IP (the
// raw IP is never stored). Inserts with the ANON key, so RLS is the boundary (the
// policy only allows status='new' + a non-empty message).
//
// Email is BEST-EFFORT and strictly insert-first: the inquiry is always saved
// (and visible in the studio Inquiries inbox) even when Resend is down or the
// RESEND_API_KEY secret isn't set — a send failure is logged, never surfaced as
// a form error. reply_to is the submitter, so replying goes straight to the brand.
//
// Deploy:  ./node_modules/.bin/supabase functions deploy collab --no-verify-jwt --use-api
//   --no-verify-jwt because this is a PUBLIC endpoint; the honeypot + RLS + DB
//   CHECKs are the protection, not a JWT.
// Secrets: RESEND_API_KEY (required for email), optional COLLAB_NOTIFY_TO
//   (default simxmargo.collab@gmail.com) and COLLAB_NOTIFY_FROM (default
//   onboarding@resend.dev — fine while the Resend account has no verified domain,
//   since Resend allows that sender to the account owner's own address).

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const IP_SALT = 'simxmargo-collab-v1' // not a secret; just so stored hashes aren't a plain-IP rainbow lookup

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface InquiryEmail {
  name: string
  email: string
  company: string
  budget: string
  deliverables: string[]
  message: string
  sourcePath: string
}

// Best-effort notification to the influencer. Never throws — the inquiry is already
// saved by the time this runs, so any failure here is logged and swallowed.
async function notifyByEmail(inq: InquiryEmail): Promise<void> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) {
    console.error('[collab] RESEND_API_KEY not set — inquiry saved, email notification skipped')
    return
  }
  const to = Deno.env.get('COLLAB_NOTIFY_TO') || 'simxmargo.collab@gmail.com'
  const from = Deno.env.get('COLLAB_NOTIFY_FROM') || 'simxmargo media kit <onboarding@resend.dev>'

  const lines = [
    `Name: ${inq.name}`,
    `Email: ${inq.email}`,
    inq.company ? `Brand: ${inq.company}` : '',
    inq.budget ? `Budget: ${inq.budget}` : '',
    inq.deliverables.length ? `Package: ${inq.deliverables.join(', ')}` : '',
    '',
    inq.message,
    '',
    '—',
    `Sent from ${inq.sourcePath} · reply to this email to answer ${inq.name} directly.`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '') // collapse double blanks

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: inq.email,
        subject: `New collab brief — ${inq.name}${inq.company ? ` · ${inq.company}` : ''}`,
        text: lines.join('\n'),
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.error('[collab] Resend send failed:', res.status, await res.text())
    }
  } catch (err) {
    console.error('[collab] Resend send errored:', err instanceof Error ? err.message : err)
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: Record<string, unknown> | null = null
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  if (!body) return json({ error: 'Empty body' }, 400)

  // Honeypot: a bot fills the hidden "website" field. Pretend success, store nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return json({ ok: true })
  }

  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim()
  const message = String(body.message ?? '').trim()
  if (name.length < 1 || name.length > 120) return json({ error: 'Please enter your name.' }, 400)
  if (!EMAIL_RE.test(email)) return json({ error: 'Please enter a valid email.' }, 400)
  if (message.length < 1 || message.length > 4000) return json({ error: 'Please include a message.' }, 400)

  const deliverables = Array.isArray(body.deliverables) ? body.deliverables.map(String).slice(0, 20) : []
  const ipRaw = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim()
  const ipHash = ipRaw ? (await sha256Hex(ipRaw + IP_SALT)).slice(0, 32) : ''

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error } = await supabase.from('collab_inquiries').insert({
    name,
    email,
    company: String(body.company ?? '').slice(0, 160),
    budget: String(body.budget ?? '').slice(0, 120),
    message,
    deliverables,
    source_path: String(body.sourcePath ?? '/'),
    ip_hash: ipHash,
    user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300),
    status: 'new',
  })

  if (error) {
    console.error('[collab] insert failed:', error.message)
    return json({ error: 'Could not submit right now. Please email me directly.' }, 502)
  }

  // Insert succeeded — the notification is awaited (the runtime may kill work queued
  // after the response) but its outcome never affects the caller's success.
  await notifyByEmail({
    name,
    email,
    company: String(body.company ?? '').slice(0, 160),
    budget: String(body.budget ?? '').slice(0, 120),
    deliverables,
    message,
    sourcePath: String(body.sourcePath ?? '/'),
  })
  return json({ ok: true })
})
