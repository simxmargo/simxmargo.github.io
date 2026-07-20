// `collab` Edge Function — public "Work with me" submissions → an email
// notification to the influencer's inbox, plus a best-effort record in Supabase.
//
// The static site has no server, so the public media-kit form POSTs here (via
// supabase.functions.invoke in lib/mediakit/collab.ts). Honeypot + server-side
// validation mirroring the DB CHECKs run first.
//
// FLOW (fast confirm + resilience): the email send is KICKED OFF FIRST and runs
// CONCURRENTLY with the DB insert. As soon as the DB durably captures the row we
// return `ok` and let the ~7s SMTP send finish in the BACKGROUND (EdgeRuntime.
// waitUntil) — so the public form's "Sending..." clears in ~300ms instead of ~7s.
// If the DB write FAILS, the email becomes the sole channel, so we AWAIT it and
// report its real outcome. No inquiry is ever lost; the request only fails (502)
// if BOTH channels fail.
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

// Map the common "smart" Unicode punctuation brands paste (em/en dashes, curly
// quotes, ellipsis, middle dot, nbsp) to plain ASCII. denomailer 1.6.0 mangles a
// long non-ASCII SUBJECT — its encoded-word folding broke the header block and
// spilled the headers into the body as raw quoted-printable ("=e2=80=94"). Keeping
// our generated text ASCII sidesteps that entirely.
const PUNCT: Record<string, string> = {
  '—': '-', '–': '-', '‒': '-', // em / en / figure dash
  '‘': "'", '’': "'", // curly single quotes
  '“': '"', '”': '"', // curly double quotes
  '…': '...', // ellipsis
  '·': '-', '•': '-', // middle dot / bullet
  ' ': ' ', // non-breaking space
}
const PUNCT_RE = /[—–‒‘’“”…·• ]/g
function normalizePunct(s: string): string {
  return s.replace(PUNCT_RE, (c) => PUNCT[c] ?? c)
}

// Escape user-supplied text before interpolating it into the HTML email body, so
// a brand's message can't break the markup (or inject). The body may keep
// non-ASCII (accented names etc.) — quoted-printable handles that fine; only the
// SUBJECT must stay strict ASCII (see asciiSubject).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Run a promise to completion AFTER the HTTP response is returned, using the
// Supabase Edge global. Returns false if the runtime can't background (then the
// caller must await instead, so the work isn't dropped).
function runInBackground(p: Promise<unknown>): boolean {
  // @ts-ignore EdgeRuntime is a Supabase Edge Functions global
  const er = typeof EdgeRuntime !== 'undefined' ? EdgeRuntime : undefined
  if (er && typeof er.waitUntil === 'function') {
    er.waitUntil(p.catch(() => {}))
    return true
  }
  return false
}

