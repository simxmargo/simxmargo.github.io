'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { Users, Send, Settings as Cog, UserCircle, LayoutGrid, BarChart3, Inbox, Palette } from 'lucide-react'
import { useStore } from '@/lib/store'
import { AdminQueryProvider } from '@/components/admin/AdminQueryProvider'
import { useAdminResource } from '@/lib/admin/queries'
import type { PublicProfile } from '@/lib/mediakit-types'
import { ContactsPage } from '@/components/pages/ContactsPage'
import { QueuePage } from '@/components/pages/QueuePage'
import { SettingsPage } from '@/components/pages/SettingsPage'
import { ProfileEditor } from '@/components/admin/ProfileEditor'
import { PortfolioManager } from '@/components/admin/PortfolioManager'
import { SocialStatsEditor } from '@/components/admin/SocialStatsEditor'
import { InquiriesInbox } from '@/components/admin/InquiriesInbox'
import { ThemeEditor } from '@/components/admin/ThemeEditor'
import { SidebarBrand } from '@/components/admin/SidebarBrand'

type Panel = 'profile' | 'portfolio' | 'social' | 'inquiries' | 'theme' | 'contacts' | 'queue' | 'settings'

const GROUPS = [
  {
    label: 'Media Kit',
    items: [
      { key: 'profile', label: 'Profile', icon: UserCircle },
      { key: 'portfolio', label: 'Portfolio', icon: LayoutGrid },
      { key: 'social', label: 'Social Stats', icon: BarChart3 },
      { key: 'inquiries', label: 'Inquiries', icon: Inbox },
      { key: 'theme', label: 'Theme', icon: Palette },
    ],
  },
  {
    label: 'Outreach Studio',
    items: [
      { key: 'contacts', label: 'Contacts', icon: Users },
      { key: 'queue', label: 'Send Queue', icon: Send },
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
  const queueCount = useStore((s) => s.queue.length)
  const hydrate = useStore((s) => s.hydrate)
  useEffect(() => {
    hydrate()
  }, [hydrate])

  const profileQ = useAdminResource<Partial<PublicProfile>>('profile')
  const rawAccent = profileQ.data?.theme?.accent
  const accentStyle =
    typeof rawAccent === 'string' && /^#[0-9a-f]{3,8}$/i.test(rawAccent.trim())
      ? ({ ['--accent']: rawAccent.trim() } as CSSProperties)
      : undefined

  return (
    <div className="studio" style={accentStyle}>
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
                  {key === 'queue' && queueCount > 0 && <span className="nav-count">{queueCount}</span>}
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
        </div>
      </aside>

      <main className="main">
        {panel === 'profile' && <ProfileEditor />}
        {panel === 'portfolio' && <PortfolioManager />}
        {panel === 'social' && <SocialStatsEditor />}
        {panel === 'inquiries' && <InquiriesInbox />}
        {panel === 'theme' && <ThemeEditor />}
        {panel === 'contacts' && <ContactsPage />}
        {panel === 'queue' && <QueuePage />}
        {panel === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}
