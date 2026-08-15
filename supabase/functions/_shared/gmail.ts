// Google OAuth + Gmail helpers, shared by `gmail-oauth` (and, later, `send-one`).
//
// Dependency-free `fetch` against Google's OAuth endpoints — no googleapis SDK, which
// would blow past the Edge Function bundle budget for what is four HTTP calls.
//
// Scope choice (docs/BACKEND_DESIGN.md §6b): `gmail.send` is classified SENSITIVE
// (not Restricted), so a personal, UNVERIFIED OAuth app can use it with you as the
// test user. `openid` + `email` are NON-sensitive and don't raise that tier — we add
// them purely so the callback can learn WHICH address just got connected (gmail.send
// alone cannot call users.getProfile).
//
// Secrets (Edge Function secrets, never the browser):
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET
//
// THE #1 GOTCHA: while the OAuth app is in "Testing", Google expires refresh tokens
// after 7 days. Flip the app to "In Production" (it can stay unverified) or you will
// be reconnecting every week. `GoogleAuthError.invalidGrant` is how that failure
// surfaces here — the caller flips gmail_account.needs_reauth so the UI can say so.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

const TIMEOUT_MS = 15_000

// gmail.readonly is what BOUNCE DETECTION needs: DSNs from mailer-daemon land as
// ordinary inbox messages, and send-only scope cannot see them. NOTE the tier jump:
// gmail.readonly is a RESTRICTED scope (gmail.send is only Sensitive), so on an
// unverified app Google's consent screen shows the harsher "unverified app" warning
// — acceptable for this single-owner app, but it means the influencer must click
// through "Advanced" once when reconnecting. Accounts connected before this scope
// was added keep working for SENDING; the bounce sweep checks the granted scope
// string and simply skips until a reconnect grants it.
export const GMAIL_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
]

export interface GoogleCreds {
  clientId: string
  clientSecret: string
}

// Typed error so callers can distinguish "the user revoked us / the token expired"
// (permanent — needs a human to reconnect) from a transient network/5xx failure.
export class GoogleAuthError extends Error {
  invalidGrant: boolean
  constructor(message: string, invalidGrant = false) {
    super(message)
    this.name = 'GoogleAuthError'
    this.invalidGrant = invalidGrant
  }
}

