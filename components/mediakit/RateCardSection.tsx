'use client'

import type { RateCardItem } from '@/lib/mediakit-types'
import { Reveal } from '@/components/mediakit/Reveal'
import { Section } from '@/components/mediakit/Section'

interface RateCardSectionProps {
  rateCard: RateCardItem[]
  onEnquire?: (deliverable: string) => void
}

interface RateCardEntryProps {
  item: RateCardItem
  onEnquire?: (deliverable: string) => void
}

function RateCard({ item, onEnquire }: RateCardEntryProps) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-ink-900 p-6">
      <h3 className="font-medium text-ivory">{item.deliverable}</h3>
      <p className="font-editorial text-2xl text-ivory">{item.price}</p>
      {item.note ? <p className="text-sm text-ivory/60">{item.note}</p> : null}
      <button
        type="button"
        onClick={() => onEnquire?.(item.deliverable)}
        aria-label={`Enquire about ${item.deliverable}`}
        className="mt-auto inline-flex min-h-[44px] items-center justify-center rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-ivory transition-colors hover:border-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-400"
      >
        Enquire
      </button>
    </div>
  )
}

export function RateCardSection({ rateCard, onEnquire }: RateCardSectionProps) {
  return (
    <Section id="rates" eyebrow="Work together" title="Rates &amp; packages">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {rateCard.map((item, i) => (
          <Reveal key={item.deliverable} delay={i * 80}>
            <RateCard item={item} onEnquire={onEnquire} />
          </Reveal>
        ))}
      </div>
      <p className="mt-6 text-sm text-ivory/60">
        Rates are starting points — happy to tailor a package.
      </p>
    </Section>
  )
}
