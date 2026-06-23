'use client'

import { useEffect, useState } from 'react'
import { Users, Send, Settings as Cog, Sparkles, UserCircle, LayoutGrid, BarChart3, Inbox } from 'lucide-react'
import { useStore } from '@/lib/store'
import { ContactsPage } from '@/components/pages/ContactsPage'
import { QueuePage } from '@/components/pages/QueuePage'
import { SettingsPage } from '@/components/pages/SettingsPage'
import { ProfileEditor } from '@/components/admin/ProfileEditor'
import { PortfolioManager } from '@/components/admin/PortfolioManager'
import { SocialStatsEditor } from '@/components/admin/SocialStatsEditor'
import { InquiriesInbox } from '@/components/admin/InquiriesInbox'

type Panel = 'profile' | 'portfolio' | 'social' | 'inquiries' | 'contacts' | 'queue' | 'settings'

const GROUPS = [
  {
    label: 'Media Kit',
    items: [
      { key: 'profile', label: 'Profile', icon: UserCircle },
      { key: 'portfolio', label: 'Portfolio', icon: LayoutGrid },
      { key: 'social', label: 'Social Stats', icon: BarChart3 },
      { key: 'inquiries', label: 'Inquiries', icon: Inbox },
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

// The private studio shell at /admin. Two nav groups: media-kit management (new)
// + the existing outreach studio pages (reused verbatim). Client-side panel
// switch, mirroring the original studio's pattern.
export function AdminShell() {
  const [panel, setPanel] = useState<Panel>('profile')
  const queueCount = useStore((s) => s.queue.length)
  const hydrate = useStore((s) => s.hydrate)
  useEffect(() => {
    hydrate()
  }, [hydrate])

  return (
    <div className="flex h-screen overflow-hidden bg-stone-100">
      <aside className="flex w-60 shrink-0 flex-col border-r border-stone-200 bg-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-plum-600 text-white">
            <Sparkles size={16} />
          </span>
          <div className="leading-tight">
            <div className="font-display text-lg font-semibold text-stone-900">sim x margo</div>
            <div className="-mt-0.5 text-xs tracking-wide text-stone-400">STUDIO</div>
          </div>
        </div>

        <nav className="mt-2 flex flex-col gap-5 px-3">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                {group.label}
              </div>
              <div className="flex flex-col gap-1">
                {group.items.map(({ key, label, icon: Icon }) => {
                  const active = panel === key
                  return (
                    <button
                      key={key}
                      onClick={() => setPanel(key as Panel)}
                      className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition ${
                        active ? 'bg-plum-50 text-plum-700' : 'text-stone-600 hover:bg-stone-100'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <Icon size={17} />
                        {label}
                      </span>
                      {key === 'queue' && queueCount > 0 && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">
                          {queueCount}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <a href="/" target="_blank" rel="noreferrer" className="mt-auto px-5 py-4 text-xs text-stone-400 transition-colors hover:text-plum-600">
          View public media kit →
        </a>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 py-8">
          {panel === 'profile' && <ProfileEditor />}
          {panel === 'portfolio' && <PortfolioManager />}
          {panel === 'social' && <SocialStatsEditor />}
          {panel === 'inquiries' && <InquiriesInbox />}
          {panel === 'contacts' && <ContactsPage />}
          {panel === 'queue' && <QueuePage />}
          {panel === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  )
}
