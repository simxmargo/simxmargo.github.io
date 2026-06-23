'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Trash2, ExternalLink, CheckCircle2, AlertTriangle, RotateCcw } from 'lucide-react'
import { adminFetch } from '@/lib/adminClient'
import type { PublicProfile, RateCardItem } from '@/lib/mediakit-types'

// The editable subset of PublicProfile this form owns. press_logos / seo /
// totalFollowers are intentionally left out of the UI for now AND out of the
// PUT payload so the server preserves whatever it already has on those fields.
interface ProfileForm {
  displayName: string
  tagline: string
  niche: string
  location: string
  bioMd: string
  avatarUrl: string
  heroImageUrl: string
  rateCard: RateCardItem[]
  isPublished: boolean
}

type LoadState = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'config-missing'

const EMPTY_FORM: ProfileForm = {
  displayName: '',
  tagline: '',
  niche: '',
  location: '',
  bioMd: '',
  avatarUrl: '',
  heroImageUrl: '',
  rateCard: [],
  isPublished: false,
}

// Shared token classes (light "studio" theme).
const CARD = 'rounded-xl border border-stone-200 bg-white p-5'
const LABEL = 'text-xs font-medium uppercase tracking-wide text-stone-400'
const FIELD =
  'rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-plum-500 focus:outline-none focus:ring-1 focus:ring-plum-500'
const BTN_PRIMARY =
  'rounded-lg bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50'
const BTN_SECONDARY =
  'rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 hover:bg-stone-100'

// Pull only the editable fields out of whatever the GET returns.
function toForm(p: Partial<PublicProfile> | null | undefined): ProfileForm {
  if (!p) return EMPTY_FORM
  return {
    displayName: p.displayName ?? '',
    tagline: p.tagline ?? '',
    niche: p.niche ?? '',
    location: p.location ?? '',
    bioMd: p.bioMd ?? '',
    avatarUrl: p.avatarUrl ?? '',
    heroImageUrl: p.heroImageUrl ?? '',
    rateCard: Array.isArray(p.rateCard) ? p.rateCard : [],
    isPublished: Boolean(p.isPublished),
  }
}

