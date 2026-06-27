'use client'

import { useEffect } from 'react'

// Single client-side choreography driver for the public media kit (replaces the
// design's GSAP context with lightweight DOM + IntersectionObserver). It:
//   1. reveals `.reveal` elements as they enter view (adds `.in`), with optional
//      `[data-stagger-group]` children staggered 90ms apart;
//   2. scales the `.prog-fill` scroll-progress bar to scroll position;
//   3. wires `.magnetic` buttons to follow the cursor (CSS transition eases the
//      transform + reset; see `.mk .btn` in globals.css).
// Honors prefers-reduced-motion (reveal everything immediately, no magnetic) and
// keeps the design's 2.6s safety net so content is never stuck invisible if the
// observer never fires. Scoped to the nearest `.mk` root.
export function RevealRoot() {
  useEffect(() => {
    const root = document.querySelector('.mk') as HTMLElement | null
    if (!root) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // 1 — scroll-reveal -------------------------------------------------------
    let io: IntersectionObserver | null = null
    let safety = 0
    if (reduce) {
      root.querySelectorAll('.reveal, .sreveal').forEach((el) => el.classList.add('in'))
    } else {
      let anyRevealed = false
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (!e.isIntersecting) return
            const el = e.target as HTMLElement
            if (el.hasAttribute('data-stagger-group')) {
              el.querySelectorAll('.sreveal').forEach((k, i) => setTimeout(() => k.classList.add('in'), i * 90))
            }
            el.classList.add('in')
            anyRevealed = true
            io?.unobserve(el)
          })
        },
        { threshold: 0.15, rootMargin: '0px 0px -6% 0px' },
      )
      root.querySelectorAll('.reveal, [data-stagger-group]').forEach((el) => io!.observe(el))
      safety = window.setTimeout(() => {
        if (anyRevealed) return
        root.querySelectorAll('.reveal, .sreveal').forEach((el) => el.classList.add('in'))
      }, 2600)
    }

    // 2 — scroll-progress bar -------------------------------------------------
    const fill = root.querySelector('.prog-fill') as HTMLElement | null
    let ticking = false
    const updateProgress = () => {
      ticking = false
      if (!fill) return
      const doc = document.documentElement
      const max = doc.scrollHeight - doc.clientHeight
      const p = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0
      fill.style.transform = `scaleX(${p})`
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(updateProgress)
    }
    if (fill) {
      window.addEventListener('scroll', onScroll, { passive: true })
      window.addEventListener('resize', onScroll, { passive: true })
      updateProgress()
    }

    // 3 — magnetic buttons (desktop pointer only; skipped under reduced-motion)
    const magnetCleanups: Array<() => void> = []
    if (!reduce) {
      root.querySelectorAll<HTMLElement>('.magnetic').forEach((btn) => {
        const onMove = (e: MouseEvent) => {
          const r = btn.getBoundingClientRect()
          const x = (e.clientX - r.left - r.width / 2) * 0.4
          const y = (e.clientY - r.top - r.height / 2) * 0.5
          btn.style.transform = `translate(${x}px, ${y}px)`
        }
        const onLeave = () => {
          btn.style.transform = ''
        }
        btn.addEventListener('mousemove', onMove)
        btn.addEventListener('mouseleave', onLeave)
        magnetCleanups.push(() => {
          btn.removeEventListener('mousemove', onMove)
          btn.removeEventListener('mouseleave', onLeave)
          btn.style.transform = ''
        })
      })
    }

    return () => {
      io?.disconnect()
      window.clearTimeout(safety)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      magnetCleanups.forEach((fn) => fn())
    }
  }, [])

  return null
}
