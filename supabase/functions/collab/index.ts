// `collab` Edge Function — public "Work with me" submissions → a record in the studio
// Inbox, FILED into the influencer's Gmail Inbox.
//
// The static site has no server, so the public media-kit form POSTs here (via
// supabase.functions.invoke in lib/mediakit/collab.ts). Honeypot + server-side
// validation mirroring the DB CHECKs run first.
//
// DELIVERY: the inquiry inbox is the same Gmail account the studio connects for
// outreach, so an emailed notification is a self-send — and Gmail files those under
// All Mail without the Inbox label, which is why the old SMTP notifications went
// unseen (and why the form spent a while opening the brand's own mail app instead,
// losing every brief the brand never pressed Send on). The brief is now IMPORTED
// into that mailbox with the Inbox + Unread labels (users.messages.import): nothing
// is sent, so it can't be misfiled and costs the outreach account no send volume.
//
// The response says `filed`. When filing isn't possible — account not connected, the
// gmail.insert scope not granted yet, Gmail down, or the per-IP limit hit — the form
// falls back to opening the brand's mail app, so a brief is never left only in a
// studio the influencer may not open.
//
// SMTP (GMAIL_SMTP_PASSWORD, a Google App Password) survives only as the last resort
// when the DB write AND filing both fail: a lead under All Mail beats a lead nowhere.
//
// Deploy:  ./node_modules/.bin/supabase functions deploy collab --no-verify-jwt --use-api
//   --no-verify-jwt because this is a PUBLIC endpoint; the honeypot + validation +
//   per-IP limit + RLS are the protection, not a JWT.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import { json, preflight } from '../_shared/http.ts'
import {
  canImportMessages,
  googleCreds,
  GoogleAuthError,
  importMessage,
  refreshAccessToken,
} from '../_shared/gmail.ts'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const IP_SALT = 'simxmargo-collab-v1' // not a secret; just so stored hashes aren't a plain-IP rainbow lookup

// Filing limits. The endpoint is public and every filed brief is a message in the
// influencer's real Inbox, so a script must not be able to fill it. Past either limit a
// submission still lands in the studio for triage; it just isn't filed.
//
// The per-IP limit is best effort only: the client IP comes from forwarding headers a
// caller can forge, so rotating a fake address resets it. The GLOBAL ceiling is the
// guarantee — no header moves it. Real volume is a few briefs a month, so 20 an hour
// only ever binds on a flood, and a legitimate brand caught in one is sent to the
// mail-app fallback rather than lost.
const FILE_PER_IP_PER_HOUR = 5
const FILE_PER_HOUR_TOTAL = 20

// Filing must answer well inside the form's 20s client timeout (lib/mediakit/collab.ts).
// Past this the brief is reported unfiled and the brand gets the fallback; if Gmail
// still accepts it late, the cost is a duplicate — never a lost lead.
const FILE_DEADLINE_MS = 10_000

// The From on a filed brief. Never the brand's typed address: that field is
// attacker-controlled, and a filed message "from security@google.com" would be a
// phishing email planted in the influencer's own Inbox. Never the account's own
// address either, or Gmail lists every inquiry as "me". `.invalid` is reserved
// (RFC 2606) so it can't belong to anyone; replies go to the brand via Reply-To.
const FILED_FROM = 'media-kit@simxmargo.invalid'

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
  '\u00A0': ' ', // non-breaking space
}
const PUNCT_RE = /[—–‒‘’“”…·•\u00A0]/g
function normalizePunct(s: string): string {
  return s.replace(PUNCT_RE, (c) => PUNCT[c] ?? c)
}