// Read the OAuth app credentials from Edge Function secrets. Returns null when
// unset so the handler can answer a calm, actionable 503 instead of throwing —
// same graceful-degradation convention as enrich/qualify without their API keys.
export function googleCreds(): GoogleCreds | null {
  const clientId = Deno.env.get('GMAIL_CLIENT_ID') ?? ''
  const clientSecret = Deno.env.get('GMAIL_CLIENT_SECRET') ?? ''
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

// The consent screen URL the studio opens in a popup.
//
// `access_type=offline` + `prompt=consent` together are what GUARANTEE a
// refresh_token comes back. Google omits the refresh token on a re-consent unless
// you force the prompt, and a connect flow that returns no refresh token is useless
// to us — we'd be able to send once and never again.
export function consentUrl(creds: GoogleCreds, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_URL}?${p.toString()}`
}

// Shared POST-form → JSON against Google's token endpoints, with a hard timeout and
// Google's `{error, error_description}` body unwrapped into a typed error.
async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    throw new GoogleAuthError(`Could not reach Google: ${(e as Error).message}`)
  }

  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    /* Google returned non-JSON (an HTML error page) — fall through to the status */
  }

  if (!res.ok) {
    const code = typeof body.error === 'string' ? body.error : `http_${res.status}`
    const detail = typeof body.error_description === 'string' ? body.error_description : ''
    throw new GoogleAuthError(detail ? `${code}: ${detail}` : code, code === 'invalid_grant')
  }
  return body
}

export interface TokenSet {
  accessToken: string
  refreshToken: string // '' when Google withheld one (see consentUrl)
  scope: string
  expiresIn: number
}

// Step 2 of the consent flow: swap the one-time `code` for tokens.
export async function exchangeCode(
  creds: GoogleCreds,
  code: string,
  redirectUri: string,
): Promise<TokenSet> {
  const b = await postForm(TOKEN_URL, {
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  return {
    accessToken: typeof b.access_token === 'string' ? b.access_token : '',
    refreshToken: typeof b.refresh_token === 'string' ? b.refresh_token : '',
    scope: typeof b.scope === 'string' ? b.scope : '',
    expiresIn: typeof b.expires_in === 'number' ? b.expires_in : 0,
  }
}

// Trade the stored refresh token for a short-lived access token. This is both how
// `send-one` will authenticate each send AND how the Settings "Test connection"
// button proves the account is still live without sending anything.
export async function refreshAccessToken(
  creds: GoogleCreds,
  refreshToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const b = await postForm(TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: 'refresh_token',
  })
  const accessToken = typeof b.access_token === 'string' ? b.access_token : ''
  if (!accessToken) throw new GoogleAuthError('Google returned no access token.')
  return { accessToken, expiresIn: typeof b.expires_in === 'number' ? b.expires_in : 0 }
}

// Best-effort revoke on disconnect. Google answers 200 for a valid token and 400 for
// an already-dead one; either way the local row is cleared by the caller, so this
// never blocks a disconnect — it just avoids leaving a live grant behind.
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

// ── Sending ─────────────────────────────────────────────────────────────────────
//
// `users.messages.send` takes ONE field: `raw`, a base64url-encoded RFC-2822 message.
// There is no "to/subject/body" JSON shape — we assemble the MIME ourselves. The two
// things that bite here, both handled below:
//   1. btoa() is latin1-only, so any non-ASCII byte (the "×" in "Mejuri × simxmargo",
//      a curly apostrophe) throws InvalidCharacterError. Everything goes through
//      TextEncoder first.
//   2. Non-ASCII in HEADERS is not just an encoding question — raw UTF-8 in a Subject
//      is illegal per RFC 5322 and mail servers mangle it. Headers get RFC-2047
//      encoded-word treatment instead.

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

const textEncoder = new TextEncoder()

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

const base64Utf8 = (s: string): string => bytesToBase64(textEncoder.encode(s))

// RFC 2045 caps encoded lines at 76 chars. Gmail tolerates longer, but strict
// receiving MTAs do not, and a wrapped body costs nothing.
const wrap76 = (s: string): string => s.replace(/(.{76})/g, '$1\r\n')

// base64url — the alphabet the Gmail API expects for `raw` (no padding).
const base64Url = (s: string): string =>
  base64Utf8(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// RFC 2047 encoded-word, applied only when a header actually needs it.
function encodeHeader(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${base64Utf8(value)}?=`
}

// `Display Name <addr@host>` with the display part encoded independently — the
// address itself must stay bare ASCII or the header is invalid.
function addressHeader(email: string, name?: string): string {
  const n = (name ?? '').trim()
  return n ? `"${encodeHeader(n).replace(/"/g, '')}" <${email}>` : email
}

export interface OutgoingMessage {
  to: string
  subject: string
  text: string // plain-text part (the pitch as written + text signature)
  html: string // HTML alternative (same pitch + the image signature)
  fromEmail: string // the connected Gmail address
  fromName?: string // optional display name shown in the recipient's inbox
  replyTo?: string // where replies actually go — the creator's real address
}

