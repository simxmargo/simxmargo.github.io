'use client'

import { useState } from 'react'
import type { RateCardItem } from '@/lib/mediakit-types'
import { RateCardSection } from './RateCardSection'
import { WorkWithMeForm } from './WorkWithMeForm'

// Client coordinator: clicking "Enquire" on a rate-card row preselects that
// deliverable in the contact form and smooth-scrolls to it. Kept as its own
// client island so the page can stay a Server Component.
export function RateAndContact({ rateCard }: { rateCard: RateCardItem[] }) {
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [nonce, setNonce] = useState(0) // changes every click so repeat enquiries re-apply

  return (
    <>
      <RateCardSection
        rateCard={rateCard}
        onEnquire={(deliverable) => {
          setSelected(deliverable)
          setNonce((n) => n + 1)
          document.getElementById('work-with-me')?.scrollIntoView({ behavior: 'smooth' })
        }}
      />
      <WorkWithMeForm rateCard={rateCard} preselectedDeliverable={selected} preselectNonce={nonce} />
    </>
  )
}