// Escape user-supplied text before interpolating it into the HTML email body, so
// a brand's message can't break the markup (or inject). The body may keep
// non-ASCII (accented names etc.); only the SUBJECT must stay strict ASCII.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Subjects MUST be a clean single-line header. Normalize punctuation, strip any
// remaining non-printable-ASCII (CR/LF included, so no header injection), collapse
// whitespace, and cap the length so no encoded-word / folding is ever produced.
function asciiSubject(s: string): string {
  return normalizePunct(s)
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

// The brand's name + company as a From DISPLAY label (scannable in the inbox). The
// address is never theirs — see FILED_FROM. Strip chars that would break a header.
function displayNameFor(inq: Inquiry): string {
  const raw = `${inq.name}${inq.company ? ` - ${inq.company}` : ''}`
  const clean = normalizePunct(raw)
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/["<>@,;:()\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
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

interface Notification {
  subject: string
  text: string
  html: string
}

// The brief as the influencer reads it — shared by Gmail filing and the SMTP fallback.
// LAYOUT: the brand's DETAILS lead, then the Package/Budget asks, then the contact
// block in order — Brand, Name, Email, Received.
function composeNotification(inq: Inquiry, receivedAt: Date): Notification {
  const subject = asciiSubject(`Collab inquiry: ${inq.name}${inq.company ? ` (${inq.company})` : ''}`)
  const received = formatReceived(receivedAt)
  const footer = `Sent through your media kit form. Reply to answer ${inq.name} directly.`

  const briefLines = [inq.message]
  if (inq.deliverables.length) briefLines.push('', `Package: ${inq.deliverables.join(', ')}`)
  if (inq.budget) briefLines.push(`Budget: ${inq.budget}`)

  const contactLines: string[] = []
  if (inq.company) contactLines.push(`Brand: ${inq.company}`)
  contactLines.push(`Name: ${inq.name}`, `Email: ${inq.email}`, `Received: ${received}`)

  const text = normalizePunct([...briefLines, '', ...contactLines, '', '---', footer].join('\n'))

  // HTML alternative — plain default-Gmail typography. The DETAILS lead reads like a
  // typed message body; the detail card below it is centered as a block.
  const row = (label: string, value: string) =>
    `<tr><td style="padding:2px 16px 2px 0;color:#777;vertical-align:top;white-space:nowrap;">${label}</td>` +
    `<td style="padding:2px 0;">${value}</td></tr>`
  const html = normalizePunct(
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#222;">` +
      `<div style="font-size:13px;line-height:1.45;white-space:pre-wrap;">${escapeHtml(inq.message)}</div>` +
      `<div style="text-align:center;margin-top:18px;">` +
        (inq.deliverables.length
          ? `<p style="margin:0;"><strong>Package:</strong> ${escapeHtml(inq.deliverables.join(', '))}</p>`
          : '') +
        (inq.budget ? `<p style="margin:2px 0 0;"><strong>Budget:</strong> ${escapeHtml(inq.budget)}</p>` : '') +
        `<div style="display:inline-block;text-align:left;border-top:1px solid #e6e6e6;padding-top:12px;margin-top:12px;">` +
          `<table style="border-collapse:collapse;">` +
          (inq.company ? row('Brand', escapeHtml(inq.company)) : '') +
          row('Name', escapeHtml(inq.name)) +
          row('Email', `<a href="mailto:${escapeHtml(inq.email)}" style="color:#1155cc;">${escapeHtml(inq.email)}</a>`) +
          row('Received', escapeHtml(received)) +
          `</table>` +
        `</div>` +
        `<p style="margin:14px 0 0;"><strong>${escapeHtml(footer)}</strong></p>` +
      `</div>` +
      `</div>`,
  )

  return { subject, text, html }
}

function serviceClient(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// Best available client IP. Proxy headers first, then the leftmost x-forwarded-for
// entry; none is trustworthy unless the gateway strips client copies, which is why the
// global ceiling, not this, is what bounds a flood.
function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    (req.headers.get('x-forwarded-for') ?? '').split(',')[0]
  ).trim()
}

// Whether filing is over either limit. Read with the service role because the table is
// insert-only for anon. A count that errors fails CLOSED; a request with no IP skips
// only the per-IP check and stays under the global ceiling.
async function overFilingLimit(svc: SupabaseClient, ipHash: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const total = await svc
    .from('collab_inquiries')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since)
  if (total.error || (total.count ?? 0) >= FILE_PER_HOUR_TOTAL) return true
  if (!ipHash) return false // the global ceiling above still bounds this caller

  const fromIp = await svc
    .from('collab_inquiries')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', since)
  return Boolean(fromIp.error) || (fromIp.count ?? 0) >= FILE_PER_IP_PER_HOUR
}

// Resolve with `fallback` if `p` hasn't settled in time. The work itself keeps running;
// this only stops the response waiting on it.
function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))])
}

