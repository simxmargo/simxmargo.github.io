// `collab` Edge Function — public "Work with me" submissions → an email
// notification to the influencer's inbox, then a best-effort record in Supabase.
//
// The static site has no server, so the public media-kit form POSTs here (via
// supabase.functions.invoke in lib/mediakit/collab.ts). Honeypot + server-side
// validation mirroring the DB CHECKs run first.
//
// ORDER MATTERS (resilience): the EMAIL is sent FIRST — it is the guaranteed
// record, so a brand's brief still reaches the inbox even when the free-tier
// Supabase project is PAUSED/offline. The DB insert (a triage record in the
// studio Inbox) is then BEST-EFFORT: if it fails, the request still succeeds as
// long as the email went out. The request only fails (502) if BOTH channels fail.
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

// Notify the influencer. Returns true if the email was sent, false otherwise
// (missing transport secret, or a send failure). Never throws — the caller
// decides what to do with the outcome.
async function notifyByEmail(inq: Inquiry): Promise<boolean> {
  const gmailPass = Deno.env.get('GMAIL_SMTP_PASSWORD')
  if (!gmailPass) {
    console.error('[collab] GMAIL_SMTP_PASSWORD not set — email notification skipped')
    return false
  }
  const gmailUser = Deno.env.get('GMAIL_SMTP_USER') || 'simxmargo.collabs@gmail.com'
  const to = Deno.env.get('COLLAB_NOTIFY_TO') || 'simxmargo.collabs@gmail.com'

  const subject = asciiSubject(`New collab brief: ${inq.name}${inq.company ? ` (${inq.company})` : ''}`)
  const text = normalizePunct(
    [
      `Name: ${inq.name}`,
      `Email: ${inq.email}`,
      inq.company ? `Brand: ${inq.company}` : '',
      inq.budget ? `Budget: ${inq.budget}` : '',
      inq.deliverables.length ? `Package: ${inq.deliverables.join(', ')}` : '',
      '',
      inq.message,
      '',
      '---',
      `Sent from ${inq.sourcePath}. Reply to this email to answer ${inq.name} directly.`,
    ]
      .filter((l, i, a) => l !== '' || a[i - 1] !== '') // collapse double blanks
      .join('\n'),
  )

  try {
    await sendViaGmail(gmailUser, gmailPass, to, inq.email, subject, text)
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

  // 1) EMAIL FIRST — the guaranteed record. Even if Supabase is paused/offline,
  //    the brand's brief still reaches the inbox.
  const emailSent = await notifyByEmail(inq)

  // 2) Best-effort DB write — a triage record in the studio Inbox when online.
  //    A failure here never loses the inquiry (the email already carries it).
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
    if (error) console.error(`[collab] DB insert failed (email ${emailSent ? 'sent' : 'also failed'}):`, error.message)
    else dbSaved = true
  } catch (err) {
    console.error('[collab] DB insert threw:', err instanceof Error ? err.message : err)
  }

  // Success if EITHER channel captured the brief. Only fail if both did.
  if (emailSent || dbSaved) return json({ ok: true })
  return json({ error: 'Could not submit right now. Please email me directly.' }, 502)
})