// multipart/alternative: the SAME message twice, plain text first. Order is
// significant — clients render the LAST part they can display, so the HTML must come
// second or nobody ever sees the signature image.
export function buildMime(msg: OutgoingMessage): string {
  // 64 bits is ample for a delimiter that only has to not occur in the body, and it
  // keeps the Content-Type header inside RFC 5322's recommended 78-char line — a full
  // UUID pushed that one header to 85.
  const boundary = `=_alt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`

  const headers = [
    `From: ${addressHeader(msg.fromEmail, msg.fromName)}`,
    `To: ${msg.to}`,
    ...(msg.replyTo ? [`Reply-To: ${msg.replyTo}`] : []),
    `Subject: ${encodeHeader(msg.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]

  return [
    headers.join('\r\n'),
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    wrap76(base64Utf8(msg.text)),
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    wrap76(base64Utf8(msg.html)),
    `--${boundary}--`,
    ``,
  ].join('\r\n')
}

export interface SentMessage {
  id: string
  threadId: string
}

// Send one message as the connected account. `accessToken` is the short-lived token
// from refreshAccessToken() — never the refresh token itself.
export async function sendMessage(accessToken: string, msg: OutgoingMessage): Promise<SentMessage> {
  let res: Response
  try {
    res = await fetch(SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ raw: base64Url(buildMime(msg)) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    throw new GoogleAuthError(`Could not reach Gmail: ${(e as Error).message}`)
  }

  const body = await res.json().catch(() => ({}) as Record<string, unknown>)

  if (!res.ok) {
    const err = (body as { error?: { message?: string; status?: string } }).error
    const detail = err?.message || `http_${res.status}`
    // 401 here means the ACCESS token was rejected. That is usually a revoked grant,
    // and the caller flips needs_reauth on it — but unlike the token endpoint there is
    // no `invalid_grant` code to key off, so the status is what we have.
    throw new GoogleAuthError(detail, res.status === 401)
  }

  const sent = body as { id?: string; threadId?: string }
  return { id: sent.id ?? '', threadId: sent.threadId ?? '' }
}

// ── Reading (bounce detection only) ─────────────────────────────────────────────
//
// Both calls require gmail.readonly on the granted token; the caller gates on the
// stored scope string first, so a send-only account never even attempts them.

const MESSAGES_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'

// Message ids matching a Gmail search query — the same `q` syntax as the search box.
export async function listMessageIds(accessToken: string, q: string, maxResults = 20): Promise<string[]> {
  const p = new URLSearchParams({ q, maxResults: String(maxResults) })
  let res: Response
  try {
    res = await fetch(`${MESSAGES_URL}?${p}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    throw new GoogleAuthError(`Could not reach Gmail: ${(e as Error).message}`)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>)
    const err = (body as { error?: { message?: string } }).error
    throw new GoogleAuthError(err?.message || `http_${res.status}`, res.status === 401 || res.status === 403)
  }
  const j = (await res.json()) as { messages?: { id?: string }[] }
  return (j.messages ?? []).map((m) => m.id ?? '').filter(Boolean)
}

interface GmailPart {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPart[]
}

// base64url → UTF-8 text. Gmail pads part data with -/_ alphabet and no padding.
function decodePartData(data: string): string {
  try {
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

// Flatten every text-bearing part. DSNs hide the failed address in
// message/delivery-status parts as often as in the human-readable text.
function collectText(part: GmailPart | undefined, out: string[]): void {
  if (!part) return
  const mime = part.mimeType ?? ''
  if (part.body?.data && (mime.startsWith('text/') || mime.startsWith('message/'))) {
    out.push(decodePartData(part.body.data))
  }
  for (const p of part.parts ?? []) collectText(p, out)
}

export interface FetchedMessage {
  headers: Record<string, string>
  text: string
}

// One full message: lower-cased header map + all text parts concatenated.
export async function getMessage(accessToken: string, id: string): Promise<FetchedMessage> {
  let res: Response
  try {
    res = await fetch(`${MESSAGES_URL}/${encodeURIComponent(id)}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    throw new GoogleAuthError(`Could not reach Gmail: ${(e as Error).message}`)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>)
    const err = (body as { error?: { message?: string } }).error
    throw new GoogleAuthError(err?.message || `http_${res.status}`, res.status === 401 || res.status === 403)
  }
  const j = (await res.json()) as {
    payload?: GmailPart & { headers?: { name?: string; value?: string }[] }
  }
  const headers: Record<string, string> = {}
  for (const h of j.payload?.headers ?? []) {
    if (h.name) headers[h.name.toLowerCase()] = h.value ?? ''
  }
  const texts: string[] = []
  collectText(j.payload, texts)
  return { headers, text: texts.join('\n') }
}

// Which address did the user just connect? Uses the OIDC userinfo endpoint (allowed
// by the `email` scope) — `gmail.send` on its own cannot read users.getProfile.
export async function fetchGoogleEmail(accessToken: string): Promise<string> {
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return ''
    const j = await res.json()
    return typeof j?.email === 'string' ? j.email : ''
  } catch {
    return '' // a missing display address must never fail an otherwise-good connect
  }
}
