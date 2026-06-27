'use client'

import { useLayoutEffect, useRef, type DependencyList } from 'react'

// FLIP (First · Last · Invert · Play) list animation. When an ordered list
// reorders — or an item is added/removed and the rest shift — this glides each
// row from its old position to its new one instead of teleporting.
//
// Usage:
//   const register = useFlipList([orderKey])
//   ...
//   <li ref={register(item.id)} ...>
//
// Measurement uses `offsetTop` (layout position, ignores transforms) rather than
// getBoundingClientRect, so a reorder that lands mid-animation still reads the
// true resting position and doesn't compound the offset. Honors
// prefers-reduced-motion (no animation; positions just update).
export function useFlipList<K extends string | number>(deps: DependencyList, durationMs = 260) {
  const nodes = useRef(new Map<K, HTMLElement>())
  const prevTops = useRef(new Map<K, number>())

  const register = (key: K) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(key, el)
    else nodes.current.delete(key)
  }

  useLayoutEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const nextTops = new Map<K, number>()

    nodes.current.forEach((el, key) => {
      const top = el.offsetTop
      nextTops.set(key, top)
      const was = prevTops.current.get(key)
      if (was == null || reduce) return
      const dy = was - top
      if (Math.abs(dy) < 0.5) return
      // Invert: jump the row back to where it was (no transition), still before paint.
      el.style.transition = 'none'
      el.style.transform = `translateY(${dy}px)`
      // Play: next frame, release the transform and let it ease into place.
      requestAnimationFrame(() => {
        el.style.transition = `transform ${durationMs}ms cubic-bezier(0.2, 0.7, 0.2, 1)`
        el.style.transform = ''
      })
    })

    prevTops.current = nextTops
    // deps are the caller's order signature; measuring every relevant change is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return register
}
