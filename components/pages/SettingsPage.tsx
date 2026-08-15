'use client'

import { SendingAccountCard } from '@/components/admin/SendingAccountCard'
import { SendingSafetyCard } from '@/components/admin/SendingSafetyCard'

// Studio Settings — the sending account, and the safety rails around it.
//
// The email template and the daily send cap both MOVED to the Outreach tab. They are
// things you reach for while working through leads, and keeping them here meant
// leaving the page you were working on to change the message you were about to send,
// or to raise a limit you had just hit. The sending account stays because connecting
// Gmail is a one-time setup, not part of the daily loop — and Sending safety sits
// with it because pause/window/auto-queue are about protecting THAT account.
//
// Creator identity lives on Profile; the site favicon on Theme (Media Kit).

export function SettingsPage() {
  return (
    <>
      <header className="main-head">
        <div>
          <h1 className="page-title display">Settings</h1>
          <p className="page-sub">
            Your sending account and its safety rails. The pitch template and daily send cap live on
            the Outreach tab.
          </p>
        </div>
      </header>

      <div className="stack">
        {/* Each card owns its own query and mutations — no page-level save. */}
        <SendingAccountCard />
        <SendingSafetyCard />
      </div>
    </>
  )
}