// Subjects MUST be a clean single-line header. Normalize punctuation, strip any
// remaining non-printable-ASCII, collapse whitespace, and cap the length so no
// encoded-word / folding is ever produced.
function asciiSubject(s: string): string {
  return normalizePunct(s)
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

// The From ADDRESS is forced to the authenticated Gmail account — you cannot send
// AS the brand's address (that's spoofing; SPF/DKIM/DMARC block it). So the brand
// is surfaced two ways instead: their NAME becomes the From display label (scannable
// in the inbox) and their EMAIL becomes Reply-To (hitting Reply answers the brand).
// Strip chars that would break/confuse a From header; hyphen-join name + company.
function displayNameFor(inq: Inquiry): string {
  const raw = `${inq.name}${inq.company ? ` - ${inq.company}` : ''}`
  const clean = normalizePunct(raw)
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/["<>@,;:()\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 78)
  return clean || 'New collab brief'
}

interface Inquiry {
  name: string
  email: string
  company: string
  budget: string
  deliverables: string[]
  message: string
  sourcePath: string
}

// Transport — Gmail SMTP (App Password; the account needs 2-Step Verification).
// Port 465 implicit TLS (STARTTLS on 587 is flaky from Edge Functions). The client
// is closed in finally so a timed-out send can't leak the connection.
async function sendViaGmail(
  user: string,
  pass: string,
  from: string,
  to: string,
  replyTo: string,
  subject: string,
  text: string,
  html: string,
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
      // multipart/alternative: plain-text for deliverability + reader fallback,
      // HTML for the formatted (bolded) layout the influencer reads.
      client.send({ from, to, replyTo, subject, content: text, html }),
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

// Format a receipt time in the influencer's local timezone (Manila) for the email.
function formatReceived(at: Date): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(at) + ' PHT'
  } catch {
    return at.toUTCString()
  }
}

// Notify the influencer. Returns true if the email was sent, false otherwise
// (missing transport secret, or a send failure). Never throws — the caller
// decides what to do with the outcome.
async function notifyByEmail(inq: Inquiry, receivedAt: Date): Promise<boolean> {
  const gmailPass = Deno.env.get('GMAIL_SMTP_PASSWORD')
  if (!gmailPass) {
    console.error('[collab] GMAIL_SMTP_PASSWORD not set — email notification skipped')
    return false
  }
  const gmailUser = Deno.env.get('GMAIL_SMTP_USER') || 'simxmargo.collabs@gmail.com'
  const to = Deno.env.get('COLLAB_NOTIFY_TO') || 'simxmargo.collabs@gmail.com'

  const subject = asciiSubject(`New collab brief: ${inq.name}${inq.company ? ` (${inq.company})` : ''}`)
  const received = formatReceived(receivedAt)
  const footer = `Sent via your simxmargo media kit. Reply to answer ${inq.name} directly.`

  // LAYOUT (per request): the brand's DETAILS lead, then the Package/Budget asks,
  // then the contact block in order — Brand, Name, Email, Received.
  const briefLines = [inq.message]
  if (inq.deliverables.length) briefLines.push('', `Package: ${inq.deliverables.join(', ')}`)
  if (inq.budget) briefLines.push(`Budget: ${inq.budget}`)

  const contactLines: string[] = []
  if (inq.company) contactLines.push(`Brand: ${inq.company}`)
  contactLines.push(`Name: ${inq.name}`, `Email: ${inq.email}`, `Received: ${received}`)

  const text = normalizePunct([...briefLines, '', ...contactLines, '', '---', footer].join('\n'))

  // HTML alternative — same order, with the footer bolded/emphasized.
  const row = (label: string, value: string) =>
    `<tr><td style="padding:3px 14px 3px 0;color:#8a8a8a;white-space:nowrap;">${label}</td>` +
    `<td style="padding:3px 0;color:#1a1a1a;">${value}</td></tr>`
  const html = normalizePunct(
    `<div style="max-width:560px;margin:0 auto;padding:8px 4px;` +
      `font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">` +
      `<div style="font-size:15px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(inq.message)}</div>` +
      (inq.deliverables.length
        ? `<p style="margin:14px 0 0;font-size:14px;color:#333;"><strong>Package:</strong> ${escapeHtml(inq.deliverables.join(', '))}</p>`
        : '') +
      (inq.budget
        ? `<p style="margin:4px 0 0;font-size:14px;color:#333;"><strong>Budget:</strong> ${escapeHtml(inq.budget)}</p>`
        : '') +
      `<table style="margin-top:20px;padding-top:16px;border-top:1px solid #e6e6e6;font-size:14px;border-collapse:collapse;">` +
      (inq.company ? row('Brand', escapeHtml(inq.company)) : '') +
      row('Name', escapeHtml(inq.name)) +
      row('Email', `<a href="mailto:${escapeHtml(inq.email)}" style="color:#1a1a1a;">${escapeHtml(inq.email)}</a>`) +
      row('Received', escapeHtml(received)) +
      `</table>` +
      `<p style="margin:22px 0 0;font-size:13px;line-height:1.5;color:#555;"><strong>${escapeHtml(footer)}</strong></p>` +
      `</div>`,
  )

  // From: the brand's name as the display label, the authenticated account as the
  // address (required); Reply-To (inq.email) routes replies to the brand.
  const from = `${displayNameFor(inq)} <${gmailUser}>`
  try {
    await sendViaGmail(gmailUser, gmailPass, from, to, inq.email, subject, text, html)
    return true
  } catch (err) {
    console.error('[collab] email notify failed:', err instanceof Error ? err.message : err)
    return false
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

  // Honeypot: a bot fills the hidden "website" field. Pretend success, do nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return json({ ok: true })
  }

  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim()
  const message = String(body.message ?? '').trim()
  if (name.length < 1 || name.length > 120) return json({ error: 'Please enter your name.' }, 400)
  if (!EMAIL_RE.test(email)) return json({ error: 'Please enter a valid email.' }, 400)
  if (message.length < 1 || message.length > 4000) return json({ error: 'Please include a message.' }, 400)

  const company = String(body.company ?? '').slice(0, 160)
  const budget = String(body.budget ?? '').slice(0, 120)
  const deliverables = Array.isArray(body.deliverables) ? body.deliverables.map(String).slice(0, 20) : []
  const sourcePath = String(body.sourcePath ?? '/')
  const inq: Inquiry = { name, email, company, budget, deliverables, message, sourcePath }
  const receivedAt = new Date()

  // 1) Kick off the email send NOW; it runs concurrently with the DB write and
  //    (notifyByEmail never throws) resolves to whether it was sent.
  const emailPromise = notifyByEmail(inq, receivedAt)

  // 2) Best-effort DB write — a triage record in the studio Inbox when online.
  //    A failure here never loses the inquiry (the email still carries it).
  let dbSaved = false
  try {
    const ipRaw = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim()
    const ipHash = ipRaw ? (await sha256Hex(ipRaw + IP_SALT)).slice(0, 32) : ''
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await supabase.from('collab_inquiries').insert({
      name,
      email,
      company,
      budget,
      message,
      deliverables,
      source_path: sourcePath,
      ip_hash: ipHash,
      user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300),
      status: 'new',
    })
    if (error) console.error('[collab] DB insert failed:', error.message)
    else dbSaved = true
  } catch (err) {
    console.error('[collab] DB insert threw:', err instanceof Error ? err.message : err)
  }

  // 3a) FAST PATH — the DB durably captured the brief, so confirm immediately and
  //     let the ~7s SMTP send finish in the background (falls back to awaiting it
  //     if this runtime can't background, so the email is never dropped).
  if (dbSaved) {
    if (!runInBackground(emailPromise)) await emailPromise
    return json({ ok: true })
  }

  // 3b) DB write failed — email is now the ONLY channel. Await it and report the
  //     real outcome. Success if it went out; 502 only if BOTH channels failed.
  const emailSent = await emailPromise
  if (emailSent) return json({ ok: true })
  return json({ error: 'Could not submit right now. Please email me directly.' }, 502)
})
