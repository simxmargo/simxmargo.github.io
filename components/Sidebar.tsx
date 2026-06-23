'use client'

import { Users, Send, Settings as Cog, Sparkles } from 'lucide-react'

export type Page = 'contacts' | 'queue' | 'settings'

const NAV: { key: Page; label: string; icon: typeof Users }[] = [
  { key: 'contacts', label: 'Contacts', icon: Users },
  { key: 'queue', label: 'Send Queue', icon: Send },
  { key: 'settings', label: 'Settings', icon: Cog },
]

export function Sidebar({
  page,
  setPage,
  queueCount,
}: {
  page: Page
  setPage: (p: Page) => void
  queueCount: number
}) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-stone-200 bg-white">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-plum-600 text-white">
          <Sparkles size={16} />
        </span>
        <div className="leading-tight">
          <div className="font-display text-lg font-semibold text-stone-900">Outreach</div>
          <div className="-mt-0.5 text-xs tracking-wide text-stone-400">STUDIO</div>
        </div>
      </div>

      <nav className="mt-2 flex flex-col gap-1 px-3">
        {NAV.map(({ key, label, icon: Icon }) => {
          const active = page === key
          return (
            <button
              key={key}
              onClick={() => setPage(key)}
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
      </nav>

      <div className="mt-auto px-5 py-4 text-xs leading-relaxed text-stone-400">
        Phase 1 · UI shell
        <br />
        Backend wiring pending — see <span className="text-stone-500">docs/BACKEND_DESIGN.md</span>
      </div>
    </aside>
  )
}
