// Plain-text pitch → the two MIME parts. ONE implementation, shared by the Settings
// preview (browser) and `sendPitch` (Deno) — see supabase/functions/_shared/sendPitch.ts.
//
// The formatting is markdown-ish on purpose: **bold** and *italic* survive the trip
// through the send queue as plain text, become <b>/<i> in the HTML part, and are
// STRIPPED from the plain-text part — so a text-only mail client shows "paid collab",
// never "**paid collab**".
//
// Dependency-free (no framework, no Node/Deno builtins) so the same file runs in both.

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

// Applied AFTER escaping, so a literal "<b>" typed into the editor stays literal text
// and only our own markers become tags. **bold** is matched first — otherwise the
// single-asterisk rule would claim the inner pair of a `**` run.
export function inlineMarks(s: string): string {
  return s
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>')
}

/** The markers removed, words kept — for the plain-text MIME part. */
export function stripMarks(text: string): string {
  return text.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
}

// Escape, then mark up, then linkify: any other order lets a URL in the body inject
// markup through its own href.
export function textToHtml(text: string): string {
  const linkify = (s: string): string =>
    s.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#1a1a1a">${u}</a>`)

  const paragraphs = esc(text)
    .split(/\n{2,}/)
    .map((block) => linkify(inlineMarks(block.trim())).replace(/\n/g, '<br>'))
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#1a1a1a">${p}</p>`)
    .join('')

  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">` +
    paragraphs +
    `</div>`
  )
}
