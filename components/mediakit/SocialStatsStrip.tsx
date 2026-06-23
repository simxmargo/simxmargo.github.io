'use client'

import { Instagram, Facebook, TrendingUp } from 'lucide-react'
import type { SocialStat } from '@/lib/mediakit-types'
import { formatCount } from '@/lib/mediakit-types'
import { useCountUp } from '@/components/mediakit/useCountUp'
import { Section } from '@/components/mediakit/Section'

interface SocialStatsStripProps {
  socials: SocialStat[]
}

interface PlatformCardProps {
  social: SocialStat
}

interface GrowthSparklineProps {
  history: SocialStat['history']
}

function TikTokGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M14 3v9.6a3.4 3.4 0 1 1-2.4-3.25"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 3c.4 2.3 1.9 3.7 4 3.9"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function platformIcon(platform: string) {
  const cls = 'text-ivory/70'
  if (platform === 'instagram') return <Instagram size={18} className={cls} aria-hidden="true" />
  if (platform === 'facebook') return <Facebook size={18} className={cls} aria-hidden="true" />
  if (platform === 'tiktok') return <TikTokGlyph className={cls} />
  return <span className="h-[18px] w-[18px] rounded-full bg-ivory/20" aria-hidden="true" />
}

function GrowthSparkline({ history }: GrowthSparklineProps) {
  const W = 80
  const H = 24
  const pad = 2
  const pts = history.map((h) => h.followers)
  if (pts.length < 2) return null
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const span = max - min || 1
  const step = (W - pad * 2) / (pts.length - 1)
  const coords = pts.map((v, i) => {
    const x = pad + i * step
    const y = H - pad - ((v - min) / span) * (H - pad * 2)
    return [x, y] as const
  })
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${pad},${H} ${line} ${(W - pad).toFixed(1)},${H}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="overflow-visible" aria-hidden="true">
      <polygon points={area} className="fill-blush-400/10" />
      <polyline points={line} fill="none" className="stroke-blush-400" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PlatformCard({ social }: PlatformCardProps) {
  const { value, ref } = useCountUp(social.followers)
  return (
    <a
      href={social.profileUrl}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-4 rounded-2xl border border-white/10 bg-ink-900 p-5 transition-colors hover:border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-400"
    >
      <div className="flex items-center gap-2">
        {platformIcon(social.platform)}
        <span className="text-sm text-ivory/70">{social.handle}</span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <span ref={ref} className="font-editorial text-3xl text-ivory">
          {formatCount(value)}
        </span>
        <GrowthSparkline history={social.history} />
      </div>
      <div className="flex items-center gap-3 text-xs">
        {social.growth30d != null && (
          <span className="inline-flex items-center gap-1 text-blush-400">
            <TrendingUp size={12} aria-hidden="true" />
            {social.growth30d > 0 ? '+' : ''}
            {social.growth30d}%
          </span>
        )}
        {social.engagementRate != null && (
          <span className="text-ivory/60">{social.engagementRate}% eng.</span>
        )}
      </div>
    </a>
  )
}

export function SocialStatsStrip({ socials }: SocialStatsStripProps) {
  return (
    <Section id="reach" eyebrow="Audience" title="Reach across platforms">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {socials.map((social) => (
          <PlatformCard key={social.platform} social={social} />
        ))}
      </div>
    </Section>
  )
}
