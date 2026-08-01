// Hand the finished brief to the VISITOR's own email client instead of sending
// one ourselves.
//
// WHY: the form used to POST the brief and have the `collab` Edge Function email
// it to the influencer FROM the influencer's own Gmail account. Gmail files a
// self-addressed message under All Mail/Sent and does not apply the Inbox label,
// so those notifications were effectively invisible — and pressing Reply answered
// yourself instead of the brand.
//
// Now the brand presses send in their own client, so an ordinary email arrives
// from an ordinary sender: it lands in the Inbox, threads properly, and Reply
// goes back to the brand. It also survives the free-tier Supabase project being
// paused, because nothing on this path touches our infrastructure.

export type ComposeProvider = 'gmail' | 'outlook' | 'mailto'

export const PROVIDER_LABEL: Record<ComposeProvider, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
  mailto: 'Mail app',
}

// Webmail domains we can open directly. Everything else falls through to
// `mailto:`, which hands off to whatever handler the device has registered.
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])
const OUTLOOK_DOMAINS = new Set(['outlook.com', 'hotmail.com', 'live.com', 'msn.com'])

// Pick the provider to offer FIRST, from the address the visitor typed. This is a
// hint, never a decision: a brand on a custom domain may sit on Workspace or
// Microsoft 365 either way, so the UI always keeps the other options visible.
export function detectProvider(email: string): ComposeProvider {
  const domain = email.split('@')[1]?.trim().toLowerCase()
  if (!domain) return 'mailto'
  if (GMAIL_DOMAINS.has(domain)) return 'gmail'
  if (OUTLOOK_DOMAINS.has(domain)) return 'outlook'
  return 'mailto'
}

export interface BriefInput {
  /** The influencer — who the brand is writing TO. */
  toName?: string
  /** The brand's own name, used to sign off. */
  name: string
  company?: string
  deliverable?: string
  message: string
}

export interface Brief {
  subject: string
  body: string
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

// Compose the message the brand will send. Plain text with CRLF line breaks —
// some desktop `mailto:` handlers only break lines on CRLF, and every webmail
// composer accepts it.
export function buildBrief(i: BriefInput): Brief {
  const brand = i.company?.trim()
  const sender = i.name.trim()
  const subject = brand ? `Collab inquiry - ${brand}` : `Collab inquiry from ${sender}`

  const greeting = (i.toName ?? '').trim().split(/\s+/)[0] || 'there'
  const lines = [`Hi ${greeting},`, '', i.message.trim(), '']
  if (i.deliverable) lines.push(`Package: ${i.deliverable}`)
  if (brand) lines.push(`Brand: ${brand}`)
  if (i.deliverable || brand) lines.push('')
  lines.push('Thanks,', sender)

  return { subject: clip(subject, 150), body: lines.join('\r\n') }
}

export function composeUrl(provider: ComposeProvider, to: string, brief: Brief): string {
  const su = encodeURIComponent(brief.subject)
  const body = encodeURIComponent(brief.body)
  switch (provider) {
    case 'gmail':
      return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${su}&body=${body}`
    case 'outlook':
      return `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(to)}&subject=${su}&body=${body}`
    default:
      // The address stays unencoded here — every handler accepts it verbatim, and
      // a percent-encoded "@" confuses some older desktop clients.
      return `mailto:${to}?subject=${su}&body=${body}`
  }
}

// MUST be called straight from a click handler with no `await` before it, or the
// popup blocker kills the web-composer window.
export function openCompose(url: string, provider: ComposeProvider): void {
  if (provider === 'mailto') {
    // Hands off to the OS handler; `window.open` would strand a blank tab.
    window.location.href = url
    return
  }
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) window.location.href = url // popup blocked — navigate instead
}

// Everything the brand would otherwise retype, for the "copy the brief" escape
// hatch (no mail handler, corporate lockdown, or an over-long `mailto:` that a
// desktop client truncated).
export function briefAsText(to: string, brief: Brief): string {
  return [`To: ${to}`, `Subject: ${brief.subject}`, '', brief.body].join('\r\n')
}
