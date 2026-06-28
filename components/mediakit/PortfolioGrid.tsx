'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PortfolioBrand, SocialStat } from '@/lib/mediakit-types'
import { buildBrandDetail, type CategoryKey } from '@/lib/mediakit/brandDetail'

interface PortfolioGridProps {
  brands: PortfolioBrand[]
  socials?: SocialStat[]
}

// The brand modal's "no top content" CTA. Prefer a real TikTok, then Instagram
// profile (from the creator's social data); fall back to the brand's own site.
// Returns null only when nothing is linkable → a non-link message is shown instead.
interface Promo {
  href: string
  platform: 'tiktok' | 'instagram' | 'web'
  label: string
  sub: string
}

function pickPromo(socials: SocialStat[], brand: PortfolioBrand): Promo | null {
  const find = (p: SocialStat['platform']) => socials.find((s) => s.platform === p && s.profileUrl)
  const tk = find('tiktok')
  if (tk) return { href: tk.profileUrl, platform: 'tiktok', label: 'Watch the latest on TikTok', sub: tk.handle ? `More from ${tk.handle}` : 'See the newest clips' }
  const ig = find('instagram')
  if (ig) return { href: ig.profileUrl, platform: 'instagram', label: 'Watch the latest on Instagram', sub: ig.handle ? `More from ${ig.handle}` : 'See the newest posts' }
  if (brand.website) return { href: brand.website, platform: 'web', label: 'Visit the brand', sub: 'Explore the partner site' }
  return null
}

function webIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx={12} cy={12} r={9} />
      <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
    </svg>
  )
}

function fashionIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 7v6l9 4 9-4V7" />
    </svg>
  )
}

function beautyIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M5 8h14l-1 12H6L5 8z" />
      <path d="M8.5 8a3.5 3.5 0 0 1 7 0" />
    </svg>
  )
}

function appIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x={6} y={2.5} width={12} height={19} rx={2.5} />
      <line x1={11} y1={18} x2={13} y2={18} />
    </svg>
  )
}

function mediaIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <polygon points="10,8 16,12 10,16" />
      <rect x={3} y={5} width={18} height={14} rx={2.5} />
    </svg>
  )
}

function tiktokIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.6 3c.3 2.2 1.7 3.7 3.9 3.9v2.4c-1.4 0-2.7-.4-3.9-1.2v6.7c0 3.6-2.9 6.2-6.3 6.2S4 18.4 4 14.8s3.1-6.2 6.7-5.9v2.6c-.3-.1-.7-.2-1-.2-1.9 0-3.4 1.5-3.4 3.5s1.5 3.5 3.4 3.5 3.4-1.5 3.4-3.5V3h3.5z" />
    </svg>
  )
}

function instagramIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x={3} y={3} width={18} height={18} rx={5.2} />
      <circle cx={12} cy={12} r={4} />
      <circle cx={17.4} cy={6.6} r={1.2} fill="currentColor" stroke="none" />
    </svg>
  )
}

const CAT_ICON: Record<CategoryKey, () => React.JSX.Element> = {
  fashion: fashionIcon,
  beauty: beautyIcon,
  app: appIcon,
  media: mediaIcon,
}

function catKey(category: string): CategoryKey {
  const c = (category || '').toLowerCase()
  if (c.includes('beaut')) return 'beauty'
  if (c.includes('app')) return 'app'
  if (c.includes('media')) return 'media'
  return 'fashion'
}

function catIcon(category: string) {
  return CAT_ICON[catKey(category)]()
}

const CLOSE_MS = 240

