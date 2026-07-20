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
// (and visible in the studio Inquiries inbox) even when no transport is configured
// or the send fails — failures are logged, never surfaced as a form error.
// reply_to is the submitter, so replying goes straight to the brand.
//
// Transport: Gmail SMTP — set GMAIL_SMTP_PASSWORD (a Google App Password for
// simxmargo.collabs@gmail.com; the account needs 2-Step Verification ON).
// Gmail→same-Gmail, so deliverability is a non-issue. Optional GMAIL_SMTP_USER
// overrides the account; optional COLLAB_NOTIFY_TO overrides the recipient.
//
// Deploy:  ./node_modules/.bin/supabase functions deploy collab --no-verify-jwt --use-api
//   --no-verify-jwt because this is a PUBLIC endpoint; the honeypot + RLS + DB
//   CHECKs are the protection, not a JWT.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
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

// Transport 1 — Gmail SMTP (App Password; the account needs 2-Step Verification).
// Port 465 implicit TLS (STARTTLS on 587 is flaky from Edge Functions). The client
// is closed in finally so a timed-out send can't leak the connection.
async function sendViaGmail(
  user: string,
  pass: string,
  to: string,
  replyTo: string,
  subject: string,
  text: string,
): Promise<void> {
  const client = new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 465,
      tls: true,
      auth: { username: user, password: pass },
    },
  })
  try {
    await Promise.race([
      client.send({ from: `simxmargo media kit <${user}>`, to, replyTo, subject, content: text }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP send timed out (15s)')), 15_000)),
    ])
  } finally {
    try {
      await client.close()
    } catch {
      /* connection already gone */
    }
  }
}

// Best-effort notification to the influencer. Never throws — the inquiry is already
// saved by the time this runs, so any failure here is logged and swallowed.
async function notifyByEmail(inq: InquiryEmail): Promise<void> {
  const to = Deno.env.get('COLLAB_NOTIFY_TO') || 'simxmargo.collabs@gmail.com'
  const subject = `New collab brief — ${inq.name}${inq.company ? ` · ${inq.company}` : ''}`
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
  const text = lines.join('\n')

  const gmailPass = Deno.env.get('GMAIL_SMTP_PASSWORD')
  const gmailUser = Deno.env.get('GMAIL_SMTP_USER') || 'simxmargo.collabs@gmail.com'
  try {
    if (gmailPass) {
      await sendViaGmail(gmailUser, gmailPass, to, inq.email, subject, text)
    } else {
      console.error(
        '[collab] GMAIL_SMTP_PASSWORD not set — inquiry saved, email notification skipped',
      )
    }
  } catch (err) {
    console.error('[collab] email notify failed:', err instanceof Error ? err.message : err)
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
