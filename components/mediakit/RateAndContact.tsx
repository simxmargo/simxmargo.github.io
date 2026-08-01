'use client'

import { useMemo, useState } from 'react'
import type { CollabInquiryInput, PublicProfile } from '@/lib/mediakit-types'
import { DEFAULT_SITE_COPY } from '@/lib/mediakit-types'
import { submitCollab } from '@/lib/mediakit/collab'
import type { Brief, ComposeProvider } from '@/lib/mediakit/compose'
import {
  PROVIDER_LABEL,
  briefAsText,
  buildBrief,
  composeUrl,
  detectProvider,
  openCompose,
} from '@/lib/mediakit/compose'
import { copyText } from '@/lib/clipboard'
import { CopyEmail } from './CopyEmail'
import { MailIcon } from './icons'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const ALL_PROVIDERS: ComposeProvider[] = ['gmail', 'outlook', 'mailto']

// Shown in the price column when the admin turns OFF "Show prices" (profile.showRates):
// the rates still list, but each price becomes a short invite to enquire instead.
const PRICE_HIDDEN_LABEL = "Let's talk"

// Single client island owning BOTH the Rates (#rates) and Collaborate (#contact)
// sections plus the shared "selected deliverable" state: clicking Select on a
// rate row pre-fills the contact form's Package select and smooth-scrolls to
// the form. Kept together so the page itself can stay a Server Component.
export function RateAndContact({ profile }: { profile: PublicProfile }) {
  const rateCard = profile.rateCard
  // Editable section copy (admin → Content), each falling back to the shared default.
  const c = profile.content ?? {}
  const ratesEyebrow = c.ratesEyebrow?.trim() || DEFAULT_SITE_COPY.ratesEyebrow
  const ratesTitle = c.ratesTitle?.trim() || DEFAULT_SITE_COPY.ratesTitle
  const collaborateEyebrow = c.collaborateEyebrow?.trim() || DEFAULT_SITE_COPY.collaborateEyebrow
  const collaborateTitle = c.collaborateTitle?.trim() || DEFAULT_SITE_COPY.collaborateTitle
  // Contact email comes from the profile (admin → Profile → Reply-to email), with
  // the design's address as a last-resort fallback so the link is never empty.
  const contactEmail = profile.replyToEmail?.trim() || 'hello@simxmargo.com'
  const deliverables = useMemo(
    () => Array.from(new Set(rateCard.map((r) => r.deliverable).filter(Boolean))),
    [rateCard],
  )

  // Shared form state.
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [deliverable, setDeliverable] = useState('') // shared: selectRate() sets this
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  // 'ready' = the brief is composed and waiting for the visitor to open it in
  // their own mail client. Nothing is "sending" any more — see lib/mediakit/compose.
  const [status, setStatus] = useState<'idle' | 'ready'>('idle')
  const [formError, setFormError] = useState('')
  const [brief, setBrief] = useState<Brief | null>(null)
  const [provider, setProvider] = useState<ComposeProvider>('mailto')
  const [briefCopied, setBriefCopied] = useState(false)

  function selectRate(d: string) {
    setDeliverable(d)
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const el = document.getElementById('contact')
    if (el)
      window.scrollTo({
        top: el.getBoundingClientRect().top + window.scrollY - 70,
        behavior: reducedMotion ? 'auto' : 'smooth',
      })
  }

  function resetForm() {
    setName('')
    setEmail('')
    setCompany('')
    setDeliverable('')
    setMessage('')
    setWebsite('')
    setStatus('idle')
    setFormError('')
    setBrief(null)
    setBriefCopied(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    const trimmedMessage = message.trim()

    // Validation, now with a visible reason — the old version returned silently,
    // so an invalid field looked like a dead button.
    if (!trimmedName) return setFormError('Please add your name.')
    if (trimmedName.length > 120) return setFormError('That name is a little too long.')
    if (!EMAIL_RE.test(trimmedEmail)) return setFormError('Please enter a valid email address.')
    if (!trimmedMessage) return setFormError('Please add a few details about the collab.')
    if (trimmedMessage.length > 4000) return setFormError('Please keep the details under 4000 characters.')
    setFormError('')

    setBrief(
      buildBrief({
        toName: profile.displayName,
        name: trimmedName,
        company: company.trim() || undefined,
        deliverable: deliverable || undefined,
        message: trimmedMessage,
      }),
    )
    setProvider(detectProvider(trimmedEmail))
    setStatus('ready')

    // Honeypot tripped — show the same panel so a bot learns nothing, but never post.
    if (website) return

    // Keep a triage record in the studio Inbox. Deliberately NOT awaited: the
    // visitor's own email is the channel that matters now, so the panel should
    // never wait on a round trip (or on a paused Supabase project). Failures are
    // logged inside submitCollab.
    const payload: CollabInquiryInput = {
      name: trimmedName,
      email: trimmedEmail,
      company: company.trim() || undefined,
      deliverables: deliverable ? [deliverable] : [],
      message: trimmedMessage,
    }
    void submitCollab(payload)
  }

  // MUST stay synchronous down to openCompose — an await here would let the popup
  // blocker kill the webmail tab.
  function handleCompose(p: ComposeProvider) {
    if (!brief) return
    openCompose(composeUrl(p, contactEmail, brief), p)
  }

  async function handleCopyBrief() {
    if (!brief) return
    if (await copyText(briefAsText(contactEmail, brief))) setBriefCopied(true)
  }

  return (
    <>
      {/* Rates section — hidden ENTIRELY when the admin turns off "Show Rates section"
          (profile.showRatesSection). When shown but "Show prices" (profile.showRates) is
          off, each price becomes a "Let's talk" invite and the deliverables stay. */}
      {profile.showRatesSection !== false && (
      <section id="rates" className="rates">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <div className="label reveal">{ratesEyebrow}</div>
              <h2 className="display h2 reveal">{ratesTitle}</h2>
            </div>
          </div>
          <div className="rate-list">
            {rateCard.map((r, i) => (
              <div key={i} className="rate-row reveal">
                <div className="rate-title display">{r.deliverable}</div>
                <div className="rate-meta">{r.note}</div>
                <div className="rate-price display">
                  {profile.showRates === false ? PRICE_HIDDEN_LABEL : r.price}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost rate-btn"
                  onClick={() => selectRate(r.deliverable)}
                >
                  Select
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
      )}

      {/* Contact */}
      <section id="contact" className="contact">
        <div className="wrap">
          <div className="contact-grid">
            <div>
              <div className="label reveal">{collaborateEyebrow}</div>
              <h2 className="display h2 reveal">{collaborateTitle}</h2>
              <div className="contact-meta reveal">
                <div className="cm-row">
                  <span className="label">Email</span>
                  <CopyEmail email={contactEmail} />
                </div>
                <div className="cm-row">
                  <span className="label">Based in</span>
                  <span className="cm-v">{profile.location || 'Manila, Philippines'}</span>
                </div>
              </div>
            </div>

            <div className="reveal">
              {status === 'ready' && brief ? (
                <div className="form-success">
                  <div className="display h3">Your brief is ready.</div>
                  <p style={{ color: 'var(--muted)', margin: 0 }}>
                    Send it from your own email — that way my reply lands straight back in your
                    inbox.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary compose-go"
                    onClick={() => handleCompose(provider)}
                  >
                    <span className="btn-ico">
                      <MailIcon />
                    </span>
                    Open in {PROVIDER_LABEL[provider]}
                  </button>
                  <div className="compose-alts">
                    <span className="label">Or use</span>
                    {ALL_PROVIDERS.filter((p) => p !== provider).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="linkbtn"
                        onClick={() => handleCompose(p)}
                      >
                        {PROVIDER_LABEL[p]}
                      </button>
                    ))}
                    {/* Lossless escape hatch: no mail handler, a locked-down work
                        machine, or a long brief that a desktop client truncated. */}
                    <button type="button" className="linkbtn" onClick={handleCopyBrief}>
                      {briefCopied ? 'Brief copied' : 'Copy the brief'}
                    </button>
                  </div>
                  <button type="button" className="linkbtn compose-restart" onClick={resetForm}>
                    Start over
                  </button>
                </div>
              ) : (
                <form className="form" onSubmit={handleSubmit} noValidate>
                  <div className="form-2">
                    <div className="field">
                      <label className="label" htmlFor="f-name">
                        Name
                      </label>
                      <input
                        className="inp"
                        id="f-name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                      />
                    </div>
                    <div className="field">
                      <label className="label" htmlFor="f-email">
                        Email
                      </label>
                      <input
                        className="inp"
                        id="f-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@brand.com"
                      />
                    </div>
                  </div>

                  <div className="form-2">
                    <div className="field">
                      <label className="label" htmlFor="f-company">
                        Brand
                      </label>
                      <input
                        className="inp"
                        id="f-company"
                        type="text"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        placeholder="Brand name"
                      />
                    </div>
                    <div className="field">
                      <label className="label" htmlFor="f-deliv">
                        Package
                      </label>
                      <select
                        className="inp"
                        id="f-deliv"
                        value={deliverable}
                        onChange={(e) => setDeliverable(e.target.value)}
                      >
                        <option value="">Select</option>
                        {deliverables.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                        <option>Custom</option>
                      </select>
                    </div>
                  </div>

                  <div className="field">
                    <label className="label" htmlFor="f-msg">
                      Details
                    </label>
                    <textarea
                      className="inp ta"
                      id="f-msg"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Timeline, goals, budget"
                    />
                  </div>

                  {/* honeypot — bot trap, visually hidden */}
                  <div style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
                    <input
                      tabIndex={-1}
                      autoComplete="off"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                    />
                  </div>

                  {formError && (
                    <p role="alert" style={{ color: 'var(--accent-text)', fontSize: 14, margin: 0 }}>
                      {formError}
                    </p>
                  )}

                  <button
                    type="submit"
                    className="btn btn-primary magnetic"
                    style={{ justifyContent: 'center' }}
                  >
                    Open in my email
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