export function ProfileEditor() {
  const [load, setLoad] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM)
  const [save, setSave] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    let active = true
    async function run() {
      try {
        const res = await adminFetch('/api/admin/profile', { method: 'GET' })
        if (!res.ok) {
          if (active) {
            setLoadError(`Couldn’t load profile (${res.status}).`)
            setLoad('error')
          }
          return
        }
        const data = (await res.json()) as Partial<PublicProfile>
        if (active) {
          setForm(toForm(data))
          setLoad('ready')
        }
      } catch {
        if (active) {
          setLoadError('Couldn’t reach the server. Try again.')
          setLoad('error')
        }
      }
    }
    void run()
    return () => {
      active = false
    }
  }, [])

  function update<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    if (save !== 'idle') setSave('idle')
  }

  function updateRow(index: number, patch: Partial<RateCardItem>) {
    setForm((f) => ({
      ...f,
      rateCard: f.rateCard.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }))
    if (save !== 'idle') setSave('idle')
  }

  function addRow() {
    setForm((f) => ({ ...f, rateCard: [...f.rateCard, { deliverable: '', price: '', note: '' }] }))
    if (save !== 'idle') setSave('idle')
  }

  function removeRow(index: number) {
    setForm((f) => ({ ...f, rateCard: f.rateCard.filter((_, i) => i !== index) }))
    if (save !== 'idle') setSave('idle')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSave('saving')
    setSaveError('')
    // Only send the fields we edit; drop empty rate-card notes; preserve
    // server-side fields (pressLogos, seo, totalFollowers) by omitting them.
    const payload = {
      displayName: form.displayName,
      tagline: form.tagline,
      niche: form.niche,
      location: form.location,
      bioMd: form.bioMd,
      avatarUrl: form.avatarUrl,
      heroImageUrl: form.heroImageUrl,
      rateCard: form.rateCard.map((r) => ({
        deliverable: r.deliverable,
        price: r.price,
        ...(r.note?.trim() ? { note: r.note } : {}),
      })),
      isPublished: form.isPublished,
    }
    try {
      const res = await adminFetch('/api/admin/profile', {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      if (res.status === 503) {
        setSave('config-missing')
        return
      }
      if (!res.ok) {
        setSaveError(`Save failed (${res.status}).`)
        setSave('error')
        return
      }
      setSave('saved')
    } catch {
      setSaveError('Couldn’t reach the server. Try again.')
      setSave('error')
    }
  }

  if (load === 'loading') {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-stone-400" aria-live="polite">
        Loading profile…
      </div>
    )
  }

  if (load === 'error') {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-stone-900">Media kit profile</h1>
          <p className="text-sm text-stone-500">The identity and pricing shown on your public kit.</p>
        </div>
        <div className={`${CARD} flex items-start gap-3 border-red-200 bg-red-50`} role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-500" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-red-700">{loadError}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={`mt-3 inline-flex cursor-pointer items-center gap-2 ${BTN_SECONDARY}`}
            >
              <RotateCcw size={14} aria-hidden="true" /> Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Heading */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-stone-900">Media kit profile</h1>
          <p className="text-sm text-stone-500">The identity and pricing shown on your public kit.</p>
        </div>
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className={`inline-flex cursor-pointer items-center gap-1.5 ${BTN_SECONDARY}`}
        >
          View public kit <ExternalLink size={14} aria-hidden="true" />
        </a>
      </div>

      {/* Identity */}
      <section className={`${CARD} space-y-5`}>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="displayName" className={LABEL}>Display name</label>
            <input
              id="displayName"
              type="text"
              value={form.displayName}
              onChange={(e) => update('displayName', e.target.value)}
              className={FIELD}
              placeholder="sim x margo"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="niche" className={LABEL}>Niche</label>
            <input
              id="niche"
              type="text"
              value={form.niche}
              onChange={(e) => update('niche', e.target.value)}
              className={FIELD}
              placeholder="Fashion & lifestyle"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="tagline" className={LABEL}>Tagline</label>
          <input
            id="tagline"
            type="text"
            value={form.tagline}
            onChange={(e) => update('tagline', e.target.value)}
            className={FIELD}
            placeholder="A short one-liner about you"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="location" className={LABEL}>Location</label>
            <input
              id="location"
              type="text"
              value={form.location}
              onChange={(e) => update('location', e.target.value)}
              className={FIELD}
              placeholder="Los Angeles, CA"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="bioMd" className={LABEL}>Bio (Markdown)</label>
          <textarea
            id="bioMd"
            rows={5}
            value={form.bioMd}
            onChange={(e) => update('bioMd', e.target.value)}
            className={`${FIELD} resize-y leading-relaxed`}
            placeholder="Tell brands who you are. Markdown is supported."
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="avatarUrl" className={LABEL}>Avatar URL</label>
            <input
              id="avatarUrl"
              type="url"
              value={form.avatarUrl}
              onChange={(e) => update('avatarUrl', e.target.value)}
              className={FIELD}
              placeholder="https://…"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="heroImageUrl" className={LABEL}>Hero image URL</label>
            <input
              id="heroImageUrl"
              type="url"
              value={form.heroImageUrl}
              onChange={(e) => update('heroImageUrl', e.target.value)}
              className={FIELD}
              placeholder="https://…"
            />
          </div>
        </div>
      </section>

      {/* Rate card */}
      <section className={`${CARD} space-y-4`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-stone-900">Rate card</h2>
            <p className="text-sm text-stone-500">Deliverables and pricing shown to brands.</p>
          </div>
          <button
            type="button"
            onClick={addRow}
            className={`inline-flex cursor-pointer items-center gap-1.5 ${BTN_SECONDARY}`}
          >
            <Plus size={14} aria-hidden="true" /> Add row
          </button>
        </div>

        {form.rateCard.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-200 px-4 py-6 text-center text-sm text-stone-400">
            No rate-card items yet. Add a row to get started.
          </p>
        ) : (
          <div className="space-y-3">
            {form.rateCard.map((row, i) => (
              <div
                key={i}
                className="grid items-end gap-3 rounded-lg border border-stone-200 bg-stone-50/60 p-3 sm:grid-cols-[1fr_8rem_1fr_auto]"
              >
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`rc-deliverable-${i}`} className={LABEL}>Deliverable</label>
                  <input
                    id={`rc-deliverable-${i}`}
                    type="text"
                    value={row.deliverable}
                    onChange={(e) => updateRow(i, { deliverable: e.target.value })}
                    className={`${FIELD} bg-white`}
                    placeholder="1× Instagram Reel"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`rc-price-${i}`} className={LABEL}>Price</label>
                  <input
                    id={`rc-price-${i}`}
                    type="text"
                    value={row.price}
                    onChange={(e) => updateRow(i, { price: e.target.value })}
                    className={`${FIELD} bg-white`}
                    placeholder="$1,500"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`rc-note-${i}`} className={LABEL}>Note</label>
                  <input
                    id={`rc-note-${i}`}
                    type="text"
                    value={row.note ?? ''}
                    onChange={(e) => updateRow(i, { note: e.target.value })}
                    className={`${FIELD} bg-white`}
                    placeholder="Optional"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  aria-label={`Remove rate-card row ${i + 1}`}
                  className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-stone-200 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-1 focus:ring-plum-500"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Publish */}
      <section className={`${CARD} flex items-start justify-between gap-4`}>
        <div>
          <h2 className="font-display text-lg font-semibold text-stone-900">Publish</h2>
          <p className="text-sm text-stone-500">When off, the public kit shows nothing.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.isPublished}
          aria-label="Publish public media kit"
          onClick={() => update('isPublished', !form.isPublished)}
          className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-plum-500 focus:ring-offset-2 ${
            form.isPublished ? 'bg-plum-600' : 'bg-stone-300'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              form.isPublished ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </section>

      {/* Save bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={save === 'saving'} className={`cursor-pointer ${BTN_PRIMARY}`}>
          {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Save again' : 'Save'}
        </button>

        {save === 'saved' && (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600" role="status">
            <CheckCircle2 size={16} aria-hidden="true" /> Saved
          </span>
        )}
        {save === 'error' && (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600" role="alert">
            <AlertTriangle size={16} aria-hidden="true" /> {saveError}
          </span>
        )}
      </div>

      {save === 'config-missing' && (
        <div
          className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4"
          role="alert"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
          <p className="text-sm font-medium text-amber-800">
            Saving needs SUPABASE_SERVICE_ROLE_KEY set on the server.
          </p>
        </div>
      )}
    </form>
  )
}
