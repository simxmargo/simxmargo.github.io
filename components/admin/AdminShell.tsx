'use client'

import { useEffect, useState } from 'react'
import { Send, Settings as Cog, UserCircle, LayoutGrid, BarChart3, Inbox, Palette, Type } from 'lucide-react'
import { useStore } from '@/lib/store'
import { AdminQueryProvider } from '@/components/admin/AdminQueryProvider'
import { useAdminResource } from '@/lib/admin/queries'
import { readCachedAccent, writeCachedAccent, accentStyle } from '@/lib/admin/themeCache'
import { applyFavicon } from '@/lib/applyFavicon'
import { themeFaviconDataUrl } from '@/lib/mediakit/favicon'
import type { PublicProfile } from '@/lib/mediakit-types'
import type { InquiryRow } from '@/lib/admin/resources/inquiries'
import type { SendQueueRow } from '@/lib/admin/resources/sendQueue'
import { OutreachPage } from '@/components/pages/OutreachPage'
import { SettingsPage } from '@/components/pages/SettingsPage'
import { ProfileEditor } from '@/components/admin/ProfileEditor'
import { ContentEditor } from '@/components/admin/ContentEditor'
import { PortfolioManager } from '@/components/admin/PortfolioManager'
import { SocialStatsEditor } from '@/components/admin/SocialStatsEditor'
import { InquiriesInbox } from '@/components/admin/InquiriesInbox'
import { ThemeEditor } from '@/components/admin/ThemeEditor'
import { SidebarBrand } from '@/components/admin/SidebarBrand'
import { signOutAdmin } from '@/lib/admin/auth'

type Panel = 'profile' | 'portfolio' | 'social' | 'inquiries' | 'theme' | 'content' | 'outreach' | 'settings'

const GROUPS = [
  {
    label: 'Media Kit',
    items: [
      { key: 'profile', label: 'Profile', icon: UserCircle },
      { key: 'portfolio', label: 'Portfolio', icon: LayoutGrid },
      { key: 'social', label: 'Social Stats', icon: BarChart3 },
      { key: 'theme', label: 'Theme', icon: Palette },
      { key: 'content', label: 'Content', icon: Type },
    ],
  },
  {
    label: 'Outreach Studio',
    items: [
      // Inbound "Work with me" leads lead the outreach flow: an inquiry can be
      // promoted to a Contact, then queued — so it sits above Contacts here.
      { key: 'inquiries', label: 'Inquiries', icon: Inbox },
      // Contacts and Send Queue were merged into one workspace — picking a brand and
      // watching it send is a single loop, and splitting it across two pages made the
      // result of every click happen off-screen.
      { key: 'outreach', label: 'Outreach', icon: Send },
      { key: 'settings', label: 'Settings', icon: Cog },
    ],
  },
] as const

// The private studio shell at /admin — warm editorial design (port of
// "Studio Settings.dc.html"), DARK palette, scoped under .studio in globals.css.
// Two nav groups (media-kit management + outreach studio); client-side panel switch.
export function AdminShell() {
  return (
    <AdminQueryProvider>
      <StudioShell />
    </AdminQueryProvider>
  )
}

// Rendered INSIDE AdminQueryProvider so it can read the saved theme accent and tint the
// whole studio chrome with it: overriding the single --accent token on the root cascades
// to --accent-soft and every var(--accent) usage (incl. position:fixed modals, which
// still inherit CSS vars). Re-renders live when the Theme tab saves (the shared `profile`
// query invalidates). Falls back to the studio's own default accent when no valid theme
// colour is set.
function StudioShell() {
  const [panel, setPanel] = useState<Panel>('profile')
  const hydrate = useStore((s) => s.hydrate)
  useEffect(() => {
    hydrate()
  }, [hydrate])

  // Unread badge on Inquiries. "Unread" is status 'new' — the inbox flips a row to
  // 'read' on open, so anything still 'new' is genuinely untouched. This shares the
  // `inquiries` query key with InquiriesInbox, so react-query serves both from one
  // fetch and the badge drops the moment the inbox marks something read.
  const inquiriesQ = useAdminResource<InquiryRow[]>('inquiries')
  const unreadInquiries = Array.isArray(inquiriesQ.data)
    ? inquiriesQ.data.filter((i) => i.status === 'new').length
    : 0

  // Queue badge now counts DURABLE rows, not session state — it survives a reload and
  // is true across tabs, which the old in-memory count never was.
  const queueQ = useAdminResource<SendQueueRow[]>('sendQueue')
  const queueCount = Array.isArray(queueQ.data)
    ? queueQ.data.filter((r) => r.status === 'queued' || r.status === 'sending').length
    : 0

  const profileQ = useAdminResource<Partial<PublicProfile>>('profile')
  // Paint the saved accent on FIRST render from the localStorage cache, so the studio
  // chrome doesn't flash the default accent while the profile query loads. The live
  // value wins as soon as it arrives, and is written back to the cache for next time.
  const [cachedAccent] = useState(readCachedAccent)
  const liveAccent = profileQ.data?.theme?.accent
  useEffect(() => {
    writeCachedAccent(liveAccent)
  }, [liveAccent])
  const style = accentStyle(typeof liveAccent === 'string' ? liveAccent : cachedAccent)

  // The static export bakes the favicon that existed at BUILD time — swap in the
  // live one (uploaded, else the theme mark) once the profile loads, so a Settings
  // upload shows on the studio tab after a refresh without a redeploy.
  const liveFavicon = profileQ.data?.faviconUrl
  useEffect(() => {
    if (!profileQ.data) return
    applyFavicon(liveFavicon || themeFaviconDataUrl(typeof liveAccent === 'string' ? liveAccent : ''))
  }, [profileQ.data, liveFavicon, liveAccent])

  return (
    <div className="studio" style={style}>
      <aside className="sidebar">
        <SidebarBrand />

        {GROUPS.map((group) => (
          <div key={group.label}>
            <div className="nav-group">{group.label}</div>
            {group.items.map(({ key, label, icon: Icon }) => {
              const active = panel === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPanel(key as Panel)}
                  className={`nav-item${active ? ' active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="nav-lead">
                    <Icon size={17} aria-hidden="true" />
                    {label}
                  </span>
                  {key === 'outreach' && queueCount > 0 && (
                    <span className="nav-count">
                      <span aria-hidden="true">{queueCount}</span>
                      <span className="sr-only">{queueCount} queued</span>
                    </span>
                  )}
                  {/* Colour alone must never carry the meaning — the count is a
                      number, and screen readers get the word "unread" too. */}
                  {key === 'inquiries' && unreadInquiries > 0 && (
                    <span className="nav-count">
                      <span aria-hidden="true">{unreadInquiries}</span>
                      <span className="sr-only">
                        {unreadInquiries} unread {unreadInquiries === 1 ? 'inquiry' : 'inquiries'}
                      </span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}

        <div className="side-foot">
          <span className="uavatar">S</span>
          <a href="/" target="_blank" rel="noreferrer" className="side-link">
            View public media kit →
          </a>
          <button
            type="button"
            className="side-link"
            onClick={() => void signOutAdmin()}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="main">
        {panel === 'profile' && <ProfileEditor />}
        {panel === 'portfolio' && <PortfolioManager />}
        {panel === 'social' && <SocialStatsEditor />}
        {panel === 'inquiries' && <InquiriesInbox />}
        {panel === 'theme' && <ThemeEditor />}
        {panel === 'content' && <ContentEditor />}
        {panel === 'outreach' && <OutreachPage />}
        {panel === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}
