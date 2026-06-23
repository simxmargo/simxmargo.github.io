import { Instagram, Facebook, Globe } from 'lucide-react'
import type { PublicProfile, SocialStat } from '@/lib/mediakit-types'

interface MediaKitFooterProps {
  profile: PublicProfile
  socials: SocialStat[]
}

interface SocialIconLinkProps {
  social: SocialStat
  displayName: string
}

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  x: 'X',
  twitch: 'Twitch',
}

function TikTokGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M16.6 5.82a4.28 4.28 0 0 1-1.05-2.82h-3.1v12.6a2.52 2.52 0 1 1-2.52-2.52c.26 0 .51.04.75.11v-3.16a5.66 5.66 0 0 0-.75-.05A5.62 5.62 0 1 0 15.55 15.7V9.3a7.34 7.34 0 0 0 4.3 1.38V7.55a4.28 4.28 0 0 1-3.25-1.73Z" />
    </svg>
  )
}

function SocialIcon({ platform }: { platform: string }) {
  if (platform === 'instagram') return <Instagram size={20} aria-hidden="true" />
  if (platform === 'facebook') return <Facebook size={20} aria-hidden="true" />
  if (platform === 'tiktok') return <TikTokGlyph />
  return <Globe size={20} aria-hidden="true" /> // youtube / x / twitch / other
}

function SocialIconLink({ social, displayName }: SocialIconLinkProps) {
  const label = PLATFORM_LABEL[social.platform] ?? social.platform
  return (
    <a
      href={social.profileUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${displayName} on ${label} (opens in a new tab)`}
      className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ivory/70 transition-colors duration-200 hover:text-blush-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-400"
    >
      <SocialIcon platform={social.platform} />
    </a>
  )
}

export function MediaKitFooter({ profile, socials }: MediaKitFooterProps) {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-white/10 bg-ink-950">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-editorial text-2xl text-ivory">{profile.displayName}</p>
            <p className="text-sm text-ivory/60">{profile.tagline ?? 'Media kit'}</p>
          </div>
          {socials.length > 0 && (
            <nav aria-label="Social links" className="flex items-center gap-1">
              {socials.map((social) => (
                <SocialIconLink key={social.platform} social={social} displayName={profile.displayName} />
              ))}
            </nav>
          )}
        </div>
        <p className="text-xs text-ivory/60">
          &copy; {year} {profile.displayName} &middot; Media kit
        </p>
      </div>
    </footer>
  )
}
