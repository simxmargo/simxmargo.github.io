'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Sparkles, MousePointerClick, Image as ImageIcon } from 'lucide-react'
import { saveProfile } from '@/lib/admin/resources/profile'
import { useAdminResource, adminKeys, type AdminFetchError } from '@/lib/admin/queries'
import { ImageField } from '@/components/admin/ImageField'
import { FormSkeleton } from '@/components/admin/Skeleton'
import type { PublicProfile } from '@/lib/mediakit-types'
import { DEFAULT_SITE_COPY } from '@/lib/mediakit-types'

// Studio "Hero" tab — ONE focused place to edit the big top section of the public kit:
// the @name wordmark (display_name), the meta label above it (location · niche), the two
// CTA buttons (content.heroCta*), and the portrait (avatar_url). It reuses the SAME write
// path as Profile + Content (saveProfile, which shallow-merges `content`), so every field
// keeps a single source of truth — editing the name here or in Profile both write
// display_name; the CTAs here or in Content both merge into the content jsonb.

interface HeroForm {
  displayName: string
  location: string
  niche: string
  avatarUrl: string
  heroCtaPrimary: string
  heroCtaSecondary: string
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// Seed the CTA fields with the EFFECTIVE copy (saved value, else the shared default) so
// the inputs show what the kit actually renders; the column fields seed from the row.
function toForm(p: Partial<PublicProfile> | undefined): HeroForm {
  const c = p?.content ?? {}
  const pick = (v: string | undefined, d: string) => (typeof v === 'string' && v.trim() ? v : d)
  return {
    displayName: p?.displayName ?? '',
    location: p?.location ?? '',
    niche: p?.niche ?? '',
    avatarUrl: p?.avatarUrl ?? '',
    heroCtaPrimary: pick(c.heroCtaPrimary, DEFAULT_SITE_COPY.heroCtaPrimary),
    heroCtaSecondary: pick(c.heroCtaSecondary, DEFAULT_SITE_COPY.heroCtaSecondary),
  }
}

export function HeroEditor() {
  const qc = useQueryClient()
  const q = useAdminResource<Partial<PublicProfile>>('profile')

  const [form, setForm] = useState<HeroForm>(() => toForm(undefined))
  const [save, setSave] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')

  // Seed from the shared cache; stable while cached so revisiting never clobbers edits.
  useEffect(() => {
    if (q.data !== undefined) setForm(toForm(q.data))
  }, [q.data])

  function update<K extends keyof HeroForm>(key: K, value: HeroForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    if (save !== 'idle') setSave('idle')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSave('saving')
    setSaveError('')
    try {
      // Columns + a content patch in one call; saveProfile maps the columns and
      // SHALLOW-MERGES content, so the footer/eyebrow copy stays intact.
      await saveProfile({
        displayName: form.displayName.trim(),
        location: form.location.trim(),
        niche: form.niche.trim(),
        avatarUrl: form.avatarUrl,
        content: {
          heroCtaPrimary: form.heroCtaPrimary.trim(),
          heroCtaSecondary: form.heroCtaSecondary.trim(),
        },
      })
      setSave('saved')
      void qc.invalidateQueries({ queryKey: adminKeys.profile })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Couldn’t reach the server. Try again.')
      setSave('error')
    }
  }

  if (q.isLoading) {
    return <FormSkeleton withHeader titleW={120} subW={420} cards={3} fields={2} />
  }

  if (q.isError) {
    const err = q.error as AdminFetchError | null
    return (
      <>
        <header className="main-head">
          <div>
            <h1 className="page-title display">Hero</h1>
            <p className="page-sub">The top section of your public kit.</p>
          </div>
        </header>
        <div className="stack">
          <div className="banner banner-error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{err?.message ?? 'Couldn’t load the hero.'}{err?.status ? ` (${err.status})` : ''}</span>
          </div>
        </div>
      </>
    )
  }

  // Live preview of the meta label exactly as the hero renders it (location + up to 3
  // niche tokens, split on "·"), and the @name wordmark.
  const nameBare = form.displayName.replace(/^@+/, '').trim()
  const labelTokens = [
    form.location.trim(),
    ...form.niche.split('·').map((t) => t.trim()).filter(Boolean).slice(0, 3),
  ].filter(Boolean)

  return (
    <form onSubmit={onSubmit}>
      <header className="main-head">
        <div>
          <h1 className="page-title display">Hero</h1>
          <p className="page-sub">
            The big top section of your public kit — your @name, the label above it, the buttons, and the portrait.
          </p>
        </div>
        <button type="submit" disabled={save === 'saving'} className="btn btn-primary">
          {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved ✓' : 'Save changes'}
        </button>
      </header>

      <div className="stack">
        {/* Name + label */}
        <section className="card">
          <div className="card-head">
            <span className="ico-badge"><Sparkles size={18} aria-hidden="true" /></span>
            <div>
              <h2 className="card-title">Name &amp; label</h2>
              <p className="card-sub">Your handle wordmark and the small line above it.</p>
            </div>
          </div>
          <div className="card-body grid2">
            <div className="field">
              <label htmlFor="hero-name" className="flabel">Name</label>
              <input
                id="hero-name"
                type="text"
                className="input"
                value={form.displayName}
                onChange={(e) => update('displayName', e.target.value)}
                placeholder="simxmargo"
              />
              <span className="field-hint">Shown as &ldquo;@{nameBare || 'yourname'}&rdquo; across the kit (hero, nav, footer). Also your brand name.</span>
            </div>
            <div className="field">
              <label htmlFor="hero-location" className="flabel">Location</label>
              <input
                id="hero-location"
                type="text"
                className="input"
                value={form.location}
                onChange={(e) => update('location', e.target.value)}
                placeholder="Philippines"
              />
            </div>
            <div className="field col-span">
              <label htmlFor="hero-niche" className="flabel">Niche label</label>
              <input
                id="hero-niche"
                type="text"
                className="input"
                value={form.niche}
                onChange={(e) => update('niche', e.target.value)}
                placeholder="Fashion · Beauty · Editing"
              />
              <span className="field-hint">Separate items with &ldquo;·&rdquo;. The first three show after your location.</span>
            </div>
            {labelTokens.length > 0 && (
              <div className="field col-span">
                <span className="flabel">Label preview</span>
                <div className="label" style={{ opacity: 0.85 }}>{labelTokens.join('  ·  ')}</div>
              </div>
            )}
          </div>
        </section>

        {/* Portrait */}
        <section className="card">
          <div className="card-head">
            <span className="ico-badge"><ImageIcon size={18} aria-hidden="true" /></span>
            <div>
              <h2 className="card-title">Portrait</h2>
              <p className="card-sub">The photo filling the right side of the hero.</p>
            </div>
          </div>
          <div className="card-body">
            <ImageField
              label="Hero portrait"
              value={form.avatarUrl}
              onChange={(url) => update('avatarUrl', url)}
              folder="portraits"
              aspect="3 / 4"
              hint="A tall portrait works best — it fills the right ~half of the hero."
            />
          </div>
        </section>

        {/* CTA buttons */}
        <section className="card">
          <div className="card-head">
            <span className="ico-badge"><MousePointerClick size={18} aria-hidden="true" /></span>
            <div>
              <h2 className="card-title">Buttons</h2>
              <p className="card-sub">The two call-to-action buttons under your name. (Also editable in Content.)</p>
            </div>
          </div>
          <div className="card-body grid2">
            <div className="field">
              <label htmlFor="hero-cta1" className="flabel">Primary button</label>
              <input
                id="hero-cta1"
                type="text"
                className="input"
                value={form.heroCtaPrimary}
                onChange={(e) => update('heroCtaPrimary', e.target.value)}
                placeholder={DEFAULT_SITE_COPY.heroCtaPrimary}
              />
            </div>
            <div className="field">
              <label htmlFor="hero-cta2" className="flabel">Secondary button</label>
              <input
                id="hero-cta2"
                type="text"
                className="input"
                value={form.heroCtaSecondary}
                onChange={(e) => update('heroCtaSecondary', e.target.value)}
                placeholder={DEFAULT_SITE_COPY.heroCtaSecondary}
              />
            </div>
          </div>
        </section>

        {/* Save bar */}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={save === 'saving'} className="btn btn-primary">
            {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Save again' : 'Save'}
          </button>
          {save === 'saved' && (
            <span className="save-ok" role="status">
              <CheckCircle2 size={16} aria-hidden="true" /> Saved
            </span>
          )}
          {save === 'error' && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--danger)' }} role="alert">
              <AlertTriangle size={16} aria-hidden="true" /> {saveError}
            </span>
          )}
        </div>
      </div>
    </form>
  )
}
