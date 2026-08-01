'use client'

import { useEffect, useRef, useState } from 'react'
import { Mail, MailCheck, AlertTriangle, Loader2, CheckCircle2, Unplug, SendHorizonal } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { startGmailConnect, disconnectGmail, type SendingAccount } from '@/lib/admin/resources/sendingAccount'
import { sendEmail } from '@/lib/admin/resources/sendEmail'
import { useAdminResource, adminKeys, type AdminFetchError } from '@/lib/admin/queries'
import { useStore } from '@/lib/store'
import { buildDraft } from '@/lib/emailTemplate'
import type { Contact } from '@/lib/types'

// The first message this account ever sends must go to YOU, not a brand — a broken
// signature, a mangled subject or a wrong Reply-To is only cheap to discover on your
// own inbox. The Outreach workspace keeps "Queue for Outreach" disabled until a test
// lands (it gates on gmail_account.last_send_at being non-null).
const TEST_RECIPIENT = 'kitdaniellim@gmail.com'

// A stand-in contact so the test email is the REAL template output rather than a
// bespoke "this is a test" string — what you receive is what a brand receives.
const SAMPLE_CONTACT: Contact = {
  id: 'sample',
  brand: 'Sample Brand',
  email: TEST_RECIPIENT,
  emailType: 'partnerships',
  country: '',
  website: '',
  fitScore: null,
  fitReason: '',
  status: 'new',
  notes: '',
  lastEmailedAt: null,
  createdAt: '',
}

// Settings → Sending account. Connect / verify / disconnect the Gmail account the
// outreach pipeline sends FROM (docs/BACKEND_DESIGN.md §6b, docs/GMAIL_SENDING_SETUP.md).
//
// The whole OAuth handshake happens server-side in the `gmail-oauth` Edge Function;
// this component only (1) asks for a consent URL, (2) opens it in a popup, and
// (3) polls the admin-gated status RPC until the connection lands. The refresh token
// is never readable from the browser — see lib/admin/resources/sendingAccount.ts.

const POLL_MS = 2_500
const POLL_TIMEOUT_MS = 3 * 60 * 1000 // give up after 3 minutes of an open popup

type Phase = 'idle' | 'connecting' | 'disconnecting' | 'sending'

