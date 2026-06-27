import type { CSSProperties } from 'react'

/**
 * Shared loading skeletons for the admin (`.studio`) surfaces.
 *
 * `Skel` is the one shimmer primitive; everything else is a composition that
 * mirrors a real surface's DOM shape so the swap to live content doesn't jump
 * (see HeaderSkeleton — included only where the loaded page renders its own
 * `.main-head`). The shimmer + colour come from the scoped `.studio .sk`
 * rules in globals.css, so these inherit the dark editorial palette.
 */

type SkelProps = {
  /** Width — number (px) or any CSS length / %. Defaults to fill. */
  w?: number | string
  /** Height in px. */
  h?: number | string
  /** Corner radius in px. */
  r?: number
  className?: string
  style?: CSSProperties
}

export function Skel({ w = '100%', h = 14, r = 7, className, style }: SkelProps) {
  return (
    <span
      aria-hidden="true"
      className={`sk${className ? ` ${className}` : ''}`}
      style={{ display: 'block', width: w, height: h, borderRadius: r, ...style }}
    />
  )
}

/** Page title + subtitle, matching `.main-head`. Use on early-return pages. */
export function HeaderSkeleton({ titleW = 240, subW = 320 }: { titleW?: number; subW?: number }) {
  return (
    <header className="main-head">
      <div style={{ minWidth: 0, flex: 1 }}>
        <Skel w={titleW} h={36} r={9} />
        <Skel w={subW} h={15} r={6} style={{ marginTop: 14 }} />
      </div>
    </header>
  )
}

/** Brand-partner list — mirrors PortfolioManager's card rows. */
export function PortfolioSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="flex flex-col gap-3" aria-busy="true" aria-label="Loading brand partners">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="card flex items-center gap-3">
          {/* reorder handles */}
          <div className="flex shrink-0 flex-col gap-1.5">
            <Skel w={16} h={14} r={3} />
            <Skel w={16} h={14} r={3} />
          </div>
          {/* logo */}
          <Skel w={48} h={48} r={9} />
          {/* name + category */}
          <div className="min-w-0 flex-1">
            <Skel w={`${38 + (i % 3) * 14}%`} h={15} />
            <Skel w="24%" h={12} style={{ marginTop: 9 }} />
          </div>
          {/* actions */}
          <div className="flex shrink-0 items-center gap-2">
            <Skel w={86} h={32} r={9} />
            <Skel w={62} h={32} r={9} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Social-stat cards — mirrors SocialStatsEditor's per-platform card. */
export function StatRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading social stats">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card">
          <div className="card-head" style={{ justifyContent: 'space-between' }}>
            <div className="flex items-center gap-3">
              <Skel w={34} h={34} r={9} />
              <div>
                <Skel w={120} h={15} />
                <Skel w={72} h={18} r={999} style={{ marginTop: 7 }} />
              </div>
            </div>
            <Skel w={70} h={24} r={999} />
          </div>
          <div className="grid2" style={{ marginTop: 18 }}>
            <Skel h={42} r={9} />
            <Skel h={42} r={9} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Form pages (Profile / Settings / Theme). `withHeader` adds the title placeholder. */
export function FormSkeleton({
  cards = 1,
  fields = 4,
  withHeader = false,
  titleW = 240,
  subW = 320,
}: {
  cards?: number
  fields?: number
  withHeader?: boolean
  titleW?: number
  subW?: number
}) {
  return (
    <>
      {withHeader && <HeaderSkeleton titleW={titleW} subW={subW} />}
      <div className="stack" aria-busy="true" aria-label="Loading">
        {Array.from({ length: cards }).map((_, c) => (
          <div key={c} className="card">
            <div className="card-head">
              <Skel w={34} h={34} r={9} />
              <Skel w={170} h={16} />
            </div>
            <div className="grid2" style={{ marginTop: 20 }}>
              {Array.from({ length: fields }).map((_, f) => (
                <div key={f} className="field">
                  <Skel w={92} h={10} r={3} />
                  <Skel h={42} r={9} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/** Inquiry triage list — mirrors InquiriesInbox's `.panel` rows. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul
      className="space-y-3"
      style={{ listStyle: 'none', margin: 0, padding: 0 }}
      aria-busy="true"
      aria-label="Loading inquiries"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="panel" style={{ padding: '16px 18px' }}>
          <div className="flex items-center gap-3">
            <Skel w={40} h={40} r={999} />
            <div className="min-w-0 flex-1">
              <Skel w={`${28 + (i % 3) * 10}%`} h={14} />
              <Skel w="52%" h={12} style={{ marginTop: 9 }} />
            </div>
            <Skel w={70} h={22} r={999} />
          </div>
        </li>
      ))}
    </ul>
  )
}
