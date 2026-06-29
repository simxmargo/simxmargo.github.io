'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, RotateCcw, Quote, Type, MousePointerClick } from 'lucide-react'
import { saveProfile } from '@/lib/admin/resources/profile'
import { useAdminResource, adminKeys, type AdminFetchError } from '@/lib/admin/queries'
import { FormSkeleton } from '@/components/admin/Skeleton'
import type { PublicProfile, SiteCopy } from '@/lib/mediakit-types'
import { DEFAULT_SITE_COPY } from '@/lib/mediakit-types'

// Studio "Content" tab: edits the otherwise-hardcoded wording on the public media kit —
// section eyebrows/titles, hero CTAs, and the footer headline. All of it lives in the
// public_profile.content jsonb (one shared row), written through saveProfile's merge so
// it never clobbers other profile fields. Mirrors ProfileEditor's load/save/cache shape.

type CopyForm = Required<SiteCopy>
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// Seed every field with the EFFECTIVE copy (saved value, else the shared default) so the
// inputs always show what the kit currently displays — never a blank field. footerEmphasis
// is the one field where a saved empty string is meaningful (= no accent), so it's kept
// verbatim rather than falling back to the default.
function toForm(content: SiteCopy | undefined): CopyForm {
  const c = content ?? {}
  const pick = (k: keyof SiteCopy) => {
    const v = c[k]
    return typeof v === 'string' && v.trim() ? v : DEFAULT_SITE_COPY[k]
  }
  return {
    footerHeadline: pick('footerHeadline'),
    footerEmphasis: c.footerEmphasis ?? DEFAULT_SITE_COPY.footerEmphasis,
    aboutEyebrow: pick('aboutEyebrow'),
    ratesEyebrow: pick('ratesEyebrow'),
    ratesTitle: pick('ratesTitle'),
    collaborateEyebrow: pick('collaborateEyebrow'),
    collaborateTitle: pick('collaborateTitle'),
    partnersEyebrow: pick('partnersEyebrow'),
    partnersTitle: pick('partnersTitle'),
    heroCtaPrimary: pick('heroCtaPrimary'),
    heroCtaSecondary: pick('heroCtaSecondary'),
  }
}

