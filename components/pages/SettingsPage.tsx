'use client'

import { SendingAccountCard } from '@/components/admin/SendingAccountCard'

// Studio Settings — now ONLY the sending account.
//
// The email template and the daily send cap both MOVED to the Outreach tab. They are
// things you reach for while working through leads, and keeping them here meant
// leaving the page you were working on to change the message you were about to send,
// or to raise a limit you had just hit. The sending account stays because connecting
// Gmail is a one-time setup, not part of the daily loop.
//
// Creator identity lives on Profile; the site favicon on Theme (Media Kit).

export function SettingsPage() {
  return (
    <>
      <header className="main-head">
        <div>
          <h1 className="page-title display">Settings</h1>
          <p className="page-sub">
            Your sending account. The pitch template and daily send cap now live on the Outreach tab.
          </p>
        </div>
      </header>

      <div className="stack">
        {/* Owns its own query and mutations — connecting Gmail needs no page-level save. */}
        <SendingAccountCard />
      </div>
    </>
  )
}
