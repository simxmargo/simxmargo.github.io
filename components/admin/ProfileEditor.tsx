'use client'

import { useEffect, useState, type FormEvent } from 'react'
import {
  Plus,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  RefreshCw,
  Loader2,
  UserCircle,
  Tag,
  Send,
  Mail,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { saveProfile } from '@/lib/admin/resources/profile'
import { regenerateShareCard } from '@/lib/og/shareCard'
import { useAdminResource, adminKeys, type AdminFetchError } from '@/lib/admin/queries'
import { ImageField } from '@/components/admin/ImageField'
import { FormSkeleton } from '@/components/admin/Skeleton'
import type { PublicProfile, RateCardItem } from '@/lib/mediakit-types'

// What GET /api/admin/profile returns: the public profile (camelCase) plus the
// read-only `metrics` (derived from social_stats) and the `platforms` list. The
// metrics are DISPLAY-ONLY — never written back in the PUT payload.
type ProfileResponse = Partial<PublicProfile> & {
  metrics?: { followers: string; avgViews: string; engagement: string }
  platforms?: string[]
}

// The editable subset of PublicProfile this form owns. The Profile tab now owns
// ALL creator identity + outreach fields (moved here from the old Settings tab).
// press_logos / theme / totalFollowers are intentionally left out of the PUT
// payload so the server preserves whatever it already has on those fields.
interface ProfileForm {
  displayName: string
  tagline: string
  niche: string
  location: string
  audience: string
  replyToEmail: string
  mailingAddress: string
  bioMd: string
  avatarUrl: string
  ogImageUrl: string
  rateCard: RateCardItem[]
  showRates: boolean
  showRatesSection: boolean
  isPublished: boolean
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'config-missing'

const EMPTY_FORM: ProfileForm = {
  displayName: '',
  tagline: '',
  niche: '',
  location: '',
  audience: '',
  replyToEmail: '',
  mailingAddress: '',
  bioMd: '',
  avatarUrl: '',
  ogImageUrl: '',
  rateCard: [],
  showRates: true,
  showRatesSection: true,
  isPublished: false,
}

// Pull only the editable fields out of whatever the GET returns. ogImageUrl lives
// inside the seo jsonb server-side, so the route surfaces it on `seo.ogImageUrl`.
function toForm(p: ProfileResponse | null | undefined): ProfileForm {
  if (!p) return EMPTY_FORM
  return {
    displayName: p.displayName ?? '',
    tagline: p.tagline ?? '',
    niche: p.niche ?? '',
    location: p.location ?? '',
    audience: p.audience ?? '',
    replyToEmail: p.replyToEmail ?? '',
    mailingAddress: p.mailingAddress ?? '',
    bioMd: p.bioMd ?? '',
    avatarUrl: p.avatarUrl ?? '',
    ogImageUrl: (p as { ogImageUrl?: string }).ogImageUrl ?? p.seo?.ogImageUrl ?? '',
    rateCard: Array.isArray(p.rateCard) ? p.rateCard : [],
    showRates: (p as { showRates?: boolean }).showRates !== false, // default true
    showRatesSection: (p as { showRatesSection?: boolean }).showRatesSection !== false, // default true
    isPublished: Boolean(p.isPublished),
  }
}

export function ProfileEditor() {
  const qc = useQueryClient()
  const q = useAdminResource<ProfileResponse>('profile')
  // Handle is DERIVED from Social Stats (no longer a separate editable field) — read
  // the same cached socials the Social Stats tab uses and pick the top account.
  const socialsQ = useAdminResource<Array<{ handle?: string; followers?: number }>>('socials')
  const primaryHandle =
    (Array.isArray(socialsQ.data) ? socialsQ.data : [])
      .filter((s) => s.handle)
      .sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))[0]?.handle ?? ''

  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM)
  const [save, setSave] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')
  // Share-card (og:image) regeneration status — kept SEPARATE from the profile save so
  // a card failure never blocks (or masks) a successful profile save.
  const [card, setCard] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [cardError, setCardError] = useState<string | null>(null)
  // The media kit URL is just this site's root — read it on the client (avoids a
  // hydration mismatch) rather than asking the user to type it.
  const [siteRoot, setSiteRoot] = useState('')
  useEffect(() => {
    setSiteRoot(window.location.origin)
  }, [])

  // Seed local form state from the shared cache. Keyed on [q.data], which is
  // stable while cached — so revisiting the tab never clobbers in-flight edits
  // (the cached object identity doesn't change without a refetch/invalidate).
  useEffect(() => {
    if (q.data !== undefined) setForm(toForm(q.data))
  }, [q.data])

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

  // Re-render the OG share card from live data → media/og/card.png (the stable URL
  // og:image points at). Decoupled from the deploy, so the card changes on save.
  async function runRegen() {
    setCard('working')
    setCardError(null)
    const r = await regenerateShareCard()
    if (r.ok) {
      setCard('done')
    } else {
      setCard('error')
      setCardError(r.error)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSave('saving')
    setSaveError('')
    // Only send the fields we edit; drop empty rate-card notes; preserve
    // server-side fields (pressLogos, theme, totalFollowers) by omitting them.
    // metrics are READ-ONLY — never sent. ogImageUrl is merged into seo server-side.
    const payload = {
      displayName: form.displayName,
      tagline: form.tagline,
      niche: form.niche,
      location: form.location,
      audience: form.audience,
      replyToEmail: form.replyToEmail,
      mailingAddress: form.mailingAddress,
      bioMd: form.bioMd,
      avatarUrl: form.avatarUrl,
      ogImageUrl: form.ogImageUrl,
      rateCard: form.rateCard.map((r) => ({
        deliverable: r.deliverable,
        price: r.price,
        ...(r.note?.trim() ? { note: r.note } : {}),
      })),
      showRates: form.showRates,
      showRatesSection: form.showRatesSection,
      isPublished: form.isPublished,
    }
    try {
      await saveProfile(payload)
      setSave('saved')
      // Refresh the shared cache so ThemeEditor + any other reader (and the next
      // visit to this tab) see the saved values.
      void qc.invalidateQueries({ queryKey: adminKeys.profile })
      // The share card mirrors saved profile data — refresh it (non-blocking; its own
      // status is shown by the "Update share card" control, not the Save button).
      void runRegen()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Couldn’t reach the server. Try again.')
      setSave('error')
    }
  }

  // `isLoading` is true only on the very first load — cached revisits skip the skeleton.
  if (q.isLoading) {
    return <FormSkeleton withHeader titleW={270} subW={380} cards={2} fields={4} />
  }

  if (q.isError) {
    const err = q.error as AdminFetchError | null
    const msg = err?.message || 'Couldn’t load profile.'
    return (
      <>
        <header className="main-head">
          <div>
            <h1 className="page-title display">Media kit profile</h1>
            <p className="page-sub">The identity and pricing shown on your public kit.</p>
          </div>
        </header>
        <div className="stack">
          <div className="banner banner-error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <div>
              <p style={{ fontWeight: 600, margin: 0 }}>
                {msg}
                {err?.status ? ` (${err.status})` : ''}
              </p>
              <button
                type="button"
                onClick={() => void q.refetch()}
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 12 }}
              >
                <RotateCcw size={14} aria-hidden="true" /> Retry
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  const metrics = q.data?.metrics

  return (
    <form onSubmit={onSubmit}>
      {/* Heading */}
      <header className="main-head">
        <div>
          <h1 className="page-title display">Media kit profile</h1>
        </div>
        <div className="flex items-center gap-3">
          <a href="/" target="_blank" rel="noreferrer" className="btn btn-ghost">
            View public kit <ExternalLink size={14} aria-hidden="true" />
          </a>
          {/* Always-visible save (the form also has a Save bar at the bottom). */}
          <button type="submit" disabled={save === 'saving'} className="btn btn-primary">
            {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved ✓' : 'Save changes'}
          </button>
        </div>
      </header>

      <div className="stack">
        {/* Identity */}
        <section className="card">
          <div className="card-head">
            <span className="ico-badge">
              <UserCircle size={18} aria-hidden="true" />
            </span>
            <h2 className="card-title">Identity</h2>
          </div>

          <div className="card-body grid2">
            <div className="field">
              <label htmlFor="displayName" className="flabel">
                Display name
              </label>
              <input
                id="displayName"
                type="text"
                value={form.displayName}
                onChange={(e) => update('displayName', e.target.value)}
                className="input"
                placeholder="simxmargo"
              />
            </div>
            <div className="field">
              <label htmlFor="niche" className="flabel">
                Niche
              </label>
              <input
                id="niche"
                type="text"
                value={form.niche}
                onChange={(e) => update('niche', e.target.value)}
                className="input"
                placeholder="Fashion & lifestyle"
              />
            </div>

            <div className="field col-span">
              <label htmlFor="tagline" className="flabel">
                Tagline
              </label>
              <input
                id="tagline"
                type="text"
                value={form.tagline}
                onChange={(e) => update('tagline', e.target.value)}
                className="input"
                placeholder="A short one-liner about you"
              />
            </div>

            <div className="field">
              <label htmlFor="location" className="flabel">
                Location
              </label>
              <input
                id="location"
                type="text"
                value={form.location}
                onChange={(e) => update('location', e.target.value)}
                className="input"
                placeholder="Los Angeles, CA"
              />
            </div>

            <div className="field col-span">
              <label htmlFor="bioMd" className="flabel">
                Bio (Markdown)
              </label>
              <textarea
                id="bioMd"
                rows={5}
                value={form.bioMd}
                onChange={(e) => update('bioMd', e.target.value)}
                className="textarea"
                placeholder="Tell brands who you are. Markdown is supported."
              />
            </div>

            <ImageField
              label="Portrait"
              value={form.avatarUrl}
              onChange={(url) => update('avatarUrl', url)}
              folder="portraits"
              hint="The big portrait shown beside your name in the hero."
            />
            <ImageField
              label="Social share image"
              value={form.ogImageUrl}
              onChange={(url) => update('ogImageUrl', url)}
              folder="og"
              hint="The photo behind your auto-generated share card (your name + total reach are overlaid). It updates when you Save — or use “Update share card” below. Social platforms still cache the old one, so re-shares can lag."
            />
          </div>

          {/* The share card is re-rendered from live data and uploaded to a stable
              Storage URL whenever you save; this refreshes it on demand — e.g. after a
              social-stats change, or to seed it the first time — without a full save. */}
          <div className="field" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void runRegen()}
              disabled={card === 'working'}
            >
              {card === 'working' ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw size={14} aria-hidden="true" />
              )}{' '}
              {card === 'working' ? 'Updating share card…' : 'Update share card'}
            </button>
            {card === 'done' && (
              <p className="field-hint" style={{ color: 'var(--accent)', marginTop: 8 }}>
                <CheckCircle2 size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Share card updated. Re-shares may lag while social platforms refresh their cache.
              </p>
            )}
            {card === 'error' && cardError && (
              <p className="field-hint" style={{ color: 'var(--danger)', marginTop: 8 }}>
                Couldn’t update the share card: {cardError}
              </p>
            )}
          </div>
        </section>

        {/* Creator profile — outreach identity (moved here from Settings) */}
        <section className="card">
          <div className="card-head">
            <span className="ico-badge">
              <Mail size={18} aria-hidden="true" />
            </span>
            <div>
              <h2 className="card-title">Creator profile</h2>
              <p className="card-sub">Auto-filled into pitch emails and your kit header.</p>
            </div>
          </div>

          <div className="card-body grid2">
            {/* Handle is read-only — sourced from Social Stats (top account), not a
                separate field, so the two can never drift out of sync. */}
            <div className="field">
              <label htmlFor="handle" className="flabel">
                Handle
              </label>
              <input
                id="handle"
                type="text"
                value={primaryHandle || '—'}
                className="input is-readonly"
                readOnly
              />
              <span className="field-hint">From your top account in Social Stats</span>
            </div>

            <div className="field">
              <label htmlFor="replyToEmail" className="flabel">
                Reply-to email
              </label>
              <input
                id="replyToEmail"
                type="email"
                value={form.replyToEmail}
                onChange={(e) => update('replyToEmail', e.target.value)}
                className="input"
                placeholder="hello@yourdomain.com"
              />
            </div>

            <div className="field col-span">
              <label htmlFor="audience" className="flabel">
                Audience
              </label>
              <input
                id="audience"
                type="text"
                value={form.audience}
                onChange={(e) => update('audience', e.target.value)}
                className="input"
                placeholder="Women 18–34 in SE Asia, with a growing US following"
              />
            </div>

            <div className="field">
              <label htmlFor="mailingAddress" className="flabel">
                Mailing address
              </label>
              <input
                id="mailingAddress"
                type="text"
                value={form.mailingAddress}
                onChange={(e) => update('mailingAddress', e.target.value)}
                className="input"
                placeholder="City, Country"
              />
            </div>

            {/* Media kit URL is read-only — it's simply this site's root, not a value
                to type. "View" opens the live kit. */}
            <div className="field col-span">
              <label htmlFor="mediaKitUrl" className="flabel">
                Media kit URL
              </label>
              <div className="url-row">
                <input
                  id="mediaKitUrl"
                  type="text"
                  value={siteRoot || '—'}
                  className="input is-readonly"
                  readOnly
                />
                <a className="url-view" href="/" target="_blank" rel="noreferrer">
                  View ↗
                </a>
              </div>
              <span className="field-hint">Your live kit — the site root</span>
            </div>

            {/* Read-only Reach — derived from social_stats (edited in Social Stats). */}
            <div className="field">
              <label htmlFor="reach-followers" className="flabel">
                Followers
              </label>
              <input
                id="reach-followers"
                type="text"
                value={metrics?.followers ?? '—'}
                className="input is-readonly"
                readOnly
              />
              <span className="field-hint">Edit per-platform in Social Stats</span>
            </div>
            <div className="field">
              <label htmlFor="reach-avgviews" className="flabel">
                Avg views
              </label>
              <input
                id="reach-avgviews"
                type="text"
                value={metrics?.avgViews ?? '—'}
                className="input is-readonly"
                readOnly
              />
              <span className="field-hint">Edit per-platform in Social Stats</span>
            </div>
            <div className="field">
              <label htmlFor="reach-engagement" className="flabel">
                Engagement
              </label>
              <input
                id="reach-engagement"
                type="text"
                value={metrics?.engagement ?? '—'}
                className="input is-readonly"
                readOnly
              />
              <span className="field-hint">Edit per-platform in Social Stats</span>
            </div>
          </div>
        </section>

        {/* Rate card */}
        <section className="card">
          <div className="card-head" style={{ marginBottom: 0 }}>
            <span className="ico-badge">
              <Tag size={18} aria-hidden="true" />
            </span>
            <div>
              <h2 className="card-title">Rate card</h2>
              <p className="card-sub">Two independent visibility controls for your public media kit.</p>
            </div>
          </div>

          {/* Two orthogonal toggles: (1) whether the Rates section appears at all,
              and (2) whether prices show inside it. (2) is moot when (1) is off, so
              it dims + goes non-interactive then. */}
          <div className="space-y-3" style={{ marginTop: 14 }}>
            <div className="field-card">
              <div>
                <div className="fc-title">Show Rates section</div>
                <div className="fc-sub">Off removes the whole &ldquo;Work, priced simply&rdquo; section (and its nav link) from your public page.</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.showRatesSection}
                aria-label="Show the Rates section on the public media kit"
                onClick={() => update('showRatesSection', !form.showRatesSection)}
                className="switch"
              >
                <span className="switch-knob" />
              </button>
            </div>

            <div className="field-card" style={form.showRatesSection ? undefined : { opacity: 0.5 }}>
              <div>
                <div className="fc-title">Show prices</div>
                <div className="fc-sub">Off keeps the deliverables but swaps each price for &ldquo;Let&rsquo;s talk&rdquo; (rates stay saved).</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.showRates}
                aria-disabled={!form.showRatesSection}
                aria-label="Show prices on the public media kit"
                onClick={() => form.showRatesSection && update('showRates', !form.showRates)}
                className="switch"
              >
                <span className="switch-knob" />
              </button>
            </div>
          </div>
          <div className="flex items-center justify-end" style={{ marginTop: 12 }}>
            <button type="button" onClick={addRow} className="btn btn-ghost btn-sm">
              <Plus size={14} aria-hidden="true" /> Add rate
            </button>
          </div>

          <div className="card-body">
            {form.rateCard.length === 0 ? (
              <div className="empty">No rate-card items yet. Add a row to get started.</div>
            ) : (
              <div className="space-y-3">
                {form.rateCard.map((row, i) => (
                  <div
                    key={i}
                    className="grid items-end gap-3 sm:grid-cols-[1fr_8rem_1fr_auto]"
                    style={{
                      background: 'var(--field)',
                      border: '1px solid var(--line)',
                      borderRadius: 12,
                      padding: 14,
                    }}
                  >
                    <div className="field">
                      <label htmlFor={`rc-deliverable-${i}`} className="flabel">
                        Deliverable
                      </label>
                      <input
                        id={`rc-deliverable-${i}`}
                        type="text"
                        value={row.deliverable}
                        onChange={(e) => updateRow(i, { deliverable: e.target.value })}
                        className="input"
                        placeholder="1× Instagram Reel"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`rc-price-${i}`} className="flabel">
                        Price
                      </label>
                      <input
                        id={`rc-price-${i}`}
                        type="text"
                        value={row.price}
                        onChange={(e) => updateRow(i, { price: e.target.value })}
                        className="input"
                        placeholder="$1,500"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`rc-note-${i}`} className="flabel">
                        Note
                      </label>
                      <input
                        id={`rc-note-${i}`}
                        type="text"
                        value={row.note ?? ''}
                        onChange={(e) => updateRow(i, { note: e.target.value })}
                        className="input"
                        placeholder="Optional"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      aria-label={`Remove rate-card row ${i + 1}`}
                      className="btn btn-danger btn-sm"
                      style={{ height: 44, width: 44, padding: 0, justifyContent: 'center' }}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Publish */}
        <section className="card">
          <div className="flex items-start justify-between gap-4">
            <div className="card-head" style={{ marginBottom: 0 }}>
              <span className="ico-badge">
                <Send size={18} aria-hidden="true" />
              </span>
              <div>
                <h2 className="card-title">Publish</h2>
                <p className="card-sub">When off, the public kit shows nothing.</p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.isPublished}
              aria-label="Publish public media kit"
              onClick={() => update('isPublished', !form.isPublished)}
              className="switch"
            >
              <span className="switch-knob" />
            </button>
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
            <span
              className="inline-flex items-center gap-1.5 text-sm font-medium"
              style={{ color: 'var(--danger)' }}
              role="alert"
            >
              <AlertTriangle size={16} aria-hidden="true" /> {saveError}
            </span>
          )}
        </div>

        {save === 'config-missing' && (
          <div className="banner banner-warn" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>Saving needs SUPABASE_SERVICE_ROLE_KEY set on the server.</span>
          </div>
        )}
      </div>
    </form>
  )
}
