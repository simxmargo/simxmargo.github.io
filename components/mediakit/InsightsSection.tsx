'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { InsightChart, InsightPlatform, InsightSlice } from '@/lib/mediakit-types'
import { INSIGHT_PLATFORM_LABEL, chartKind, formatPercent, sliceColors } from '@/lib/mediakit/insights'
import { BrandGlyph } from '@/components/icons/BrandGlyph'

interface InsightsSectionProps {
  platforms: InsightPlatform[]
  /** Theme accent the automatic slice colours are built from. */
  accent?: string
  eyebrow: string
  title: string
}

// Pie geometry in viewBox units. The stage scales with CSS and the labels are
// placed in percentages of it, so one layout serves every breakpoint.
const SIZE = 170
const C = SIZE / 2
const R = 80
const LABEL_R = R + 14 // where a leader line ends and its label begins
const LABEL_MIN_GAP = 40 // vertical room a two-line label needs, at the smallest stage that shows labels
const POP = 5 // how far a hovered wedge slides out
const TAU = Math.PI * 2

// Rounded so the server (Node) and the browser produce identical markup: their
// Math.sin/cos differ in the last bit, which React reports as a hydration mismatch.
const r2 = (n: number) => Math.round(n * 100) / 100

function polar(r: number, a: number): [number, number] {
  return [r2(C + r * Math.cos(a)), r2(C + r * Math.sin(a))]
}

