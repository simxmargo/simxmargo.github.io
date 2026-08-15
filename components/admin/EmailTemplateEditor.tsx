'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Bold, Italic, FileText, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { saveProfile } from '@/lib/admin/resources/profile'
import { adminKeys, useAdminResource } from '@/lib/admin/queries'
import { buildDraft, MERGE_FIELDS, type EmailTemplate } from '@/lib/emailTemplate'
import { textToHtml } from '@/lib/emailBody'
import { buildSignature, signatureFields, type SignatureSource } from '@/lib/emailSignature'
import { ImageField } from '@/components/admin/ImageField'
import type { Contact } from '@/lib/types'

// Settings → Email template. Edits the pitch every brand receives, plus the signature
// appended to it.
//
// ONE BODY, NOT LABELLED BLOCKS. An earlier version split this into seven fields with
// a coaching hint under each. It made the structure explicit and turned writing a
// paragraph into filling in a form — the labels explained the email to someone who
// already knew what they wanted to say.
//
// THE PREVIEW IS THE REAL RENDERER. It was previously a <pre> of the plain-text body,
// which is why bold and italic "didn't work": the markers showed literally because
// nothing had converted them yet. It now runs the body through lib/emailBody.ts and
// the signature through lib/emailSignature.ts — the exact modules the Edge Function
// imports — inside a sandboxed iframe, so what you see is what sends.

const SAMPLE: Contact = {
  id: 'sample',
  brand: 'Mejuri',
  email: 'contact@mejuri.com',
  emailType: 'partnerships',
  country: 'CA',
  website: 'mejuri.com',
  status: 'new',
  notes: '',
  lastEmailedAt: null,
  createdAt: '',
  confidence: null,
  alternates: [],
}

interface ProfileShape {
  displayName?: string
  handle?: string
  replyToEmail?: string
  ogImageUrl?: string
}

type SignatureDraft = { name: string; title: string; email: string; username: string; imageUrl: string }

