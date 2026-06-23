'use client'

import { Mail, ShieldCheck } from 'lucide-react'
import { useStore } from '@/lib/store'
import type { CreatorProfile } from '@/lib/types'

const FIELDS: { key: keyof CreatorProfile; label: string; hint?: string }[] = [
  { key: 'name', label: 'Your name' },
  { key: 'handle', label: 'Handle', hint: 'e.g. @yourhandle' },
  { key: 'niche', label: 'Niche', hint: 'e.g. beauty & fashion' },
  { key: 'followers', label: 'Followers', hint: 'e.g. 25k' },
  { key: 'avgViews', label: 'Avg views / post', hint: 'e.g. 40k' },
  { key: 'engagement', label: 'Engagement', hint: 'e.g. 6%' },
  { key: 'audience', label: 'Audience' },
  { key: 'realEmail', label: 'Reply-To email', hint: 'where brands reach you' },
  { key: 'mailingAddress', label: 'Mailing address', hint: 'CAN-SPAM — a city / PO box is fine' },
  { key: 'mediaKitUrl', label: 'Media kit URL', hint: 'optional' },
]

export function SettingsPage() {
  const { profile, updateProfile, dailyCap, setDailyCap } = useStore()

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-stone-900">Settings</h1>
        <p className="text-sm text-stone-500">These details fill your email template and protect your sending.</p>
      </div>

      {/* Sending account — connect a DEDICATED secondary Gmail, never your main one. */}
      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex items-center gap-2 text-stone-800">
          <Mail size={18} className="text-plum-600" />
          <span className="font-medium">Sending account</span>
        </div>
        <p className="mt-1 text-sm text-stone-500">
          Connect a <strong>dedicated secondary Gmail</strong> (not your main one). Replies route to your
          Reply-To email below, so interested brands reach you directly.
        </p>
        {/* TODO(studio-backend): launch Gmail OAuth (gmail.send scope) via Edge Function. */}
        <button
          disabled
          title="Backend pending — see docs/BACKEND_DESIGN.md"
          className="mt-3 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-400"
        >
          Connect Gmail (backend pending)
        </button>
      </div>

      {/* Creator profile — drives the email merge fields. */}
      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-stone-800">Creator profile</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-stone-400">{f.label}</span>
              <input
                value={profile[f.key]}
                onChange={(e) => updateProfile({ [f.key]: e.target.value } as Partial<CreatorProfile>)}
                placeholder={f.hint}
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-plum-500 focus:outline-none focus:ring-1 focus:ring-plum-500"
              />
            </label>
          ))}
        </div>
      </div>

      {/* Sending safety — the cap users can tune. */}
      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex items-center gap-2 text-stone-800">
          <ShieldCheck size={18} className="text-emerald-600" />
          <span className="font-medium">Sending safety</span>
        </div>
        <label className="mt-3 block">
          <span className="text-sm text-stone-600">
            Daily send cap: <strong>{dailyCap}</strong>
          </span>
          <input
            type="range"
            min={5}
            max={50}
            value={dailyCap}
            onChange={(e) => setDailyCap(Number(e.target.value))}
            className="mt-2 w-full accent-plum-600"
          />
        </label>
        <p className="mt-1 text-xs text-stone-400">
          Start low (10–20) and ramp slowly to keep your sending account healthy.
        </p>
      </div>
    </div>
  )
}
