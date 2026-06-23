'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Star, Eye, Link2, AlertTriangle, Check, Loader2 } from 'lucide-react'
import { adminFetch } from '@/lib/adminClient'
import type { PortfolioBrand } from '@/lib/mediakit-types'

// Mutable shape of the BrandEditor form (id present ⇒ editing an existing row).
interface BrandForm {
  id?: string
  brand: string
  website: string
  logoUrl: string
  blurb: string
  campaignTitle: string
  category: string
  featured: boolean
}

const EMPTY_FORM: BrandForm = {
  brand: '',
  website: '',
  logoUrl: '',
  blurb: '',
  campaignTitle: '',
  category: '',
  featured: false,
}

const CARD = 'rounded-xl border border-stone-200 bg-white p-5'
const LABEL = 'text-xs font-medium uppercase tracking-wide text-stone-400'
const FIELD =
  'rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-plum-500 focus:outline-none focus:ring-1 focus:ring-plum-500'
const BTN_PRIMARY =
  'inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:cursor-not-allowed disabled:opacity-50'
const BTN_SECONDARY =
  'inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 hover:bg-stone-100'

export function PortfolioManager() {
  const [brands, setBrands] = useState<PortfolioBrand[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<BrandForm | null>(null)
  const [serviceKeyMissing, setServiceKeyMissing] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await adminFetch('/api/admin/brands')
      if (!res.ok) throw new Error(`Failed to load brands (${res.status})`)
      const data: PortfolioBrand[] = await res.json()
      setBrands(data)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load brands.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleSaved = useCallback(async () => {
    setServiceKeyMissing(false)
    setEditing(null)
    setSavedAt(Date.now())
    await load()
  }, [load])

  async function handleDelete(b: PortfolioBrand) {
    if (!confirm(`Delete "${b.brand}"? This can't be undone.`)) return
    setServiceKeyMissing(false)
    try {
      const res = await adminFetch(`/api/admin/brands?id=${encodeURIComponent(b.id)}`, { method: 'DELETE' })
      if (res.status === 503) {
        setServiceKeyMissing(true)
        return
      }
      if (!res.ok) throw new Error(`Delete failed (${res.status})`)
      setSavedAt(Date.now())
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Delete failed.')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-stone-900">Brand partners</h1>
          <p className="text-sm text-stone-500">Brands featured in the public media kit portfolio.</p>
        </div>
        {!editing && (
          <button type="button" onClick={() => setEditing({ ...EMPTY_FORM })} className={BTN_PRIMARY}>
            <Plus size={16} /> Add brand
          </button>
        )}
      </header>

      {serviceKeyMissing && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} /> Saving needs SUPABASE_SERVICE_ROLE_KEY set on the server.
        </div>
      )}
      {savedAt && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <Check size={16} /> Saved
        </div>
      )}
      {loadError && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertTriangle size={16} /> {loadError}
        </div>
      )}

      <AddBrandByUrl />

      {editing && <BrandEditor initial={editing} onCancel={() => setEditing(null)} on503={() => setServiceKeyMissing(true)} onSaved={handleSaved} />}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-stone-500">
          <Loader2 size={16} className="animate-spin" /> Loading brands…
        </div>
      ) : brands.length === 0 ? (
        <div className={`${CARD} text-sm text-stone-500`}>No brands yet. Add your first partner above.</div>
      ) : (
        <ul className="flex flex-col gap-3">
          {brands.map((b) => (
            <li key={b.id} className={`${CARD} flex items-center gap-4`}>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-50 text-sm font-semibold text-stone-500">
                {b.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.logoUrl} alt="" className="h-full w-full object-contain" />
                ) : (
                  (b.brand[0] ?? '?').toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-stone-900">{b.brand}</span>
                  {b.featured && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-plum-50 px-2 py-0.5 text-xs font-medium text-plum-700">
                      <Star size={11} /> Featured
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
                    <Eye size={11} /> Visible
                  </span>
                </div>
                {b.category && <div className="truncate text-sm text-stone-500">{b.category}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      id: b.id,
                      brand: b.brand,
                      website: b.website,
                      logoUrl: b.logoUrl,
                      blurb: b.blurb,
                      campaignTitle: b.campaignTitle,
                      category: b.category,
                      featured: b.featured,
                    })
                  }
                  className={BTN_SECONDARY}
                >
                  <Pencil size={14} /> Edit
                </button>
                <button type="button" onClick={() => void handleDelete(b)} className={`${BTN_SECONDARY} hover:bg-rose-50 hover:text-rose-700`}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BrandEditor({
  initial,
  onCancel,
  onSaved,
  on503,
}: {
  initial: BrandForm
  onCancel: () => void
  onSaved: () => void | Promise<void>
  on503: () => void
}) {
  const [form, setForm] = useState<BrandForm>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof BrandForm>(k: K, v: BrandForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form.brand.trim()) {
      setError('Brand name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await adminFetch('/api/admin/brands', { method: form.id ? 'PUT' : 'POST', body: JSON.stringify(form) })
      if (res.status === 503) {
        on503()
        return
      }
      if (!res.ok) throw new Error(`Save failed (${res.status})`)
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className={`${CARD} flex flex-col gap-4`}>
      <div className="font-display text-lg font-semibold text-stone-900">{form.id ? 'Edit brand' : 'Add brand'}</div>
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle size={14} /> {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1" htmlFor="brand-name">
          <span className={LABEL}>Brand *</span>
          <input id="brand-name" className={FIELD} value={form.brand} onChange={(e) => set('brand', e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1" htmlFor="brand-website">
          <span className={LABEL}>Website</span>
          <input id="brand-website" type="url" placeholder="https://" className={FIELD} value={form.website} onChange={(e) => set('website', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1" htmlFor="brand-logo">
          <span className={LABEL}>Logo URL</span>
          <input id="brand-logo" type="url" placeholder="https://" className={FIELD} value={form.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1" htmlFor="brand-category">
          <span className={LABEL}>Category</span>
          <input id="brand-category" className={FIELD} value={form.category} onChange={(e) => set('category', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2" htmlFor="brand-campaign">
          <span className={LABEL}>Campaign title</span>
          <input id="brand-campaign" className={FIELD} value={form.campaignTitle} onChange={(e) => set('campaignTitle', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2" htmlFor="brand-blurb">
          <span className={LABEL}>Blurb</span>
          <textarea id="brand-blurb" rows={3} className={FIELD} value={form.blurb} onChange={(e) => set('blurb', e.target.value)} />
        </label>
      </div>
      <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-stone-700" htmlFor="brand-featured">
        <input
          id="brand-featured"
          type="checkbox"
          className="h-4 w-4 cursor-pointer rounded border-stone-300 text-plum-600 focus:ring-plum-500"
          checked={form.featured}
          onChange={(e) => set('featured', e.target.checked)}
        />
        Featured on the media kit
      </label>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving} className={BTN_PRIMARY}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {saving ? 'Saving…' : 'Save brand'}
        </button>
        <button type="button" onClick={onCancel} className={BTN_SECONDARY}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function AddBrandByUrl() {
  const [url, setUrl] = useState('')
  const note = 'Auto-create from URL — coming soon (scrape-meta, Phase 6)'
  return (
    <div className={`${CARD} flex flex-col gap-2`} title={note}>
      <span className={LABEL}>Add from URL</span>
      <div className="flex items-center gap-2">
        <input
          id="brand-from-url"
          type="url"
          placeholder="https://brand.com"
          className={`${FIELD} flex-1`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled
          aria-disabled
        />
        <button type="button" disabled title={note} className={BTN_PRIMARY}>
          <Link2 size={16} /> Add
        </button>
      </div>
      <p className="text-xs text-stone-400">{note}</p>
    </div>
  )
}
