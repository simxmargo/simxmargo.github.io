import { supabaseBrowser } from '@/lib/supabase/browser'
import { fnErrorMessage } from '@/lib/admin/fnError'

// Browser-only data layer for ACTUALLY SENDING outreach mail.
//
// The browser hands over only a recipient, a subject and a plain-text body. Everything
// that determines identity — which Gmail account sends, the Reply-To, the signature,
// and the daily cap — is decided server-side in the `send-email` Edge Function, which
// is the only place the refresh token exists. Nothing here can be tampered with from
// devtools to send as someone else or past the cap.

export interface SendResult {
  id: string // Gmail message id
  sentAt: string
  /** Set when the mail went out but the follow-up bookkeeping write failed. */
  warning?: string
}

export interface SendEmailInput {
  to: string
  subject: string
  text: string
  /** Omit for a self-addressed test send — those are exempt from the daily cap. */
  contactId?: string
}

async function callSendEmail<T>(body: Record<string, unknown>): Promise<T> {
  const sb = supabaseBrowser
  if (!sb) throw new Error('Studio is not configured.')

  const { data, error } = await sb.functions.invoke('send-email', { body })
  if (error) throw new Error(await fnErrorMessage(error, 'Could not reach the sending service.'))
  return data as T
}

export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const r = await callSendEmail<{ id?: string; sentAt?: string; warning?: string }>({
    action: 'send',
    to: input.to,
    subject: input.subject,
    text: input.text,
    ...(input.contactId ? { contactId: input.contactId } : {}),
  })
  return { id: r.id ?? '', sentAt: r.sentAt ?? new Date().toISOString(), warning: r.warning }
}

// The signature exactly as a real send would append it. Rendered in Settings so the
// preview can never drift from what actually goes out — there is one implementation
// (supabase/functions/_shared/signature.ts) and the UI asks it what it produces.
export async function previewSignature(): Promise<{ html: string; text: string }> {
  const r = await callSendEmail<{ signature?: { html?: string; text?: string } }>({
    action: 'preview',
  })
  return { html: r.signature?.html ?? '', text: r.signature?.text ?? '' }
}
