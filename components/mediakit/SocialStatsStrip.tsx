'use client'

import type { SocialStat } from '@/lib/mediakit-types'
import { formatCount } from '@/lib/mediakit-types'
import { useCountUp } from '@/components/mediakit/useCountUp'
import { BrandGlyph } from '@/components/icons/BrandGlyph'

interface SocialStatsStripProps {
  socials: SocialStat[]
}

function platformLabel(platform: string): string {
  if (platform === 'tiktok') return 'TikTok'
  if (platform === 'instagram') return 'Instagram'
  if (platform === 'facebook') return 'Facebook'
  return platform.charAt(0).toUpperCase() + platform.slice(1)
}

function platformHandle(social: SocialStat): string {
  if (social.handle.startsWith('@')) return social.handle
  if (social.platform === 'facebook') return social.handle
  return '@' + social.handle
}

// The admin-entered profile URL wins; otherwise derive one from the bare handle so
// every card links out even before a profile_url is filled in.
function profileHref(social: SocialStat): string {
  if (social.profileUrl) return social.profileUrl
  const handle = social.handle.replace(/^@/, '')
  if (!handle) return ''
  if (social.platform === 'tiktok') return `https://www.tiktok.com/@${handle}`
  if (social.platform === 'instagram') return `https://www.instagram.com/${handle}`
  if (social.platform === 'facebook') return `https://www.facebook.com/${handle}`
  return ''
}

// Each card owns its own count-up ref so the number animates independently on scroll-in.
// The WHOLE card is the link target (anchor when a profile URL exists, div fallback).
function ReachCard({ social }: { social: SocialStat }) {
  const { value, ref } = useCountUp(social.followers)
  const href = profileHref(social)
  const body = (
    <>
      <div className="picon">
        <BrandGlyph platform={social.platform} size={38} colored={false} />
      </div>
      <div className="pnum display">
        <span ref={ref}>{formatCount(value)}</span>
      </div>
      <div className="pmeta">
        <span className="plat">{platformLabel(social.platform)}</span>
        <span className="phandle">{platformHandle(social)}</span>
      </div>
    </>
  )
  if (!href) return <div className="pcard reveal">{body}</div>
  return (
    <a
      className="pcard pcard-link reveal"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`${platformLabel(social.platform)} ${platformHandle(social)}`}
    >
      {body}
    </a>
  )
}

export function SocialStatsStrip({ socials }: SocialStatsStripProps) {
  return (
    <section id="reach" className="reach">
      <div className="wrap">
        <div className="reach-grid">
          {socials.map((social) => (
            <ReachCard key={social.platform} social={social} />
          ))}
        </div>
      </div>
    </section>
  )
}
