import type { PublicProfile, SocialStat } from '@/lib/mediakit-types'
import { DEFAULT_SITE_COPY } from '@/lib/mediakit-types'

interface MediaKitFooterProps {
  profile: PublicProfile
  socials: SocialStat[]
}

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  x: 'X',
  twitch: 'Twitch',
}

function platformName(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1)
}

// Render the footer headline, wrapping the first (case-insensitive) occurrence of the
// emphasis word in the accent <span className="amp">. Empty / not-found emphasis → the
// headline renders plain. Splitting at render (vs storing markup) keeps the stored copy
// injection-free and lets the accent track wherever the word moves in the sentence.
function footerHeadlineNodes(headline: string, emphasis: string) {
  if (!emphasis) return headline
  const idx = headline.toLowerCase().indexOf(emphasis.toLowerCase())
  if (idx === -1) return headline
  return (
    <>
      {headline.slice(0, idx)}
      <span className="amp">{headline.slice(idx, idx + emphasis.length)}</span>
      {headline.slice(idx + emphasis.length)}
    </>
  )
}

export function MediaKitFooter({ profile, socials }: MediaKitFooterProps) {
  const footMeta = [
    profile.displayName ? `@${profile.displayName.replace(/^@+/, '')}` : '',
    'Media kit 2026',
    profile.location,
  ]
    .filter(Boolean)
    .join(' · ')
  // From the profile's reply-to email (admin → Profile), design address as fallback.
  const contactEmail = profile.replyToEmail?.trim() || 'hello@simxmargo.com'

  // Editable footer headline (admin → Media kit profile → Footer). Falls back to the
  // shared default wording; an empty emphasis renders the headline with no accent.
  const footerHeadline = profile.content?.footerHeadline?.trim() || DEFAULT_SITE_COPY.footerHeadline
  const footerEmphasis = (profile.content?.footerEmphasis ?? DEFAULT_SITE_COPY.footerEmphasis).trim()

  return (
    <footer className="footer">
      <div className="wrap">
        <div className="foot-name display reveal">{footerHeadlineNodes(footerHeadline, footerEmphasis)}</div>
        <div className="foot-grid">
          <nav className="flex items-center flex-wrap gap-4" aria-label="Social links">
            {socials
              .filter((s) => s.profileUrl)
              .map((s) => (
                <a
                  key={s.platform}
                  className="flink"
                  href={s.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {platformName(s.platform)} ↗
                </a>
              ))}
            <a className="flink" href={`mailto:${contactEmail}`}>
              Email ↗
            </a>
          </nav>
          <div className="foot-meta">{footMeta}</div>
        </div>
      </div>
    </footer>
  )
}