export function PortfolioGrid({ brands, socials = [] }: PortfolioGridProps) {
  // Split brands across the TWO marquee rows with NO cross-row repetition. An
  // explicit rowIndex (assigned in admin) wins; otherwise auto-split the list in half.
  // (Each row still renders its own subset twice — that duplication is the seamless
  // loop, and the second copy is aria-hidden.)
  const hasExplicitRows = brands.some((b) => b.rowIndex === 1 || b.rowIndex === 2)
  const mid = Math.ceil(brands.length / 2)
  const rowA = hasExplicitRows ? brands.filter((b) => b.rowIndex !== 2) : brands.slice(0, mid)
  const rowB = hasExplicitRows ? brands.filter((b) => b.rowIndex === 2) : brands.slice(mid)

  // Modal state: which brand is open + a brief `closing` phase that plays the exit
  // animation before unmount (mirrors the design's closeBrand timer).
  const [active, setActive] = useState<PortfolioBrand | null>(null)
  const [closing, setClosing] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closingRef = useRef(false)

  // Marquee drive: rAF-controlled translateX per row so we can SMOOTHLY ramp speed
  // (CSS animation-duration can't be eased — it jumps). Base speed is fast; a row
  // eases to SLOW on hover (that row only), and BOTH rows ease to SLOW while the
  // modal is open (kept moving, never stopped). Refs (not state) so speed changes
  // never trigger a React re-render. CSS keyframes remain as the pre-hydration /
  // reduced-motion fallback; this effect disables them and takes over on mount.
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const hoveredRef = useRef<{ left: boolean; right: boolean }>({ left: false, right: false })
  const modalOpenRef = useRef(false)

  useEffect(() => {
    modalOpenRef.current = !!active
  }, [active])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    interface Track {
      el: HTMLElement
      dir: -1 | 1
      durS: number // seconds for one logical loop (one copy width) at full speed
      ts: number // current timeScale, eased toward target
      offset: number
      half: number
      key: 'left' | 'right'
    }
    const tracks: Track[] = []
    if (leftRef.current) tracks.push({ el: leftRef.current, dir: -1, durS: 38, ts: 1, offset: 0, half: 0, key: 'left' })
    if (rightRef.current) tracks.push({ el: rightRef.current, dir: 1, durS: 44, ts: 1, offset: 0, half: 0, key: 'right' })
    if (tracks.length === 0) return

    const measure = () =>
      tracks.forEach((t) => {
        t.half = t.el.scrollWidth / 2 // each row renders its list twice
        if (t.offset < -t.half) t.offset = -t.half
      })
    tracks.forEach((t) => {
      t.el.style.animation = 'none' // take over from the CSS fallback
    })
    measure()
    tracks.forEach((t) => {
      t.offset = t.dir < 0 ? 0 : -t.half
    })

    const SLOW = 0.12 // hover / modal speed factor — near-crawl but never fully stopped
    const EASE = 4 // higher = snappier ramp; ~0.25s to settle
    let raf = 0
    let last = 0
    const frame = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0 // clamp tab-switch gaps
      last = now
      for (const t of tracks) {
        if (!t.half) continue
        const target = modalOpenRef.current || hoveredRef.current[t.key] ? SLOW : 1
        t.ts += (target - t.ts) * Math.min(1, dt * EASE)
        t.offset += t.dir * (t.half / t.durS) * t.ts * dt
        if (t.dir < 0) {
          if (t.offset <= -t.half) t.offset += t.half
        } else if (t.offset >= 0) {
          t.offset -= t.half
        }
        t.el.style.transform = `translateX(${t.offset}px)`
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      tracks.forEach((t) => {
        t.el.style.transform = ''
        t.el.style.animation = ''
      })
    }
  }, [])

  const openBrand = useCallback((brand: PortfolioBrand) => {
    closingRef.current = false
    setClosing(false)
    setActive(brand)
  }, [])

  const closeBrand = useCallback(() => {
    const reduce =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setActive(null)
      setClosing(false)
      return
    }
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    closeTimer.current = setTimeout(() => {
      closingRef.current = false
      setActive(null)
      setClosing(false)
    }, CLOSE_MS)
  }, [])

  // While the modal is open: lock body scroll (compensating for the scrollbar width
  // so the page doesn't shift), focus the close button, and close on Escape.
  useEffect(() => {
    if (!active) return
    const de = document.documentElement
    const sbw = window.innerWidth - de.clientWidth
    const prevOverflow = de.style.overflow
    const prevPad = de.style.paddingRight
    de.style.overflow = 'hidden'
    if (sbw > 0) de.style.paddingRight = `${sbw}px`
    closeRef.current?.focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeBrand()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      de.style.overflow = prevOverflow
      de.style.paddingRight = prevPad
    }
  }, [active, closeBrand])

  // Clear a pending close timer on unmount.
  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  function tiles(list: PortfolioBrand[], pass: string, duplicate = false) {
    // `pass` namespaces the keys: the marquee renders each list TWICE for a seamless
    // loop, so the two copies must NOT share keys (React would de-dupe the second
    // copy, collapsing the track and breaking the loop). The duplicate copy exists
    // ONLY for the visual loop, so it's removed from the a11y tree + tab order
    // (mouse can still click it; keyboard/SR users get the primary copy once).
    return list.map((b, i) => (
      <div
        className="ltile"
        key={`${pass}-${b.id}-${i}`}
        role="button"
        tabIndex={duplicate ? -1 : 0}
        aria-hidden={duplicate || undefined}
        aria-label={`View performance with ${b.brand}`}
        onClick={() => openBrand(b)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openBrand(b)
          }
        }}
      >
        <div className="ltile-art">
          {b.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.logoUrl} alt={b.brand} loading="lazy" />
          ) : (
            <span className="ltile-mono">{(b.brand[0] || '?').toUpperCase()}</span>
          )}
          <span className="ltile-badge" aria-hidden="true">
            ↗
          </span>
        </div>
        <div className="ltile-cap">
          <span className="ltile-tag">{catIcon(b.category)}</span>
          <span className="ltile-name">{b.brand}</span>
        </div>
      </div>
    ))
  }

  const vm = active ? buildBrandDetail(active) : null
  // When a brand has NO top content, the grid is replaced by a social CTA.
  const promo = active && vm && vm.content.length === 0 ? pickPromo(socials, active) : null

  return (
    <section id="partners" className="brands">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="label reveal">Trusted by</div>
            <h2 className="display h2 reveal">{brands.length} brand partners</h2>
          </div>
          <div className="legend reveal">
            <span className="leg">
              <span className="leg-ic">{fashionIcon()}</span>Fashion
            </span>
            <span className="leg">
              <span className="leg-ic">{beautyIcon()}</span>Beauty
            </span>
            <span className="leg">
              <span className="leg-ic">{appIcon()}</span>App
            </span>
            <span className="leg">
              <span className="leg-ic">{mediaIcon()}</span>Media
            </span>
          </div>
        </div>
        <div
          className="mqrow"
          onMouseEnter={() => (hoveredRef.current.left = true)}
          onMouseLeave={() => (hoveredRef.current.left = false)}
        >
          <div className="mqtrack mq-left" ref={leftRef}>
            {tiles(rowA, 'a1')}
            {tiles(rowA, 'a2', true)}
          </div>
        </div>
        <div
          className="mqrow"
          onMouseEnter={() => (hoveredRef.current.right = true)}
          onMouseLeave={() => (hoveredRef.current.right = false)}
        >
          <div className="mqtrack mq-right" ref={rightRef}>
            {tiles(rowB, 'b1')}
            {tiles(rowB, 'b2', true)}
          </div>
        </div>
      </div>

      {vm && (
        <div
          className={`modal-ov${closing ? ' closing' : ''}`}
          onClick={closeBrand}
          role="presentation"
        >
          <div
            className="modal-pan"
            role="dialog"
            aria-modal="true"
            aria-label={vm.name}
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="modal-x" aria-label="Close" onClick={closeBrand} ref={closeRef}>
              ✕
            </button>

            <div className="modal-hd">
              <div className="modal-hd-glow" />
              <div className="modal-hd-row">
                <div className="modal-logo">
                  {vm.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={vm.logoUrl} alt={vm.name} />
                  ) : (
                    <span className="ltile-mono">{(vm.name[0] || '?').toUpperCase()}</span>
                  )}
                </div>
                <div>
                  <span className="modal-cat">
                    <span className="leg-ic">{CAT_ICON[vm.categoryKey]()}</span>
                    {vm.catLabel}
                  </span>
                  <div className="modal-name display">{vm.name}</div>
                  <div className="modal-type">{vm.type}</div>
                </div>
              </div>
            </div>

            {vm.metaCells.length > 0 && (
              <div className="modal-meta">
                {vm.metaCells.map((cell) => (
                  <div className="mm" key={cell.label}>
                    <span className="mm-l">{cell.label}</span>
                    <span className={`mm-v${cell.accent ? ' accent' : ''}${cell.empty ? ' is-empty' : ''}`}>
                      {cell.value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-body">
              {vm.blurb && <p className="modal-blurb">{vm.blurb}</p>}
              {vm.content.length === 0 ? (
                // No top content yet → a tasteful CTA to the creator's TikTok/IG (or
                // the brand site) instead of an empty grid. Non-link fallback when
                // nothing is linkable.
                promo ? (
                  <a
                    className="modal-promo"
                    href={promo.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="modal-promo-ic" aria-hidden="true">
                      {promo.platform === 'tiktok'
                        ? tiktokIcon()
                        : promo.platform === 'instagram'
                          ? instagramIcon()
                          : webIcon()}
                    </span>
                    <span className="modal-promo-txt">
                      <span className="modal-promo-t">{promo.label}</span>
                      <span className="modal-promo-s">{promo.sub}</span>
                    </span>
                    <span className="modal-promo-go" aria-hidden="true">↗</span>
                  </a>
                ) : (
                  <div className="modal-promo is-static">
                    <span className="modal-promo-txt">
                      <span className="modal-promo-t">Content coming soon</span>
                      <span className="modal-promo-s">Top clips from this collab will appear here.</span>
                    </span>
                  </div>
                )
              ) : (
                <>
                  <div className="modal-bh">
                    <span className="mbh-t">Top content</span>
                    <span className="mbh-c">{vm.countLabel}</span>
                  </div>
                  <div className="vgrid">
                    {vm.content.map((c, i) => {
                      const inner = (
                        <>
                          <div
                            className={`vthumb vt${c.thumbVariant}${c.thumbUrl ? ' has-thumb' : ''}`}
                            style={c.thumbUrl ? { backgroundImage: `url("${c.thumbUrl}")` } : undefined}
                          >
                            <span className="vplat">{c.platform === 'instagram' ? instagramIcon() : tiktokIcon()}</span>
                            <span className="vplay">
                              <svg viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </span>
                            {(c.viewsLabel || c.likesLabel) && (
                              <div className="vstats">
                                {c.viewsLabel && (
                                  <span className="vstat">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                                      <circle cx={12} cy={12} r={3} />
                                    </svg>
                                    {c.viewsLabel}
                                  </span>
                                )}
                                {c.likesLabel && (
                                  <span className="vstat">
                                    <svg viewBox="0 0 24 24" fill="currentColor">
                                      <path d="M12 21s-7-4.5-9.5-9C1 8.5 3 5 6.5 5 9 5 12 8 12 8s3-3 5.5-3C21 5 23 8.5 21.5 12 19 16.5 12 21 12 21z" />
                                    </svg>
                                    {c.likesLabel}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          {c.caption && <div className="vcap">{c.caption}</div>}
                        </>
                      )
                      return c.url ? (
                        <a className="vcard vcard-link" key={i} href={c.url} target="_blank" rel="noopener noreferrer" aria-label={c.caption || `Open ${c.platform} post`}>
                          {inner}
                        </a>
                      ) : (
                        <div className="vcard" key={i}>
                          {inner}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="modal-foot">
              <a className="btn btn-primary" href="#contact" onClick={closeBrand}>
                Start a collab like this →
              </a>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
