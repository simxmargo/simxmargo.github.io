'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Send } from 'lucide-react'
import type { CollabInquiryInput, RateCardItem } from '@/lib/mediakit-types'
import { Section } from '@/components/mediakit/Section'

interface WorkWithMeFormProps {
  rateCard: RateCardItem[]
  preselectedDeliverable?: string
  preselectNonce?: number // bumps on every Enquire click so repeat clicks re-apply
  onSubmitted?: () => void
}

interface FieldErrors {
  name?: string
  email?: string
  company?: string
  message?: string
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const inputCls =
  'w-full rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-ivory placeholder:text-ivory/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-400'
const labelCls = 'block text-xs font-medium uppercase tracking-[0.2em] text-ivory/60'
const errCls = 'mt-1 text-sm text-blush-400'

function FieldError({ id, msg }: { id: string; msg?: string }) {
  if (!msg) return null
  return (
    <p id={id} role="alert" className={errCls}>
      {msg}
    </p>
  )
}

export function WorkWithMeForm({ rateCard, preselectedDeliverable, preselectNonce, onSubmitted }: WorkWithMeFormProps) {
  const deliverables = useMemo(
    () => Array.from(new Set(rateCard.map((r) => r.deliverable).filter(Boolean))),
    [rateCard],
  )

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [budget, setBudget] = useState('')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [website, setWebsite] = useState('') // honeypot
  const [errors, setErrors] = useState<FieldErrors>({})
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')

  useEffect(() => {
    if (preselectedDeliverable) setSelected((prev) => (prev.includes(preselectedDeliverable) ? prev : [...prev, preselectedDeliverable]))
    // preselectNonce in the deps: re-applies even when the same deliverable is
    // enquired twice (value unchanged) after the user deselected its chip.
  }, [preselectedDeliverable, preselectNonce])

  function toggle(d: string) {
    setSelected((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
  }

  function validate(): FieldErrors {
    const e: FieldErrors = {}
    if (!name.trim() || name.length > 120) e.name = 'Please enter your name (under 120 characters).'
    if (!email.trim()) e.email = 'Email is required.'
    else if (!EMAIL_RE.test(email)) e.email = 'Please enter a valid email address.'
    if (company.length > 160) e.company = 'Company name is too long.'
    if (!message.trim() || message.length > 4000) e.message = 'Please share a message (under 4000 characters).'
    return e
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (website) {
      setStatus('success') // honeypot tripped — pretend success, do nothing
      return
    }
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length > 0) return

    setStatus('sending')
    const payload: CollabInquiryInput = {
      name: name.trim(),
      email: email.trim(),
      company: company.trim() || undefined,
      budget: budget.trim() || undefined,
      deliverables: selected,
      message: message.trim(),
    }
    try {
      const res = await fetch('/api/collab', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Request failed')
      setStatus('success')
      onSubmitted?.()
    } catch {
      setStatus('error')
    }
  }

  return (
    <Section id="work-with-me" eyebrow="Collaborate" title="Work with me">
      {status === 'success' ? (
        <div className="max-w-xl rounded-2xl border border-blush-400/30 bg-ink-900 p-8 text-center" role="status">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blush-400/15 text-blush-400">
            <Check aria-hidden className="h-6 w-6" />
          </span>
          <p className="font-editorial text-2xl text-ivory">Thanks — I&apos;ll be in touch soon.</p>
          <p className="mt-2 text-ivory/70">Your inquiry is on its way. Keep an eye on your inbox.</p>
        </div>
      ) : (
        <form noValidate onSubmit={handleSubmit} className="max-w-xl space-y-6">
          <div>
            <label htmlFor="wwm-name" className={labelCls}>Name</label>
            <input id="wwm-name" name="name" value={name} maxLength={120} required aria-required="true"
              aria-invalid={!!errors.name} aria-describedby={errors.name ? 'wwm-name-err' : undefined}
              onChange={(e) => setName(e.target.value)} className={`mt-2 ${inputCls}`} placeholder="Your name" />
            <FieldError id="wwm-name-err" msg={errors.name} />
          </div>

          <div>
            <label htmlFor="wwm-email" className={labelCls}>Email</label>
            <input id="wwm-email" name="email" type="email" inputMode="email" value={email} required aria-required="true"
              aria-invalid={!!errors.email} aria-describedby={errors.email ? 'wwm-email-err' : undefined}
              onChange={(e) => setEmail(e.target.value)} className={`mt-2 ${inputCls}`} placeholder="you@brand.com" />
            <FieldError id="wwm-email-err" msg={errors.email} />
          </div>

          <div>
            <label htmlFor="wwm-company" className={labelCls}>Company <span className="text-ivory/60 normal-case tracking-normal">(optional)</span></label>
            <input id="wwm-company" name="company" value={company} maxLength={160}
              aria-invalid={!!errors.company} aria-describedby={errors.company ? 'wwm-company-err' : undefined}
              onChange={(e) => setCompany(e.target.value)} className={`mt-2 ${inputCls}`} placeholder="Brand or agency" />
            <FieldError id="wwm-company-err" msg={errors.company} />
          </div>

          <div>
            <label htmlFor="wwm-budget" className={labelCls}>Budget <span className="text-ivory/60 normal-case tracking-normal">(optional)</span></label>
            <input id="wwm-budget" name="budget" value={budget}
              onChange={(e) => setBudget(e.target.value)} className={`mt-2 ${inputCls}`} placeholder="e.g. ₱150k–₱300k" />
          </div>

          {deliverables.length > 0 && (
            <fieldset>
              <legend className={labelCls}>Deliverables</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {deliverables.map((d) => {
                  const active = selected.includes(d)
                  return (
                    <button key={d} type="button" aria-pressed={active} onClick={() => toggle(d)}
                      className={`min-h-[44px] rounded-full border px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-400 ${
                        active ? 'border-blush-400/30 bg-blush-400/15 text-blush-300' : 'border-white/20 text-ivory/70 hover:border-white/40'
                      }`}>
                      {d}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          )}

          <div>
            <label htmlFor="wwm-message" className={labelCls}>Message</label>
            <textarea id="wwm-message" name="message" value={message} rows={5} maxLength={4000} required aria-required="true"
              aria-invalid={!!errors.message} aria-describedby={errors.message ? 'wwm-message-err' : undefined}
              onChange={(e) => setMessage(e.target.value)} className={`mt-2 ${inputCls} resize-y`}
              placeholder="Tell me about your campaign, timeline, and goals." />
            <FieldError id="wwm-message-err" msg={errors.message} />
          </div>

          {/* honeypot — hidden from real users */}
          <div className="sr-only" aria-hidden="true">
            <label htmlFor="wwm-website">Leave this field empty</label>
            <input id="wwm-website" name="website" tabIndex={-1} autoComplete="off" value={website}
              onChange={(e) => setWebsite(e.target.value)} />
          </div>

          {status === 'error' && (
            <p role="alert" className="text-sm text-blush-400">
              Something went wrong. Please email me directly at{' '}
              <a href="mailto:hello@simxmargo.com" className="underline hover:text-blush-300">hello@simxmargo.com</a>.
            </p>
          )}

          <button type="submit" disabled={status === 'sending'}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-ivory px-6 py-3 text-sm font-medium text-ink-950 transition-colors hover:bg-blush-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-400 disabled:cursor-not-allowed disabled:opacity-60">
            <Send aria-hidden className="h-4 w-4" />
            {status === 'sending' ? 'Sending…' : 'Send inquiry'}
          </button>
        </form>
      )}
    </Section>
  )
}
