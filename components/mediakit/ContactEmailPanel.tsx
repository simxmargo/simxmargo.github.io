'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { copyText } from '@/lib/clipboard'
import { composeUrl, starterBrief } from '@/lib/mediakit/compose'
import { CheckIcon, CopyIcon, MailIcon } from './icons'

const COPIED_MS = 2000

interface ContactEmailPanelProps {
  email: string
  /** The influencer's name, for the draft's greeting. */
  toName?: string
  /** Package picked from the rate list; pre-fills the draft's subject and body. */
  deliverable?: string
  onClearDeliverable: () => void
}

// Email-first Collaborate panel, shown when the brief form is switched off: the
// address itself is the headline, with one-click copy and open-in-mail links.
export function ContactEmailPanel({ email, toName, deliverable, onClearDeliverable }: ContactEmailPanelProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const handleCopy = useCallback(async () => {
    // Only confirm a copy that actually happened.
    if (!(await copyText(email))) return
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
  }, [email])

  const draft = starterBrief(toName, deliverable)
  const mailHref = composeUrl('mailto', email, draft)

  return (
    <div className="reach-out">
      <span className="label">Email me directly</span>
      <a className="ro-email" href={mailHref}>
        {email}
      </a>
      <p className="ro-hint">Send over your brief: brand, timeline, goals and budget.</p>

      {deliverable && (
        <p className="ro-pkg">
          <span>
            Asking about <strong>{deliverable}</strong>
          </span>
          <button type="button" className="linkbtn compose-restart" onClick={onClearDeliverable}>
            Clear
          </button>
        </p>
      )}

      <div className="ro-actions">
        <button type="button" className="btn btn-primary" onClick={handleCopy}>
          <span className="btn-ico">{copied ? <CheckIcon /> : <CopyIcon />}</span>
          {copied ? 'Copied' : 'Copy email'}
        </button>
        <a className="btn btn-ghost" href={mailHref}>
          <span className="btn-ico">
            <MailIcon />
          </span>
          Write an email
        </a>
      </div>

      {/* Real links, not window.open: no popup blocker to trip. */}
      <div className="compose-alts">
        <span className="label">Or open in</span>
        <a className="linkbtn" href={composeUrl('gmail', email, draft)} target="_blank" rel="noopener noreferrer">
          Gmail
        </a>
        <a className="linkbtn" href={composeUrl('outlook', email, draft)} target="_blank" rel="noopener noreferrer">
          Outlook
        </a>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {copied ? 'Email address copied' : ''}
      </span>
    </div>
  )
}
