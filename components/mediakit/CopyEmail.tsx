'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { copyText } from '@/lib/clipboard'
import { CheckIcon, CopyIcon } from './icons'

const COPIED_MS = 2000

// The contact address with a one-click copy affordance: the icon fades in on
// hover (or keyboard focus) and swaps to a check for two seconds after a
// successful copy. On touch devices there is no hover, so the icon is always
// visible and the target grows to 44px — see `.mk .copy-btn` in globals.css.
export function CopyEmail({ email }: { email: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Don't set state after unmount if the section scrolls away mid-timeout.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const handleCopy = useCallback(async () => {
    // Only confirm when the write actually succeeded — a false "Copied" is worse
    // than no feedback, because the visitor pastes nothing and doesn't know why.
    if (!(await copyText(email))) return
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
  }, [email])

  return (
    <div className="cm-email">
      <a className="cm-v" href={`mailto:${email}`}>
        {email}
      </a>
      <button
        type="button"
        className={`copy-btn${copied ? ' is-copied' : ''}`}
        onClick={handleCopy}
        aria-label={copied ? 'Email address copied' : 'Copy email address'}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      {/* Icon-only feedback is invisible to screen readers, so announce it. */}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? 'Email address copied' : ''}
      </span>
    </div>
  )
}
