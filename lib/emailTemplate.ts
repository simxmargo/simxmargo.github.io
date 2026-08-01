import type { Contact, CreatorProfile } from './types'

export interface Draft {
  subject: string
  body: string
}

// The outreach pitch, as EDITABLE DATA rather than hardcoded prose.
//
// DESIGN INTENT — this must not read as automated. An earlier version opened with a
// credentials dump ("— 4.8M followers, 358K avg views, 6.6% engagement") and closed
// with a bulk-mail opt-out line; both are shape-level tells that no human wrote it.
// The reach numbers aren't gone, they MOVED: the media-kit link carries them, so the
// opening can stay conversational without losing the strongest fact in the pitch.
//
// ONE BODY, NOT BLOCKS. An earlier version split the email into seven labelled fields.
// It made the structure explicit but turned writing a paragraph into a form-filling
// exercise, and the labels described the email to someone who already knew what they
// wanted to say. The conditional behaviour blocks existed for (drop the media-kit line
// when there's no URL) is now a general rule — see dropEmptyMergeLines below.
//
// The signature is NOT part of this body — it's appended at send time from live
// profile data (lib/emailSignature.ts), the same way Gmail appends yours.

export interface EmailTemplate {
  subject: string
  body: string
}

/** Tokens swapped at render time. Shown as one-click chips in the editor. */
export const MERGE_FIELDS: { token: string; label: string }[] = [
  { token: '{brand}', label: 'Brand name' },
  { token: '{name}', label: 'Your name' },
  { token: '{niche}', label: 'Your niche' },
  { token: '{location}', label: 'Your location' },
  { token: '{audience}', label: 'Your audience' },
  { token: '{mediaKitUrl}', label: 'Media kit URL' },
]

export const DEFAULT_TEMPLATE: EmailTemplate = {
  subject: 'Collab idea: {brand} × {name}',
  body: [
    'Hi {brand} team,',
    '',
    "I'm {name} — I make {niche} content, based in {location}.",
    '',
    "I've been following {brand} for a while and would genuinely love to work together. " +
      'What I had in mind is a Reel plus a few stories showing how {brand} actually fits ' +
      'into my day, rather than a static flatlay.',
    '',
    "Would you be open to a paid collab? Happy to start with gifting if that's easier on your end.",
    '',
    'My media kit has the numbers and some past work: {mediaKitUrl}',
    '',
    'Thanks for reading,',
    '{name}',
  ].join('\n'),
}

// "FASHION · BEAUTY · EDITING · TEMPLATES" → "fashion, beauty, editing and templates".
// The niche field is stored as a display string for the media-kit header (caps +
// middots); dropped raw into a sentence it reads like shouting.
function nicheInProse(niche: string): string {
  const parts = niche
    .split('·')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  if (parts.length === 0) return 'content'
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// Country names that take the definite article — "based in THE Philippines".
// Only a whole-string match qualifies: "Manila, Philippines" is already correct
// without one, and prefixing there would give "based in the Manila, Philippines".
const ARTICLE_COUNTRIES = new Set([
  'philippines',
  'netherlands',
  'united states',
  'united states of america',
  'usa',
  'united kingdom',
  'uk',
  'united arab emirates',
  'uae',
  'czech republic',
  'dominican republic',
  'bahamas',
  'maldives',
  'gambia',
])

function withArticle(location: string): string {
  const t = location.trim()
  if (!t || /^the\s/i.test(t)) return t
  return ARTICLE_COUNTRIES.has(t.toLowerCase()) ? `the ${t}` : t
}

/** Values each {token} resolves to. Exported so the editor preview uses the same map. */
export function mergeValues(contact: Contact, profile: CreatorProfile): Record<string, string> {
  return {
    '{brand}': contact.brand,
    '{name}': profile.name,
    '{niche}': nicheInProse(profile.niche),
    '{location}': withArticle(profile.location),
    '{audience}': profile.audience,
    '{mediaKitUrl}': profile.mediaKitUrl,
  }
}

// A line whose merge field resolves to nothing is DROPPED WHOLE, rather than left as a
// dangling stub. With no media-kit URL set, "My media kit has the numbers and some past
// work: " would otherwise go out with a trailing colon — worse than saying nothing.
// This is what the old per-block conditional did, generalised to any token.
function dropEmptyMergeLines(text: string, values: Record<string, string>): string {
  return text
    .split('\n')
    .filter((line) => {
      const tokens = line.match(/\{[a-zA-Z]+\}/g)
      if (!tokens) return true
      // Only a line that is MORE than its token is worth dropping — a line consisting
      // solely of "{name}" (the sign-off) is legitimately empty-able and handled by
      // the trim below instead.
      return !tokens.some((t) => t in values && values[t].trim() === '')
    })
    .join('\n')
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{[a-zA-Z]+\}/g, (token) => values[token] ?? '')
}

/**
 * A stored template, defaulted per-field so a partial object can't blank the email.
 *
 * Also migrates the older seven-block shape ({greeting, intro, pitch, ask, mediaKit,
 * signOff}) by joining it back into one body — anything already saved in that format
 * keeps its wording instead of silently reverting to the default.
 */
export function resolveTemplate(stored: unknown): EmailTemplate {
  const s = (stored ?? {}) as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')

  const subject = str(s.subject) || DEFAULT_TEMPLATE.subject

  if (typeof s.body === 'string' && s.body.trim()) return { subject, body: s.body }

  const legacy = ['greeting', 'intro', 'pitch', 'ask', 'mediaKit', 'signOff']
    .map((k) => str(s[k]).trim())
    .filter(Boolean)
  if (legacy.length > 0) return { subject, body: legacy.join('\n\n') }

  return { subject, body: DEFAULT_TEMPLATE.body }
}

export function buildDraft(
  contact: Contact,
  profile: CreatorProfile,
  template: EmailTemplate = DEFAULT_TEMPLATE,
): Draft {
  const values = mergeValues(contact, profile)

  const body = fill(dropEmptyMergeLines(template.body, values), values)
    // Collapse the gap left where a dropped line used to be, so removing the media-kit
    // line doesn't leave a double blank in the middle of the email.
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { subject: fill(template.subject, values).trim(), body }
}
