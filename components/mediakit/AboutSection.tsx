import type { PublicProfile, PressLogo } from '@/lib/mediakit-types'
import { Reveal } from '@/components/mediakit/Reveal'
import { Section } from '@/components/mediakit/Section'

interface AboutSectionProps {
  profile: PublicProfile
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

function PressLogoItem({ logo }: { logo: PressLogo }) {
  const content = logo.logoUrl ? (
    <img
      src={logo.logoUrl}
      alt={logo.name}
      className="h-6 w-auto opacity-50 grayscale transition-opacity duration-200 hover:opacity-80"
    />
  ) : (
    <span className="text-sm font-medium text-ivory/60 transition-colors duration-200 hover:text-ivory/70">
      {logo.name}
    </span>
  )

  if (logo.url) {
    return (
      <a
        href={logo.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-[44px] items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-400"
        aria-label={`${logo.name} (opens in a new tab)`}
      >
        {content}
      </a>
    )
  }
  return <span className="inline-flex min-h-[44px] items-center">{content}</span>
}

export function AboutSection({ profile }: AboutSectionProps) {
  const paragraphs = profile.bioMd
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <Section id="about" eyebrow="About" title="The creator">
      <Reveal>
        <div className="grid gap-10 md:grid-cols-[1fr_1.4fr] md:items-start">
          {/* Portrait */}
          <div>
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={`Portrait of ${profile.displayName}`}
                className="aspect-[4/5] w-full rounded-2xl border border-white/10 object-cover"
              />
            ) : (
              <div
                className="flex aspect-[4/5] w-full items-center justify-center rounded-2xl border border-white/10 bg-ink-800"
                aria-hidden="true"
              >
                <span className="font-editorial text-6xl text-ivory/60">
                  {initials(profile.displayName)}
                </span>
              </div>
            )}
          </div>

          {/* Bio */}
          <div>
            <div className="max-w-[70ch] space-y-5">
              {paragraphs.map((para, i) => (
                <p key={i} className="leading-relaxed text-ivory/70">
                  {para}
                </p>
              ))}
            </div>

            {profile.pressLogos.length > 0 && (
              <div className="mt-10 border-t border-white/10 pt-6">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-ivory/60">
                  As seen in
                </p>
                <ul className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
                  {profile.pressLogos.map((logo, i) => (
                    <li key={`${logo.name}-${i}`}>
                      <PressLogoItem logo={logo} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </Reveal>
    </Section>
  )
}
