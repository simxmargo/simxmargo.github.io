'use client'

import { useEffect, useRef, useState } from 'react'

// Animated count-up that starts when the element scrolls into view. Returns a ref
// to attach to the displayed element + the current value. Reduced-motion → jumps
// straight to the target (no animation). Cubic ease-out for a natural settle.
export function useCountUp(target: number, durationMs = 1400) {
  const ref = useRef<HTMLSpanElement>(null)
  const [value, setValue] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target)
      return
    }

    let raf = 0
    const animate = () => {
      const t0 = performance.now()
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / durationMs)
        const eased = 1 - Math.pow(1 - p, 3)
        setValue(Math.round(target * eased))
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    // Printing (the Download-as-PDF feature) must show the real number even if the
    // counter never scrolled into view — jump straight to the target before print.
    const onBeforePrint = () => setValue(target)
    window.addEventListener('beforeprint', onBeforePrint)

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          animate()
          io.disconnect()
        }
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
      window.removeEventListener('beforeprint', onBeforePrint)
    }
  }, [target, durationMs])

  return { value, ref }
}
