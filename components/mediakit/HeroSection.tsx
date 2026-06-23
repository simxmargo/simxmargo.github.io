'use client'

import { MapPin } from 'lucide-react'
import type { PublicProfile, SocialStat } from '@/lib/mediakit-types'
import { formatCount, totalReach } from '@/lib/mediakit-types'
import { Reveal } from '@/components/mediakit/Reveal'
import { useCountUp } from '@/components/mediakit/useCountUp'

interface HeroSectionProps {
  profile: PublicProfile
  socials: SocialStat[]
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

interface ReachCounterProps {
  target: number
}

function ReachCounter({ target }: ReachCounterProps) {
  const { value, ref } = useCountUp(target)
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-[0.2em] text-ivory/60">
        Total reach
      </span>
      <span ref={ref} className="font-editorial text-4xl tracking-tight text-ivory md:text-5xl">
        {formatCount(value)}
      </span>
    </div>
  )
}

export function HeroSection({ profile, socials }: HeroSectionProps) {
  const reach = totalReach(profile, socials)

  return (
    <section className="mx-auto flex min-h-[88vh] max-w-5xl flex-col justify-center bg-ink-950 px-6 text-center">
      <Reveal delay={0}>
        {profile.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt={`Portrait of ${profile.displayName}`}
            className="mx-auto h-24 w-24 rounded-full object-cover ring-1 ring-white/10"
          />
        ) : (
          <div
            aria-hidden="true"
            className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-ink-800 font-editorial text-2xl text-blush-300"
          >
            {initials(profile.displayName)}
          </div>
        )}
      </Reveal>

      <Reveal delay={120}>
        <h1 className="mt-8 font-editorial text-5xl tracking-tight text-ivory md:text-7xl">
          {profile.displayName}
        </h1>
      </Reveal>

      <Reveal delay={200}>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-ivory/60">
          {profile.location && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {profile.location}
            </span>
          )}
          {profile.niche && <span>{profile.niche}</span>}
        </div>
      </Reveal>

      <Reveal delay={280}>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-ivory/70 md:text-xl">
          {profile.tagline}
        </p>
      </Reveal>

      <Reveal delay={360}>
        <div className="mt-12">
          <ReachCounter target={reach} />
        </div>
      </Reveal>

      <Reveal delay={440}>
        <div className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="#work-with-me"
            className="rounded-full bg-ivory px-6 py-3 text-sm font-medium text-ink-950 transition-colors hover:bg-blush-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-400"
          >
            Work with me
          </a>
          <a
            href="#portfolio"
            className="rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-ivory transition-colors hover:border-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-400"
          >
            See the work
          </a>
        </div>
      </Reveal>
    </section>
  )
}
