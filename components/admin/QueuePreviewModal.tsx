'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Send, Loader2, Clock } from 'lucide-react'
import { useDialog } from '@/lib/admin/useDialog'
import { textToHtml } from '@/lib/emailBody'
import { buildSignature, type SignatureSource } from '@/lib/emailSignature'
import type { Draft } from '@/lib/emailTemplate'

// Shown before a pitch is queued: the exact email, rendered the way the recipient
// will see it, with the signature attached.
//
// Queuing used to be a single unconfirmed click. The 5-minute window made that
// recoverable, but only if you noticed — and "noticed" meant reading the queue card's
// one-line subject. A merge field that resolved to nothing, or a template edit that
// broke a sentence, would go out looking fine right up until a brand read it.

export function QueuePreviewModal({
  brand,
  email,
  draft,
  signatureSource,
  delayMinutes,
  busy,
  confirmLabel = 'Queue it',
  onConfirm,
  onClose,
}: {
  brand: string
  email: string
  draft: Draft
  signatureSource: SignatureSource
  /** 0 means "goes on the next cron tick" — i.e. Send now, no grace window left. */
  delayMinutes: number
  busy: boolean
  /** Defaults to "Queue it"; the immediate-send path passes "Send now". */
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useDialog(panelRef, onClose)

  const frameRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)

  // Same approach as the template editor: mount an empty document once and patch it,
  // rather than rebuilding it via srcDoc. Escaping happens in textToHtml /
  // buildSignature, and the frame has no allow-scripts, so nothing here can execute.
  useEffect(() => {
    const doc = frameRef.current?.contentDocument
    const el = doc?.getElementById('m')
    if (el) el.innerHTML = textToHtml(draft.body) + buildSignature(signatureSource).html
  }, [draft.body, signatureSource, ready])

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qp-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="ico-badge">
            <Send size={18} aria-hidden="true" />
          </span>
          <h2 id="qp-title" className="modal-title">
            Send to {brand}?
          </h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="qp-meta">
            <div>
              <span className="qp-key">To</span> {email}
            </div>
            <div>
              <span className="qp-key">Subject</span> {draft.subject}
            </div>
          </div>

          <iframe
            ref={frameRef}
            title={`Preview of the email to ${brand}`}
            sandbox="allow-same-origin"
            srcDoc={
              `<!doctype html><meta charset="utf-8">` +
              `<body style="margin:0;padding:18px;background:#fff"><div id="m"></div></body>`
            }
            onLoad={() => setReady(true)}
            className="qp-frame"
          />

          <p className="field-hint hint-icon">
            <Clock size={12} aria-hidden="true" />
            <span>
              {delayMinutes > 0
                ? `Sends in ${delayMinutes} minutes. You can cancel it from the queue until then.`
                : 'Goes out on the next send cycle — within about a minute. This one can’t be cancelled.'}
            </span>
          </p>

          <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Queuing…
                </>
              ) : (
                <>
                  <Send size={14} aria-hidden="true" /> {confirmLabel}
                </>
              )}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