function formatDay(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function SendingAccountCard() {
  const qc = useQueryClient()
  const q = useAdminResource<SendingAccount>('sendingAccount')
  const account = q.data

  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmOff, setConfirmOff] = useState(false)

  const profile = useStore((s) => s.profile)
  const emailTemplate = useStore((s) => s.emailTemplate)
  const [testTo, setTestTo] = useState(TEST_RECIPIENT)

  const popupRef = useRef<Window | null>(null)
  const pollRef = useRef<number | null>(null)

  // A popup left open when the admin navigates away would keep an interval alive
  // forever. Tear both down on unmount.
  useEffect(() => {
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current)
    }
  }, [])

  function stopPolling(): void {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
    popupRef.current = null
    setPhase('idle')
  }

  async function onConnect(): Promise<void> {
    setError('')
    setNotice('')
    setConfirmOff(false)

    // Open the popup SYNCHRONOUSLY inside the click handler, then point it at the
    // consent URL once the async call resolves. Opening it after the await would be
    // an untrusted popup and blocked by every browser.
    const popup = window.open('about:blank', 'gmail-oauth', 'width=520,height=720')
    if (!popup) {
      setError('Your browser blocked the popup. Allow popups for this site and try again.')
      return
    }
    popupRef.current = popup
    setPhase('connecting')

    let url: string
    try {
      url = await startGmailConnect()
    } catch (e) {
      popup.close()
      stopPolling()
      setError(e instanceof Error ? e.message : 'Could not start the Google connection.')
      return
    }
    popup.location.href = url

    // Poll the status RPC rather than listening for a postMessage from the callback:
    // the studio can be served from localhost OR github.io, so there is no single
    // trusted origin to validate a message against. Polling needs no such assumption.
    let elapsed = 0
    pollRef.current = window.setInterval(() => {
      void (async () => {
        elapsed += POLL_MS
        // Read `closed` BEFORE refetching, so a popup that closes right after a
        // successful consent still gets one final status read below.
        const closed = popupRef.current?.closed ?? true
        const res = await q.refetch()

        if (res.data?.connected) {
          stopPolling()
          popupRef.current?.close()
          setNotice(res.data.email ? `Connected ${res.data.email}.` : 'Sending account connected.')
          return
        }
        if (closed) {
          stopPolling()
          setError('The Google window closed before the connection finished. Try again.')
          return
        }
        if (elapsed >= POLL_TIMEOUT_MS) {
          stopPolling()
          setError('Timed out waiting for Google. Try connecting again.')
        }
      })()
    }, POLL_MS)
  }

  // A REAL send to your own inbox. It deliberately goes through the same
  // `send-email` action a brand send uses — a test that takes a different code path
  // proves nothing about the path that matters. Omitting contactId marks it as a
  // test, which exempts it from the daily cap and leaves no contact marked 'sent'.
  async function onSendTest(): Promise<void> {
    setPhase('sending')
    setError('')
    setNotice('')
    try {
      // Renders through the SAVED template — a test that used the built-in default
      // would prove nothing about the email you actually send.
      const draft = buildDraft(SAMPLE_CONTACT, profile, emailTemplate)
      await sendEmail({ to: testTo.trim(), subject: draft.subject, text: draft.body })
      setNotice(`Test email sent to ${testTo.trim()}. Check the inbox — subject, signature and Reply-To.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the test email.')
    } finally {
      setPhase('idle')
      // last_send_at just changed, and the Outreach workspace gates on it.
      void qc.invalidateQueries({ queryKey: adminKeys.sendingAccount })
    }
  }

  async function onDisconnect(): Promise<void> {
    setPhase('disconnecting')
    setError('')
    setNotice('')
    try {
      await disconnectGmail()
      setNotice('Sending account disconnected.')
      setConfirmOff(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disconnect.')
    } finally {
      setPhase('idle')
      void qc.invalidateQueries({ queryKey: adminKeys.sendingAccount })
    }
  }

  const loadErr = q.isError ? ((q.error as AdminFetchError | null)?.message ?? '') : ''
  const connected = account?.connected === true
  const setupPending = account?.setupPending === true
  const busy = phase !== 'idle'

  return (
    <section className="card">
      <div className="card-head">
        <span className={`ico-badge${connected ? ' ok' : ''}`}>
          {connected ? <MailCheck size={18} aria-hidden="true" /> : <Mail size={18} aria-hidden="true" />}
        </span>
        <h2 className="card-title">Sending account</h2>
        {connected && !account?.needsReauth && <span className="pill pill-ok">Connected</span>}
      </div>
      {/* Onboarding copy only earns its space BEFORE you connect. Once an account is
          live it's just noise above the thing it was explaining. */}
      {!connected && (
        <p className="card-sub indent">
          Connect a dedicated secondary Gmail. Replies route to your Reply-to email so brands reach you
          directly.
        </p>
      )}

      <div className="card-body">
        {/* The saved token was rejected by Google — almost always the "OAuth app left
            in Testing mode" 7-day expiry. Actionable, so it sits above the row. */}
        {account?.needsReauth && (
          <div className="banner banner-warn" role="alert" style={{ marginBottom: 14 }}>
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{account.reauthReason || 'Google rejected the saved token. Reconnect the account.'}</span>
          </div>
        )}

        {/* The card header already carries the mail icon and the Connected pill, so the
            row states only what neither can: which address, and when it last sent. */}
        <div className="connect">
          <div>
            <div className="connect-t">
              {q.isLoading
                ? 'Checking…'
                : connected
                  ? account?.email || 'Gmail account connected'
                  : 'No sending account connected'}
            </div>
            <div className="connect-s">
              {connected
                ? account?.lastSendAt
                  ? `Last sent ${formatDay(account.lastSendAt)}`
                  : 'No sends yet'
                : 'Use a fresh secondary inbox — never your main one.'}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {setupPending && <span className="tag">Setup pending</span>}

            {connected ? (
              <>
                {/* Disconnect is deliberately NOT in the healthy state — this account is
                    meant to stay connected, and a destructive control sitting next to a
                    safe one invites the misclick. It reappears only when the token is
                    already broken, which is the one time switching accounts is the
                    actual intent. Deleting it outright would leave no recovery path. */}
                {account?.needsReauth &&
                  (confirmOff ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => void onDisconnect()}
                        disabled={busy}
                      >
                        {phase === 'disconnecting' ? 'Disconnecting…' : 'Confirm disconnect'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setConfirmOff(false)}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setConfirmOff(true)}
                      disabled={busy}
                    >
                      <Unplug size={14} aria-hidden="true" /> Use another account
                    </button>
                  ))}
              </>
            ) : (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void onConnect()}
                disabled={busy || setupPending || q.isLoading}
                title={setupPending ? 'Run npm run db:apply to create the sending-account tables' : undefined}
              >
                {phase === 'connecting' ? (
                  <>
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Waiting for Google…
                  </>
                ) : (
                  <>
                    <Mail size={14} aria-hidden="true" /> {account?.needsReauth ? 'Reconnect Gmail' : 'Connect Gmail'}
                  </>
                )}
              </button>
            )}

            {phase === 'connecting' && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={stopPolling}>
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Test send + signature preview. Only meaningful once an account is
            connected, so the whole block is gated on that rather than rendering
            controls that can only fail. */}
        {connected && (
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <div className="connect-t" style={{ marginBottom: 4 }}>
              {account?.lastSendAt ? 'Send a test' : 'Send a test email first'}
            </div>
            {/* The long explanation is genuinely useful exactly once — while outreach
                is still locked. After that it's a wall of text above a button you
                already understand. */}
            <p className="field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
              {account?.lastSendAt
                ? 'Real template and signature. Doesn’t count against your daily cap.'
                : 'Outreach stays locked until one test email lands. What you receive is exactly what a brand receives.'}
            </p>

            <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
              <input
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="you@example.com"
                aria-label="Test recipient address"
                className="input"
                style={{ flex: '1 1 240px', minWidth: 0 }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void onSendTest()}
                disabled={busy || !testTo.trim()}
              >
                {phase === 'sending' ? (
                  <>
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Sending…
                  </>
                ) : (
                  <>
                    <SendHorizonal size={14} aria-hidden="true" /> Send test email
                  </>
                )}
              </button>
            </div>

          </div>
        )}

        {setupPending && (
          <p className="field-hint" style={{ marginTop: 12 }}>
            The sending-account tables aren&rsquo;t in the database yet. Apply migration{' '}
            <code>0012_sending_account.sql</code>, then reload.
          </p>
        )}

        {notice && (
          <p className="save-ok" style={{ marginTop: 12 }}>
            <CheckCircle2 size={14} aria-hidden="true" />
            {notice}
          </p>
        )}

        {(error || loadErr) && (
          <div className="banner banner-error" role="alert" style={{ marginTop: 12 }}>
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{error || loadErr}</span>
          </div>
        )}
      </div>
    </section>
  )
}