export function ContentEditor() {
  const qc = useQueryClient()
  const q = useAdminResource<Partial<PublicProfile>>('profile')

  const [form, setForm] = useState<CopyForm>(() => toForm(undefined))
  const [save, setSave] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')

  // Seed from the shared cache; stable while cached so revisiting never clobbers edits.
  useEffect(() => {
    if (q.data !== undefined) setForm(toForm(q.data?.content))
  }, [q.data])

  function update<K extends keyof CopyForm>(key: K, value: CopyForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    if (save !== 'idle') setSave('idle')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSave('saving')
    setSaveError('')
    // Trim everything; the renderers treat an empty heading as "use default" and an empty
    // footer emphasis as "no accent", so trimming is safe and keeps the row tidy.
    const content: SiteCopy = {
      footerHeadline: form.footerHeadline.trim(),
      footerEmphasis: form.footerEmphasis.trim(),
      aboutEyebrow: form.aboutEyebrow.trim(),
      ratesEyebrow: form.ratesEyebrow.trim(),
      ratesTitle: form.ratesTitle.trim(),
      collaborateEyebrow: form.collaborateEyebrow.trim(),
      collaborateTitle: form.collaborateTitle.trim(),
      partnersEyebrow: form.partnersEyebrow.trim(),
      partnersTitle: form.partnersTitle.trim(),
      heroCtaPrimary: form.heroCtaPrimary.trim(),
      heroCtaSecondary: form.heroCtaSecondary.trim(),
    }
    try {
      await saveProfile({ content })
      setSave('saved')
      void qc.invalidateQueries({ queryKey: adminKeys.profile })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Couldn’t reach the server. Try again.')
      setSave('error')
    }
  }

  if (q.isLoading) {
    return <FormSkeleton withHeader titleW={150} subW={430} cards={3} fields={2} />
  }

  if (q.isError) {
    const err = q.error as AdminFetchError | null
    return (
      <>
        <header className="main-head">
          <div>
            <h1 className="page-title display">Content</h1>
            <p className="page-sub">The wording across your public kit.</p>
          </div>
        </header>
        <div className="stack">
          <div className="banner banner-error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <div>
              <p style={{ fontWeight: 600, margin: 0 }}>
                {err?.message ?? 'Couldn’t load content.'}
                {err?.status ? ` (${err.status})` : ''}
              </p>
              <button type="button" onClick={() => void q.refetch()} className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>
                <RotateCcw size={14} aria-hidden="true" /> Retry
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  // Footer preview: highlight the first occurrence of the emphasis word, mirroring the
  // public footer. Empty / not-found emphasis renders the headline plain.
  const previewHeadline = form.footerHeadline.trim() || DEFAULT_SITE_COPY.footerHeadline
  const previewEmphasis = form.footerEmphasis.trim()
  const emphasisIdx = previewEmphasis ? previewHeadline.toLowerCase().indexOf(previewEmphasis.toLowerCase()) : -1

  return (
    <form onSubmit={onSubmit}>
      <header className="main-head">
        <div>
          <h1 className="page-title display">Content</h1>
          <p className="page-sub">The wording across your public kit — section headings, hero buttons, and the footer.</p>
        </div>
        <button type="submit" disabled={save === 'saving'} className="btn btn-primary">
          {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved ✓' : 'Save changes'}
        </button>
      </header>

      <div className="stack">
        {/* Hero call-to-action labels */}
        <section className="card">
          <div className="card-head">
            <span className="ico-badge"><MousePointerClick size={18} aria-hidden="true" /></span>
            <div>
              <h2 className="card-title">Hero buttons</h2>
              <p className="card-sub">The two call-to-action buttons under your name.</p>
            </div>
          </div>
          <div className="card-body grid2">
            <div className="field">
              <label htmlFor="heroCtaPrimary" className="flabel">Primary button</label>
              <input id="heroCtaPrimary" type="text" value={form.heroCtaPrimary} onChange={(e) => update('heroCtaPrimary', e.target.value)} className="input" placeholder={DEFAULT_SITE_COPY.heroCtaPrimary} />
            </div>
            <div className="field">
              <label htmlFor="heroCtaSecondary" className="flabel">Secondary button</label>
              <input id="heroCtaSecondary" type="text" value={form.heroCtaSecondary} onChange={(e) => update('heroCtaSecondary', e.target.value)} className="input" placeholder={DEFAULT_SITE_COPY.heroCtaSecondary} />
            </div>
          </div>
        </section>

        {/* Section headings */}
        <section className="card">
          <div className="card-head">
            <span className="ico-badge"><Type size={18} aria-hidden="true" /></span>
            <div>
              <h2 className="card-title">Section headings</h2>
              <p className="card-sub">The small eyebrow label and title above each section. Leave blank to use the default.</p>
            </div>
          </div>
          <div className="card-body grid2">
            <div className="field">
              <label htmlFor="ratesEyebrow" className="flabel">Rates — eyebrow</label>
              <input id="ratesEyebrow" type="text" value={form.ratesEyebrow} onChange={(e) => update('ratesEyebrow', e.target.value)} className="input" placeholder={DEFAULT_SITE_COPY.ratesEyebrow} />
            </div>
            <div className="field">
              <label htmlFor="ratesTitle" className="flabel">Rates — title</label>
              <input id="ratesTitle" type="text" value={form.ratesTitle} onChange={(e) => update('ratesTitle', e.target.value)} className="input" placeholder={DEFAULT_SITE_COPY.ratesTitle} />
            </div>

            <div className="field">
              <label htmlFor="collaborateEyebrow" className="flabel">Collaborate — eyebrow</label>
              <input id="collaborateEyebrow" type="text" value={form.collaborateEyebrow} onChange={(e) => update('collaborateEyebrow', e.target.value)} className="input" placeholder={DEFAULT_SITE_COPY.collaborateEyebrow} />
            </div>
            <div className="field">
              <label htmlFor="collaborateTitle" className="flabel">Collaborate — title</label>
              <input id="collaborateTitle" type="text" value={form.collaborateTitle} onChange={(e) => update('collaborateTitle', e.target.value)} className="input" placeholder={DEFAULT_SITE_COPY.collaborateTitle} />
            </div>

            <div className="field">
              <label htmlFor="partnersEyebrow" className="flabel">Partners — eyebrow</label>
              <input id="partnersEyebrow" type="text" value={form.partnersEyebrow} onChange={(e) => update('partnersEyebrow', e.target.value)} className="input" placeholder={DEFAULT_SITE_COPY.partnersEyebrow} />
            </div>
            <div className="field">
              <label htmlFor="partnersTitle" className="flabel">Partners — title</label>
              <input id="partnersTitle" type="text" value={form.partnersTitle} onChange={(e) => update('partnersTitle', e.target.value)} className="input" placeholder={DEFAULT_SITE_COPY.partnersTitle} />
            </div>
          </div>
        </section>

        {/* Footer headline */}
        <section className="card">
          <div className="card-head">
            <span className="ico-badge"><Quote size={18} aria-hidden="true" /></span>
            <div>
              <h2 className="card-title">Footer headline</h2>
              <p className="card-sub">The big closing line at the bottom of your kit — one word shows in your accent colour.</p>
            </div>
          </div>
          <div className="card-body grid2">
            <div className="field col-span">
              <label htmlFor="footerHeadline" className="flabel">Headline</label>
              <input id="footerHeadline" type="text" value={form.footerHeadline} onChange={(e) => update('footerHeadline', e.target.value)} className="input" placeholder={DEFAULT_SITE_COPY.footerHeadline} />
            </div>
            <div className="field">
              <label htmlFor="footerEmphasis" className="flabel">Accented word</label>
              <input id="footerEmphasis" type="text" value={form.footerEmphasis} onChange={(e) => update('footerEmphasis', e.target.value)} className="input" placeholder={DEFAULT_SITE_COPY.footerEmphasis} />
              <span className="field-hint">A word from the headline, shown in your accent colour. Leave blank for none.</span>
            </div>
            <div className="field">
              <span className="flabel">Preview</span>
              <div style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.3 }}>
                {emphasisIdx === -1 ? (
                  previewHeadline
                ) : (
                  <>
                    {previewHeadline.slice(0, emphasisIdx)}
                    <span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>
                      {previewHeadline.slice(emphasisIdx, emphasisIdx + previewEmphasis.length)}
                    </span>
                    {previewHeadline.slice(emphasisIdx + previewEmphasis.length)}
                  </>
                )}
              </div>
              {previewEmphasis && emphasisIdx === -1 && (
                <span className="field-hint" style={{ color: 'var(--accent)' }}>
                  &ldquo;{previewEmphasis}&rdquo; isn&rsquo;t in the headline — nothing will be accented.
                </span>
              )}
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
