// Shared OpenGraph card design as a satori element tree (plain objects — no React,
// no fs), so it's pure + reusable. scripts/gen-og.mjs renders it to public/og.png at
// deploy time from LIVE data, which is what social crawlers (Discord, etc.) read.
//
// Why a tree, not JSX: this file is imported by a plain-Node build script, so it must
// run without a TS/JSX transform. satori accepts exactly this {type, props} shape.

const BG = '#0b0a08' // --bg
const INK = '#f4efe5' // --ink
const ACCENT = '#e0694b' // --accent (the italic-ish "x" + underline)
const MUTED = 'rgba(244,239,229,0.62)'
const FAINT = 'rgba(244,239,229,0.46)'

export const OG_SIZE = { width: 1200, height: 630 }

// "simxmargo" → ['sim', <span accent>x</span>, 'margo'] so the middle x is terracotta,
// mirroring the on-site Wordmark. Falls back to the raw name if there's no 'x'.
function wordmarkChildren(name) {
  const m = /^(.*?)(x)(.*)$/i.exec(name || '')
  if (!m) return [name || 'simxmargo']
  return [m[1], { type: 'span', props: { style: { color: ACCENT }, children: m[2] } }, m[3]]
}

// Build the card element. All strings are pre-resolved by the caller (the generator
// computes reach + platforms from live data) so this stays pure + framework-free.
export function ogCard({ name = 'simxmargo', descriptor = '', reach = '', platforms = [] } = {}) {
  const line1 = [descriptor, reach ? `${reach} followers` : ''].filter(Boolean).join('  ·  ')
  const line2 = platforms.join('  ·  ')

  const bottom = [
    line1 && {
      type: 'div',
      props: { style: { display: 'flex', fontSize: 31, color: MUTED, marginBottom: 9 }, children: line1 },
    },
    line2 && {
      type: 'div',
      props: { style: { display: 'flex', fontSize: 26, color: FAINT }, children: line2 },
    },
    {
      type: 'div',
      props: { style: { marginTop: 28, width: 208, height: 6, background: ACCENT, display: 'flex' }, children: [] },
    },
  ].filter(Boolean)

  return {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: BG,
        color: INK,
        padding: '78px 84px',
        fontFamily: 'Archivo',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              fontWeight: 600,
              fontSize: 26,
              letterSpacing: 9,
              textTransform: 'uppercase',
              color: ACCENT,
            },
            children: 'Media Kit',
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              fontFamily: 'Bodoni Moda',
              fontWeight: 700,
              fontSize: 132,
              lineHeight: 1,
              letterSpacing: -1,
            },
            children: wordmarkChildren(name),
          },
        },
        { type: 'div', props: { style: { display: 'flex', flexDirection: 'column' }, children: bottom } },
      ],
    },
  }
}
