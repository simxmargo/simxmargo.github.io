import type { PublicProfile } from '@/lib/mediakit-types'
import { initials } from '@/components/mediakit/Wordmark'

interface AboutSectionProps {
  profile: PublicProfile
}

export function AboutSection({ profile }: AboutSectionProps) {
  const bio = profile.bioMd || ''
  const firstLetter = bio.charAt(0)
  const restOfBio = bio.slice(1)

  const chips = (profile.niche || '')
    .split('·')
    .map((c) => c.trim())
    .filter(Boolean)

  const img = profile.avatarUrl || profile.heroImageUrl

  return (
    <section id="about" className="sec block">
      <div className="wrap">
        <div className="about-grid">
          <div className="about-portrait reveal">
            {img ? (
              <div className="portrait">
                <img
                  src={img}
                  alt={`Portrait of ${profile.displayName}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </div>
            ) : (
              <div
                className="portrait ph"
                role="img"
                aria-label={`Portrait of ${profile.displayName}`}
              >
                <span className="ph-mono display" aria-hidden="true">
                  {initials(profile.displayName)}
                </span>
                <span className="ph-label mono">PORTRAIT — editorial</span>
              </div>
            )}
          </div>

          <div className="about-copy reveal">
            <div className="eyebrow">03 — About</div>
            <h2 className="display h2">{profile.displayName}</h2>
            {bio && (
              <p className="about-text">
                <span className="dropcap display">{firstLetter}</span>
                {restOfBio}
              </p>
            )}
            {chips.length > 0 && (
              <div className="about-tags flex items-center flex-wrap gap-2">
                {chips.map((c) => (
                  <span key={c} className="chip">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