// File the brief into the connected account's Inbox. Returns false — never throws —
// when the account isn't connected, hasn't granted gmail.insert yet, or Gmail fails;
// the caller reports that as "not filed" and the form falls back.
async function fileInGmail(svc: SupabaseClient, inq: Inquiry, receivedAt: Date): Promise<boolean> {
  const creds = googleCreds()
  if (!creds) return false

  const { data: account } = await svc
    .from('gmail_account')
    .select('email, refresh_token, scope')
    .eq('id', 1)
    .maybeSingle()
  if (!account?.refresh_token || !account.email || !canImportMessages(account.scope ?? '')) return false

  const { subject, text, html } = composeNotification(inq, receivedAt)
  try {
    const { accessToken } = await refreshAccessToken(creds, account.refresh_token)
    await importMessage(accessToken, {
      to: account.email,
      subject,
      text,
      html,
      fromEmail: FILED_FROM,
      fromName: `${displayNameFor(inq)} via media kit`,
      replyTo: inq.email, // pressing Reply in Gmail answers the brand
    })
    return true
  } catch (err) {
    // A rejected grant is the Settings card's to show; a transient failure is not.
    if (err instanceof GoogleAuthError && err.invalidGrant) {
      await svc
        .from('gmail_account')
        .update({
          needs_reauth: true,
          reauth_reason: 'Google rejected the saved token. Reconnect the account.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1)
    }
    console.error('[collab] gmail filing failed:', err instanceof Error ? err.message : err)
    return false
  }
}

// Transport for the last-resort SMTP notification. Port 465 implicit TLS (STARTTLS
// on 587 is flaky from Edge Functions); closed in finally so a timeout can't leak it.
async function sendViaGmail(
  user: string,
  pass: string,
  from: string,
  to: string,
  replyTo: string,
  n: Notification,
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
      client.send({ from, to, replyTo, subject: n.subject, content: n.text, html: n.html }),
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

// Last resort only (see header). Returns whether it sent; never throws.
async function notifyByEmail(inq: Inquiry, receivedAt: Date): Promise<boolean> {
  const gmailPass = Deno.env.get('GMAIL_SMTP_PASSWORD')
  if (!gmailPass) {
    console.error('[collab] GMAIL_SMTP_PASSWORD not set — SMTP fallback skipped')
    return false
  }
  const gmailUser = Deno.env.get('GMAIL_SMTP_USER') || 'simxmargo.collabs@gmail.com'
  const to = Deno.env.get('COLLAB_NOTIFY_TO') || 'simxmargo.collabs@gmail.com'
  // SMTP must send AS the authenticated account; the brand stays in the display label.
  const from = `${displayNameFor(inq)} <${gmailUser}>`
  try {
    await sendViaGmail(gmailUser, gmailPass, from, to, inq.email, composeNotification(inq, receivedAt))
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

  // Honeypot: a bot fills the hidden "website" field. Pretend it was delivered, do
  // nothing — `filed: true` so the bot never sees the fallback composer either.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return json({ ok: true, filed: true })
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

  // The current form asks to be filed. The page it replaces posts `notify: false`
  // because it still opens the brand's own mail app — filing on top of that would
  // hand the influencer every brief twice, so an old cached page keeps its behaviour.
  const wantFile = body.notify !== false

  const ipRaw = clientIp(req)
  const ipHash = ipRaw ? (await sha256Hex(ipRaw + IP_SALT)).slice(0, 32) : ''
  const svc = serviceClient()

  // Counted BEFORE this insert, so the submission never counts against itself.
  const throttled = !svc || (await overFilingLimit(svc, ipHash))
  const fileNow = (): Promise<boolean> =>
    svc ? withDeadline(fileInGmail(svc, inq, receivedAt), FILE_DEADLINE_MS, false) : Promise.resolve(false)
  const attempted = wantFile && !throttled
  const filePromise = attempted ? fileNow() : Promise.resolve(false)

  // The studio record, concurrent with filing. Anon key, so it stays RLS-bound.
  let dbSaved = false
  try {
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

  // Awaited rather than backgrounded: the form needs `filed` to know whether to offer
  // the brand their own mail app instead.
  let filed = await filePromise
  if (dbSaved) return json({ ok: true, filed })

  // DB write failed — Gmail is now the only record, so file it even if this client
  // didn't ask. Only when it was never attempted: a retry after a timed-out import can
  // file the brief twice (Gmail may have accepted it late) and would stack another
  // deadline onto a response the form has already given up on. Never when throttled.
  if (!attempted && !throttled) filed = await fileNow()
  if (filed) return json({ ok: true, filed: true })

  if (await notifyByEmail(inq, receivedAt)) return json({ ok: true, filed: false })
  return json({ error: 'Could not submit right now. Please email me directly.' }, 502)
})
