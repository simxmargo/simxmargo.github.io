import type { PublicProfile, SocialStat } from '@/lib/mediakit-types'

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

export function MediaKitFooter({ profile, socials }: MediaKitFooterProps) {
  const footMeta = [profile.displayName, 'Media kit 2026', profile.location]
    .filter(Boolean)
    .join(' · ')
  // From the profile's reply-to email (admin → Profile), design address as fallback.
  const contactEmail = profile.replyToEmail?.trim() || 'hello@simxmargo.com'

  return (
    <footer className="footer">
      <div className="wrap">
        <div className="foot-name display reveal">
          Let&apos;s make
          <br />
          something <span className="amp">real</span>.
        </div>
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
