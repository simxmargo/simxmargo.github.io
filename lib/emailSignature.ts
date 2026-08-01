// The email signature — ONE implementation, shared by the browser preview and the
// Edge Function that actually sends.
//
// It lives in lib/ rather than supabase/functions/_shared/ because the Settings editor
// has to re-render it on every keystroke, before anything is saved. Asking the server
// for a preview would mean the signature only updated after a round trip, which is
// exactly the feedback loop that makes editing feel broken.
// `supabase/functions/_shared/signature.ts` re-exports this file.
//
// WHY WE DON'T READ THE REAL GMAIL SIGNATURE
// Fetching it needs `gmail.settings.basic`, which Google classifies RESTRICTED. That
// tier forces app verification or "Testing" mode, and in Testing refresh tokens expire
// every 7 days. The design stays on `gmail.send` (Sensitive, usable unverified) and
// composes the signature instead. Do not add that scope.
//
// Deliberately dependency-free: no framework imports, no Node/Deno builtins, so the
// same file runs in the browser and in Deno.

export interface SignatureSource {
  displayName: string // public_profile.display_name — e.g. "simxmargo"
  handle: string // public_profile.handle — may be empty
  replyToEmail: string // public_profile.reply_to_email
  ogImageUrl: string // public_profile.seo.og_image_url — fallback photo
  content: Record<string, unknown> | null // public_profile.content jsonb
}

export interface Signature {
  html: string
  text: string
}

export interface SignatureFields {
  name: string
  title: string
  email: string
  username: string
  imageUrl: string
}

// Defaults match the Gmail signature this replaces. Every one is overridable from
// Settings via public_profile.content.signature — no migration, no deploy.
export const DEFAULT_SIGNATURE = {
  name: 'Simone Marie Golez',
  title: 'Social Media Content Creator',
}

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

// Only ever emit an absolute http(s) image src. A relative or `javascript:` value would
// either break in every mail client or be an injection vector in the HTML part.
function safeImageUrl(url: string): string {
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : ''
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export function signatureFields(src: SignatureSource): SignatureFields {
  const block = (src.content?.signature ?? null) as Record<string, unknown> | null

  // `handle` is blank on public_profile today, so fall back to the display name —
  // "@simxmargo" either way, without hardcoding it.
  const rawHandle = str(block?.username) || str(src.handle) || str(src.displayName)
  const username = rawHandle ? (rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`) : ''

  return {
    name: str(block?.name) || DEFAULT_SIGNATURE.name,
    title: str(block?.title) || DEFAULT_SIGNATURE.title,
    email: str(block?.email) || str(src.replyToEmail),
    username,
    // Each candidate is validated SEPARATELY rather than `override || fallback` then
    // validated once: a bad override is truthy, so the short-circuit form would consume
    // it, fail the protocol check, and leave the signature with no image at all.
    imageUrl: safeImageUrl(str(block?.imageUrl)) || safeImageUrl(str(src.ogImageUrl)),
  }
}

export function buildSignature(src: SignatureSource): Signature {
  const f = signatureFields(src)

  const text = [
    '--',
    f.name,
    f.title,
    f.email ? `Email: ${f.email}` : '',
    f.username ? `Username: ${f.username}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  // TWO-COLUMN: portrait left, details right.
  //
  // Table layout + fully inline styles is not nostalgia — Gmail strips <style> blocks
  // and Outlook renders through Word, which ignores flex/grid entirely. The `valign`
  // ATTRIBUTE sits beside the CSS because Outlook honours the attribute and ignores
  // `vertical-align` on a <td>.
  const IMG_PX = 110

  const imgCell = f.imageUrl
    ? `<td valign="top" width="${IMG_PX}" style="vertical-align:top;padding:0 16px 0 0;width:${IMG_PX}px">` +
      `<img src="${esc(f.imageUrl)}" alt="${esc(f.name)}" width="${IMG_PX}" height="${IMG_PX}" ` +
      `style="display:block;width:${IMG_PX}px;height:${IMG_PX}px;border:0;outline:none;` +
      `text-decoration:none;border-radius:4px;object-fit:cover">` +
      `</td>`
    : ''

  const row = (label: string, value: string, href?: string): string =>
    `<div style="padding-top:3px;font-size:13px;line-height:1.5;color:#1a1a1a">` +
    `<b>${esc(label)}:</b> ` +
    (href
      ? `<a href="${esc(href)}" style="color:#1155cc;text-decoration:underline">${esc(value)}</a>`
      : esc(value)) +
    `</div>`

  const details =
    `<div style="font-size:15px;line-height:1.4;font-weight:bold;color:#1a1a1a">${esc(f.name)}</div>` +
    `<div style="padding-top:2px;font-size:13px;line-height:1.5;color:#1a1a1a"><i>${esc(f.title)}</i></div>` +
    (f.email ? row('Email', f.email, `mailto:${f.email}`) : '') +
    (f.username ? row('Username', f.username) : '')

  // The divider spans whatever columns actually exist — a hardcoded colspan="2" would
  // leave a rule sticking out past the content when there's no image.
  const cols = imgCell ? 2 : 1

  const html =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
    `style="border-collapse:collapse;margin-top:22px;font-family:Arial,Helvetica,sans-serif">` +
    `<tr><td colspan="${cols}" style="border-top:1px solid #e4e4e4;font-size:0;line-height:0;height:16px">&nbsp;</td></tr>` +
    `<tr>${imgCell}<td valign="top" style="vertical-align:top;padding:0">${details}</td></tr>` +
    `</table>`

  return { html, text }
}