function wedgePath(a0: number, a1: number): string {
  // A lone 100% slice is a full circle, which a single arc cannot draw.
  if (a1 - a0 >= TAU - 1e-6) {
    return `M${C - R} ${C} A${R} ${R} 0 1 1 ${C + R} ${C} A${R} ${R} 0 1 1 ${C - R} ${C} Z`
  }
  const [x0, y0] = polar(R, a0)
  const [x1, y1] = polar(R, a1)
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${C} ${C} L${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`
}

interface Wedge {
  path: string
  mid: number
  side: 'l' | 'r'
  ax: number // label anchor, viewBox units
  ay: number
  leader: string
}

// Slices run clockwise from 12. Each label starts just outside its wedge's middle,
// then labels on the same side are nudged apart so neighbours never overlap.
function layoutWedges(slices: InsightSlice[]): Wedge[] {
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1
  let a = -Math.PI / 2
  const wedges: Wedge[] = slices.map((s) => {
    const span = (s.value / total) * TAU
    const mid = a + span / 2
    const [ax, ay] = polar(LABEL_R, mid)
    const w: Wedge = { path: wedgePath(a, a + span), mid, side: Math.cos(mid) >= 0 ? 'r' : 'l', ax, ay, leader: '' }
    a += span
    return w
  })
  for (const side of ['l', 'r'] as const) {
    const group = wedges.filter((w) => w.side === side).sort((p, q) => p.ay - q.ay)
    // Tighter spacing when a side holds more labels than the ring has room for.
    const gap = Math.min(LABEL_MIN_GAP, (SIZE + 8) / Math.max(1, group.length - 1))
    for (let i = 1; i < group.length; i++) {
      group[i].ay = Math.max(group[i].ay, group[i - 1].ay + gap)
    }
    const over = group.length ? group[group.length - 1].ay - (SIZE + 4) : 0
    if (over > 0) for (const w of group) w.ay -= over
    const under = group.length ? -4 - group[0].ay : 0
    if (under > 0) for (const w of group) w.ay += under
  }
  for (const w of wedges) {
    // A nudged label is put back on the label ring at its new height, so it never
    // sits over the pie.
    const dy = w.ay - C
    const dx = Math.sqrt(Math.max(0, LABEL_R * LABEL_R - dy * dy))
    w.ax = r2(C + (w.side === 'r' ? dx : -dx))
    w.ay = r2(w.ay)
    const [x1, y1] = polar(R + 3, w.mid)
    const [x2, y2] = polar(R + 9, w.mid)
    w.leader = `${x1},${y1} ${x2},${y2} ${w.ax},${w.ay}`
  }
  return wedges
}

// True once the element has scrolled into view. Own observer rather than the shared
// `.reveal` pass: this section can mount after RevealRoot has already scanned the page.
function useSeen<T extends Element>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return setSeen(true)
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return { ref, seen }
}

const pct = (v: number) => `${r2((v / SIZE) * 100)}%`

// One pie with its labels around it. Hover, focus or tap a wedge or label to lift
// that slice; the others recede. `drawn` starts the clockwise draw-in.
// `id` must be stable across server and client renders: it names the sweep mask.
function Pie({
  chart,
  drawn,
  delay,
  id,
  accent,
}: {
  chart: InsightChart
  drawn: boolean
  delay: number
  id: string
  accent?: string
}) {
  const maskId = `${id}-sweep`
  const [active, setActive] = useState<number | null>(null)
  const colors = sliceColors(chart.slices, accent)
  const wedges = layoutWedges(chart.slices)
  const stateOf = (i: number) => (active === null ? '' : active === i ? ' is-active' : ' is-dim')
  // A hovered slice slides out by this much; its leader and label ride along.
  const popOf = (w: Wedge) => ({ '--ex': `${r2(Math.cos(w.mid) * POP)}px`, '--ey': `${r2(Math.sin(w.mid) * POP)}px` }) as CSSProperties
  const sweep = R + POP + 4 // the mask must also cover a popped-out wedge

  return (
    <div className="ins-chart" onMouseLeave={() => setActive(null)}>
      {chart.title && <div className="label ins-chart-t">{chart.title}</div>}
      <div className="ins-chart-body">
        <div className={`pie-stage${drawn ? ' is-in' : ''}`} style={{ '--delay': `${delay}ms` } as CSSProperties}>
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
            <mask id={maskId} maskUnits="userSpaceOnUse" x={-20} y={-20} width={SIZE + 40} height={SIZE + 40}>
              <circle
                className="pie-sweep"
                cx={C}
                cy={C}
                r={sweep / 2}
                fill="none"
                stroke="#fff"
                strokeWidth={sweep}
                pathLength={100}
                transform={`rotate(-90 ${C} ${C})`}
              />
            </mask>
            <g mask={`url(#${maskId})`}>
              {wedges.map((w, i) => (
                <path
                  key={i}
                  d={w.path}
                  fill={colors[i]}
                  className={`pie-wedge${stateOf(i)}`}
                  style={popOf(w)}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => setActive(active === i ? null : i)}
                />
              ))}
            </g>
            {wedges.map((w, i) => (
              <polyline key={i} points={w.leader} className={`pie-lead${stateOf(i)}`} style={popOf(w)} />
            ))}
          </svg>
          {wedges.map((w, i) => (
            <button
              key={i}
              type="button"
              className={`pie-tag pie-tag-${w.side}${stateOf(i)}`}
              style={{ ...popOf(w), ...(w.side === 'r' ? { left: pct(w.ax), top: pct(w.ay) } : { right: pct(SIZE - w.ax), top: pct(w.ay) }) }}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(active === i ? null : i)}
            >
              <span className="pie-tag-v">{formatPercent(chart.slices[i].value)}</span>
              <span className="pie-tag-lbl">{chart.slices[i].label}</span>
            </button>
          ))}
        </div>

        {/* Narrow screens: labels do not fit around the pie, so they list beside it. */}
        <ul className="pie-legend">
          {chart.slices.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                className={`pie-key${stateOf(i)}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(active === i ? null : i)}
              >
                <span className="pie-swatch" style={{ background: colors[i] }} />
                <span className="pie-key-l">{s.label}</span>
                <span className="pie-key-v">{formatPercent(s.value)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

interface ChartProps {
  chart: InsightChart
  drawn: boolean
  delay: number
  accent?: string
}

// One row per slice: name and figure above a bar sized against the largest slice.
function Bars({ chart, drawn, delay, accent }: ChartProps) {
  const [active, setActive] = useState<number | null>(null)
  const colors = sliceColors(chart.slices, accent)
  const max = Math.max(...chart.slices.map((s) => s.value))
  const stateOf = (i: number) => (active === null ? '' : active === i ? ' is-active' : ' is-dim')
  return (
    <div className="ins-chart" onMouseLeave={() => setActive(null)}>
      {chart.title && <div className="label ins-chart-t">{chart.title}</div>}
      <ul className={`bar-list${drawn ? ' is-in' : ''}`} style={{ '--delay': `${delay}ms` } as CSSProperties}>
        {chart.slices.map((s, i) => (
          <li key={i}>
            <button
              type="button"
              className={`bar-row${stateOf(i)}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(active === i ? null : i)}
            >
              <span className="bar-head">
                <span className="bar-l">{s.label}</span>
                <span className="bar-v">{formatPercent(s.value)}</span>
              </span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{ width: `${r2((s.value / max) * 100)}%`, background: colors[i], '--i': i } as CSSProperties}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// One bar divided between the slices, with each share spelled out underneath.
function Split({ chart, drawn, delay, accent }: ChartProps) {
  const [active, setActive] = useState<number | null>(null)
  const colors = sliceColors(chart.slices, accent)
  const stateOf = (i: number) => (active === null ? '' : active === i ? ' is-active' : ' is-dim')
  return (
    <div className="ins-chart" onMouseLeave={() => setActive(null)}>
      {chart.title && <div className="label ins-chart-t">{chart.title}</div>}
      <div className={`split${drawn ? ' is-in' : ''}`} style={{ '--delay': `${delay}ms` } as CSSProperties}>
        <div className="split-bar" aria-hidden="true">
          {chart.slices.map((s, i) => (
            <span
              key={i}
              className={`split-seg${stateOf(i)}`}
              style={{ flex: `${s.value} 1 0`, background: colors[i] }}
              onMouseEnter={() => setActive(i)}
            />
          ))}
        </div>
        <ul className="split-keys">
          {chart.slices.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                className={`split-key${stateOf(i)}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(active === i ? null : i)}
              >
                <span className="split-v">{formatPercent(s.value)}</span>
                <span className="split-l">
                  <span className="pie-swatch" style={{ background: colors[i] }} />
                  {s.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function PlatformRow({ platform, accent }: { platform: InsightPlatform; accent?: string }) {
  const { ref, seen } = useSeen<HTMLDivElement>()
  const name = INSIGHT_PLATFORM_LABEL[platform.platform] ?? platform.platform
  return (
    <div ref={ref} className="ins-plat">
      <div className="ins-plat-head">
        <h3 className="ins-plat-name display">
          <BrandGlyph platform={platform.platform} size={24} colored={false} />
          {name}
        </h3>
      </div>
      <div className="ins-charts">
        {platform.charts.map((chart, i) => {
          const kind = chartKind(chart)
          const props = { chart, drawn: seen, delay: i * 140, accent }
          if (kind === 'bars') return <Bars key={i} {...props} />
          if (kind === 'split') return <Split key={i} {...props} />
          return <Pie key={i} id={`ins-${platform.platform}-${i}`} {...props} />
        })}
      </div>
    </div>
  )
}

// Audience demographics: a row per platform, a pie per split (gender, age, top
// countries). Data and visibility come from admin → Insights.
export function InsightsSection({ platforms, accent, eyebrow, title }: InsightsSectionProps) {
  return (
    <section id="insights" className="insights">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="label">{eyebrow}</div>
            <h2 className="display h2">{title}</h2>
          </div>
        </div>
        {platforms.map((p) => (
          <PlatformRow key={p.platform} platform={p} accent={accent} />
        ))}
      </div>
    </section>
  )
}
