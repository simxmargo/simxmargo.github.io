'use client'

import type { PublicProfile, SocialStat } from '@/lib/mediakit-types'
import { formatCount, totalReach, DEFAULT_SITE_COPY } from '@/lib/mediakit-types'
import { Wordmark } from '@/components/mediakit/Wordmark'
import { useCountUp } from '@/components/mediakit/useCountUp'

interface HeroSectionProps {
  profile: PublicProfile
  socials: SocialStat[]
}

export function HeroSection({ profile, socials }: HeroSectionProps) {
  const { value, ref } = useCountUp(totalReach(profile, socials))
  // Editable CTA labels (admin → Content), each falling back to the shared default.
  const ctaPrimary = profile.content?.heroCtaPrimary?.trim() || DEFAULT_SITE_COPY.heroCtaPrimary
  const ctaSecondary = profile.content?.heroCtaSecondary?.trim() || DEFAULT_SITE_COPY.heroCtaSecondary

  // The avatar/portrait IS the hero image (a separate hero field was redundant).
  const photo = profile.avatarUrl

  // Split ONLY on the bullet so multi-word labels survive intact — e.g. "Manila, PH"
  // keeps its comma and "Fashion & Styling" keeps its ampersand (matches the design's
  // "Manila, PH · Fashion · Beauty · Lifestyle" spacing).
  const nicheTokens = profile.niche
    .split('·')
    .map((t) => t.trim())
    .filter(Boolean)
  const tokens = [profile.location, ...nicheTokens].filter(Boolean)

  return (
    <section id="top" className="hero">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="hero-photo" src={photo} alt={profile.displayName} />
      ) : null}
      <div className="hero-scrim" />
      <div className="hero-vig" />

      <div className="hero-content wrap">
        <div className="hero-meta label reveal">
          {tokens.map((token, i) => (
            <span key={i}>
              {i > 0 ? <span className="dot">·</span> : null}
              {token}
            </span>
          ))}
        </div>

        <h1 className="display name reveal">
          <Wordmark name={profile.displayName} />
        </h1>

        <div className="hero-row">
          <div className="reach-big reveal">
            <span className="reach-num display">
              <span ref={ref}>{formatCount(value)}</span>
            </span>
            <span className="label">total reach</span>
          </div>
          <div className="cta-row reveal">
            <a href="#contact" className="btn btn-primary magnetic">
              {ctaPrimary}
            </a>
            <a href="#partners" className="btn btn-ghost magnetic">
              {ctaSecondary}
            </a>
          </div>
        </div>
      </div>

      <div className="scroll-cue reveal">
        <span className="label">Scroll</span>
        <span className="ln" />
      </div>
    </section>
  )
}
