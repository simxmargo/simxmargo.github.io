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

// [my media kit](https://…) — a link whose VISIBLE text is the label, not the URL.
// Exists so the pitch can say "my media kit" instead of exposing a raw github.io
// address mid-sentence; the URL still travels in the href (and in the plain-text
// part, where there is nowhere to hide it). Label and URL both forbid newlines,
// and the URL must be absolute http(s) — a template typo degrades to literal text
// rather than a broken tag.
const MD_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s()<>]+)\)/g

/** The markers removed, words kept — for the plain-text MIME part. */
export function stripMarks(text: string): string {
  return text
    .replace(MD_LINK, '$1 ($2)')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
}

// Escape, then mark up, then linkify: any other order lets a URL in the body inject
// markup through its own href.
export function textToHtml(text: string): string {
  const linkify = (s: string): string =>
    s.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#1a1a1a">${u}</a>`)

  // Labeled links are swapped out for placeholders BEFORE linkify so the href's own
  // URL can't be linkified a second time, then restored after. The delimiter is NUL
  // (impossible to type in the editor) so a placeholder can never collide with real
  // body text. Input is already escaped, so label/URL carry entities, never raw markup.
  const renderLinks = (s: string): { out: string; restore: (h: string) => string } => {
    const anchors: string[] = []
    const out = s.replace(MD_LINK, (_, label: string, url: string) => {
      anchors.push(`<a href="${url}" style="color:#1a1a1a">${label}</a>`)
      return `\u0000${anchors.length - 1}\u0000`
    })
    return { out, restore: (h) => h.replace(/\u0000(\d+)\u0000/g, (_, i) => anchors[Number(i)]) }
  }

  const paragraphs = esc(text)
    .split(/\n{2,}/)
    .map((block) => {
      const { out, restore } = renderLinks(block.trim())
      return restore(linkify(inlineMarks(out))).replace(/\n/g, '<br>')
    })
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#1a1a1a">${p}</p>`)
    .join('')

  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">` +
    paragraphs +
    `</div>`
  )
}
