// Match a video CAPTION to the brands we manage. Pure + framework-free so it's
// trivially testable and runs the same on client (the review UI pre-selects matches)
// and server. Best-effort by design: not every post names its brand, so unmatched
// videos fall through for the admin to assign by hand.

export interface MatchBrand {
  id: string
  brand: string
  website?: string
}

// Normalize to a comparable token: lowercase, strip everything non-alphanumeric (so
// "Fashion Nova", "fashion nova", "@fashionnova", "#FashionNova" all collapse to the
// same "fashionnova"). Emoji/punctuation/spacing in captions don't matter.
const norm = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

// The aliases that, if present in a caption, mark a video as this brand's: the brand
// name and the root of its website domain. Aliases shorter than 3 chars are dropped —
// they'd match noise (e.g. a 2-letter brand inside unrelated words).
export function brandAliases(b: MatchBrand): string[] {
  const set = new Set<string>()
  const n = norm(b.brand)
  if (n) set.add(n)
  if (b.website) {
    try {
      const host = new URL(b.website.startsWith('http') ? b.website : `https://${b.website}`).hostname.replace(/^www\./, '')
      const root = host.split('.')[0]
      if (root) set.add(norm(root))
    } catch {
      /* not a parseable URL — skip the domain alias */
    }
  }
  return [...set].filter((a) => a.length >= 3)
}

// Split a caption into normalized word tokens (lowercase, every run of non-alphanumeric
// → a boundary), so we can match on WHOLE WORDS instead of raw substrings.
function captionTokens(caption: string): string[] {
  return (caption || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

// The brand ids whose aliases appear in the caption, ordered MOST-SPECIFIC FIRST
// (longest matching alias). An alias matches as a whole token — so "gap" hits "@gap" /
// "the gap" but NOT "gaping" — while aliases ≥5 chars also match the de-spaced caption
// so a joined or spelled-out brand name ("fashionnova" / "fashion nova") still hits.
// Best-effort: the review UI lets the admin override every assignment, so a wrong
// pre-select costs a dropdown change, not data.
export function matchCaption(caption: string, brands: MatchBrand[]): string[] {
  const tokens = captionTokens(caption)
  if (tokens.length === 0) return []
  const tokenSet = new Set(tokens)
  const joined = tokens.join('')
  const scored: { id: string; len: number }[] = []
  for (const b of brands) {
    let best = 0
    for (const a of brandAliases(b)) {
      if (tokenSet.has(a) || (a.length >= 5 && joined.includes(a))) best = Math.max(best, a.length)
    }
    if (best > 0) scored.push({ id: b.id, len: best })
  }
  return scored.sort((x, y) => y.len - x.len).map((s) => s.id)
}
