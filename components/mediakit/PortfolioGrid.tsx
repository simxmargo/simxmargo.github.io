'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { PortfolioBrand } from '@/lib/mediakit-types'
import { Section } from '@/components/mediakit/Section'

interface PortfolioGridProps {
  brands: PortfolioBrand[]
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

interface CategoryFilterProps {
  categories: string[]
  active: string
  onChange: (cat: string) => void
}

function CategoryFilter({ categories, active, onChange }: CategoryFilterProps) {
  return (
    <div className="mb-8 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
      {['All', ...categories].map((cat) => {
        const selected = active === cat
        return (
          <button
            key={cat}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(cat)}
            className={`min-h-[44px] rounded-full px-5 text-sm font-medium capitalize transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-400 ${
              selected
                ? 'bg-ivory text-ink-950'
                : 'border border-white/20 text-ivory/70 hover:border-white/40'
            }`}
          >
            {cat}
          </button>
        )
      })}
    </div>
  )
}

interface BrandCardProps {
  brand: PortfolioBrand
  onSelect: (brand: PortfolioBrand) => void
}

function BrandCard({ brand, onSelect }: BrandCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(brand)}
      aria-label={`View case study for ${brand.brand}`}
      className="group relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-ink-900 p-5 transition-colors duration-200 hover:border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-400"
    >
      {brand.featured && (
        <span className="absolute left-3 top-3 text-[10px] uppercase tracking-wide text-blush-400">
          Featured
        </span>
      )}
      {brand.logoUrl ? (
        <img
          src={brand.logoUrl}
          alt={`${brand.brand} logo`}
          className="h-14 w-auto max-w-[80%] object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-800 font-editorial text-lg text-blush-300"
        >
          {initials(brand.brand)}
        </span>
      )}
      <span className="text-center text-sm text-ivory">{brand.brand}</span>

      <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-ink-950/85 p-4 text-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <span className="font-editorial text-sm text-ivory">{brand.campaignTitle}</span>
        {brand.metrics?.reach != null && (
          <span className="text-xs uppercase tracking-[0.15em] text-blush-400">
            {brand.metrics.reach} reach
          </span>
        )}
      </span>
    </button>
  )
}

interface MetricTileProps {
  label: string
  value: string | undefined
}

function MetricTile({ label, value }: MetricTileProps) {
  if (!value) return null
  return (
    <div className="rounded-xl border border-white/10 bg-ink-850 p-4">
      <div className="font-editorial text-xl text-ivory">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.15em] text-ivory/60">{label}</div>
    </div>
  )
}

interface BrandCaseStudyProps {
  brand: PortfolioBrand
  onClose: () => void
}

function BrandCaseStudy({ brand, onClose }: BrandCaseStudyProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = `cs-title-${brand.id}`

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden' // lock background scroll while open

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      // Trap focus within the dialog (aria-modal promises containment).
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      )
      if (!nodes || nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.() // restore focus to the card that opened it
    }
  }, [onClose])

  const m = brand.metrics
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-ink-950/80" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-ink-900 p-6 md:p-8"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full text-ivory/70 transition-colors duration-200 hover:text-ivory focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-400"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <p className="text-xs font-medium uppercase tracking-[0.2em] text-blush-400">
          {brand.campaignTitle}
        </p>
        <h2 id={titleId} className="mt-2 font-editorial text-2xl text-ivory">
          {brand.brand}
        </h2>
        {brand.blurb && <p className="mt-4 text-ivory/70">{brand.blurb}</p>}

        {(m?.reach || m?.views || m?.engagement) && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MetricTile label="Reach" value={m?.reach} />
            <MetricTile label="Views" value={m?.views} />
            <MetricTile label="Engagement" value={m?.engagement} />
          </div>
        )}

        {m?.deliverables && m.deliverables.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {m.deliverables.map((d, i) => (
              <span
                key={`${d}-${i}`}
                className="rounded-full border border-white/15 px-3 py-1 text-xs text-ivory/70"
              >
                {d}
              </span>
            ))}
          </div>
        )}

        {brand.media && brand.media.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {brand.media.map((item, i) => (
              <img
                key={`${item.url}-${i}`}
                src={item.thumbUrl ?? item.url}
                alt={`${brand.brand} campaign visual ${i + 1}`}
                className="aspect-square w-full rounded-xl border border-white/10 object-cover"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function PortfolioGrid({ brands }: PortfolioGridProps) {
  const [active, setActive] = useState('All')
  const [selected, setSelected] = useState<PortfolioBrand | null>(null)

  const categories = useMemo(
    () => Array.from(new Set(brands.map((b) => b.category).filter(Boolean))),
    [brands],
  )

  const visible = useMemo(() => {
    const filtered = active === 'All' ? brands : brands.filter((b) => b.category === active)
    return [...filtered].sort((a, b) => Number(b.featured) - Number(a.featured))
  }, [brands, active])

  return (
    <Section id="portfolio" eyebrow="Selected work" title="Brand partners">
      <CategoryFilter categories={categories} active={active} onChange={setActive} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {visible.map((brand) => (
          <BrandCard key={brand.id ?? brand.brand} brand={brand} onSelect={setSelected} />
        ))}
      </div>
      {selected && <BrandCaseStudy brand={selected} onClose={() => setSelected(null)} />}
    </Section>
  )
}
