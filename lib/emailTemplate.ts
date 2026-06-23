import type { Contact, CreatorProfile } from './types'

export interface Draft {
  subject: string
  body: string
}

// Builds a personalized, compliance-minded cold-outreach draft for one brand.
// Short, plain-text, identifies the sender, relevant, with a one-line opt-out —
// all of which also help deliverability (see docs/BACKEND_DESIGN.md).
export function buildDraft(contact: Contact, profile: CreatorProfile): Draft {
  const subject = `Collab idea: ${contact.brand} × ${profile.name} (${profile.niche} creator)`

  // Signature carries the CAN-SPAM essentials: real identity + a physical
  // postal address. The opt-out line below is mandatory and non-removable.
  const signature = [
    `Thanks,`,
    profile.name,
    profile.realEmail,
    ...(profile.mailingAddress ? [profile.mailingAddress] : []),
  ]

  const body = [
    `Hi ${contact.brand} team,`,
    ``,
    `I'm ${profile.name}, a ${profile.niche} creator based in the Philippines ` +
      `(${profile.handle} · ${profile.followers} followers, ${profile.avgViews} avg views/post, ` +
      `${profile.engagement} engagement). My audience is mostly ${profile.audience}.`,
    ``,
    `I've been loving ${contact.brand} and think a collab would land really well with my ` +
      `audience — I can create a Reel + a few stories showing ${contact.brand} in real ` +
      `outfits, not just a flatlay.`,
    ``,
    `Would you be open to a quick chat about a paid collab, or gifting to start? ` +
      (profile.mediaKitUrl
        ? `My media kit is here: ${profile.mediaKitUrl}`
        : `Happy to send my media kit.`),
    ``,
    ...signature,
    ``,
    `Not the right person, or not interested? Reply "no thanks" and I won't follow up.`,
  ].join('\n')

  return { subject, body }
}