export function EmailTemplateEditor() {
  const qc = useQueryClient()
  const profile = useStore((s) => s.profile)
  const saved = useStore((s) => s.emailTemplate)
  const hydrate = useStore((s) => s.hydrate)

  const profileQ = useAdminResource<ProfileShape>('profile')
  const p = profileQ.data

  // The signature's non-overridden defaults come from the profile, so the editor's
  // fields start showing exactly what currently sends rather than empty boxes.
  const baseSource: SignatureSource = useMemo(
    () => ({
      displayName: p?.displayName ?? '',
      handle: p?.handle ?? '',
      replyToEmail: p?.replyToEmail ?? '',
      ogImageUrl: p?.ogImageUrl ?? '',
      content: null,
    }),
    [p],
  )

  const [template, setTemplate] = useState<EmailTemplate>(saved)
  const [sig, setSig] = useState<SignatureDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // Seed the signature fields once the profile lands. Doing it in render (rather than
  // an effect) avoids a frame of empty inputs.
  const sigDraft: SignatureDraft = sig ?? signatureFields(baseSource)

  const dirty =
    template.subject !== saved.subject ||
    template.body !== saved.body ||
    (sig !== null && JSON.stringify(sig) !== JSON.stringify(signatureFields(baseSource)))

  const preview = useMemo(
    () => buildDraft(SAMPLE, profile, template),
    [template, profile],
  )

  // Body and signature are memoised SEPARATELY and written into their own containers.
  // Regenerating one `srcDoc` on every keystroke tore down the iframe's whole document
  // and rebuilt it — which re-created the signature <img> and re-fetched the photo on
  // every character typed. Splitting them means typing in the body never touches the
  // node holding the image.
  const bodyHtml = useMemo(() => textToHtml(preview.body), [preview.body])
  const sigHtml = useMemo(
    () => buildSignature({ ...baseSource, content: { signature: sigDraft } }).html,
    [baseSource, sigDraft],
  )

  const frameRef = useRef<HTMLIFrameElement>(null)
  const [frameReady, setFrameReady] = useState(false)

  // `sandbox="allow-same-origin"` (WITHOUT allow-scripts) is what lets the parent reach
  // contentDocument to patch it. No script can execute inside either way, so the
  // isolation that matters is intact — and the document now persists across edits.
  useEffect(() => {
    const el = frameRef.current?.contentDocument?.getElementById('preview-body')
    if (el) el.innerHTML = bodyHtml
  }, [bodyHtml, frameReady])

  useEffect(() => {
    const el = frameRef.current?.contentDocument?.getElementById('preview-sig')
    if (el) el.innerHTML = sigHtml
  }, [sigHtml, frameReady])

  // Mounted ONCE. Changing this string would remount the frame, which is the very
  // thing being avoided — so it holds only empty containers.
  const skeleton = useMemo(
    () =>
      `<!doctype html><meta charset="utf-8">` +
      `<body style="margin:0;padding:18px;background:#fff">` +
      `<div id="preview-body"></div><div id="preview-sig"></div>` +
      `</body>`,
    [],
  )

  function patchSig(key: keyof SignatureDraft, value: string): void {
    setSig({ ...sigDraft, [key]: value })
    setNotice('')
  }

  // Wrap the selection, or drop the caret between the markers when nothing is selected
  // — the same behaviour as every editor's bold button, so it needs no explaining.
  function wrapSelection(marker: string): void {
    const el = bodyRef.current
    if (!el) return
    const { selectionStart: start, selectionEnd: end, value } = el
    const selected = value.slice(start, end)
    setTemplate((t) => ({
      ...t,
      body: `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`,
    }))
    setNotice('')
    // Restore the caret AFTER React re-renders the controlled value, or the browser
    // parks it at the end and the next keystroke lands in the wrong place.
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + marker.length, start + marker.length + selected.length)
    })
  }

  function insertToken(token: string): void {
    const el = bodyRef.current
    if (!el) return
    const { selectionStart: start, selectionEnd: end, value } = el
    setTemplate((t) => ({ ...t, body: `${value.slice(0, start)}${token}${value.slice(end)}` }))
    setNotice('')
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  async function onSave(): Promise<void> {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      // saveProfile shallow-merges `content`, so writing both keys here cannot clobber
      // the public-site copy stored alongside them.
      await saveProfile({
        content: {
          emailTemplate: { subject: template.subject, body: template.body },
          signature: { ...sigDraft },
        },
      })
      await qc.invalidateQueries({ queryKey: adminKeys.profile })
      void hydrate()
      setSig(null) // re-seed from the freshly saved profile
      setNotice('Saved. New drafts use it immediately.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <span className="ico-badge">
          <FileText size={18} aria-hidden="true" />
        </span>
        <h2 className="card-title">Email template</h2>
        {dirty && <span className="pill pill-accent">Unsaved</span>}
      </div>

      <div className="card-body">
        <div className="tpl-grid">
          {/* ── Editor ──────────────────────────────────────────────────── */}
          <div className="stack" style={{ gap: 16, maxWidth: 'none' }}>
            <div>
              <label className="flabel" htmlFor="tpl-subject">
                Subject
              </label>
              <input
                id="tpl-subject"
                className="input"
                value={template.subject}
                onChange={(e) => {
                  setTemplate((t) => ({ ...t, subject: e.target.value }))
                  setNotice('')
                }}
                style={{ marginTop: 6 }}
              />
            </div>

            <div>
              <label className="flabel" htmlFor="tpl-body">
                Body
              </label>
              <div className="tpl-toolbar" role="toolbar" aria-label="Formatting">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => wrapSelection('**')}
                  title="Bold the selected text"
                  aria-label="Bold"
                >
                  <Bold size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => wrapSelection('*')}
                  title="Italicise the selected text"
                  aria-label="Italic"
                >
                  <Italic size={13} aria-hidden="true" />
                </button>
                <span className="tpl-divider" aria-hidden="true" />
                {MERGE_FIELDS.map((f) => (
                  <button
                    key={f.token}
                    type="button"
                    className="tpl-chip"
                    onClick={() => insertToken(f.token)}
                    title={`Insert ${f.label}`}
                  >
                    {f.token}
                  </button>
                ))}
              </div>
              <textarea
                id="tpl-body"
                ref={bodyRef}
                className="textarea"
                rows={16}
                value={template.body}
                onChange={(e) => {
                  setTemplate((t) => ({ ...t, body: e.target.value }))
                  setNotice('')
                }}
              />
            </div>

            {/* ── Signature fields ──────────────────────────────────────── */}
            <div>
              <div className="flabel" style={{ marginBottom: 10 }}>
                Signature
              </div>
              <div className="sig-fields">
                <div>
                  <label className="flabel" htmlFor="sig-name">
                    Name
                  </label>
                  <input
                    id="sig-name"
                    className="input"
                    value={sigDraft.name}
                    onChange={(e) => patchSig('name', e.target.value)}
                    style={{ marginTop: 6 }}
                  />
                </div>
                <div>
                  <label className="flabel" htmlFor="sig-title">
                    Title
                  </label>
                  <input
                    id="sig-title"
                    className="input"
                    value={sigDraft.title}
                    onChange={(e) => patchSig('title', e.target.value)}
                    style={{ marginTop: 6 }}
                  />
                </div>
                <div>
                  <label className="flabel" htmlFor="sig-email">
                    Email
                  </label>
                  <input
                    id="sig-email"
                    className="input"
                    value={sigDraft.email}
                    onChange={(e) => patchSig('email', e.target.value)}
                    style={{ marginTop: 6 }}
                  />
                </div>
                <div>
                  <label className="flabel" htmlFor="sig-username">
                    Username
                  </label>
                  <input
                    id="sig-username"
                    className="input"
                    value={sigDraft.username}
                    onChange={(e) => patchSig('username', e.target.value)}
                    style={{ marginTop: 6 }}
                  />
                </div>
              </div>

              <div style={{ marginTop: 14, maxWidth: 260 }}>
                <ImageField
                  label="Signature photo"
                  value={sigDraft.imageUrl}
                  onChange={(url) => patchSig('imageUrl', url)}
                  folder="signature"
                  aspect="1 / 1"
                  compact
                />
              </div>
            </div>
          </div>

          {/* ── Live preview ────────────────────────────────────────────── */}
          <div className="tpl-preview-wrap">
            <div className="flabel" style={{ marginBottom: 8 }}>
              Preview — {SAMPLE.brand}
            </div>
            <div className="tpl-preview-subject-out">{preview.subject}</div>
            {/* An iframe, not an inline div: this is EMAIL html, and isolating it from
                the studio's stylesheet is the only way the preview resembles what a
                recipient actually sees. No allow-scripts, so nothing rendered here can
                execute — which is also what makes patching it via innerHTML safe. */}
            <iframe
              ref={frameRef}
              title="Email preview"
              sandbox="allow-same-origin"
              srcDoc={skeleton}
              onLoad={() => setFrameReady(true)}
              className="tpl-preview-frame"
            />
          </div>
        </div>

        <div className="flex items-center gap-3" style={{ marginTop: 18, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onSave()}
            disabled={saving || !dirty}
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Saving…
              </>
            ) : (
              'Save'
            )}
          </button>
          {/* Same size class as Save — a btn-sm next to a full-size primary read as
              two unrelated controls rather than one pair of choices. */}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setTemplate(saved)
              setSig(null)
            }}
            disabled={saving || !dirty}
          >
            Discard changes
          </button>
        </div>

        {notice && (
          <p className="save-ok" style={{ marginTop: 12 }}>
            <CheckCircle2 size={14} aria-hidden="true" />
            {notice}
          </p>
        )}
        {error && (
          <div className="banner banner-error" role="alert" style={{ marginTop: 12 }}>
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </section>
  )
}
