// Shared OpenGraph card design as a satori element tree (plain objects — no React,
// no fs), so it's pure + reusable. scripts/gen-og.mjs renders it to public/og.png at
// deploy time from LIVE data, which is what social crawlers (Discord, etc.) read.
//
// Why a tree, not JSX: this file is imported by a plain-Node build script, so it must
// run without a TS/JSX transform. satori accepts exactly this {type, props} shape.
//
// DESIGN: this mirrors the on-site HERO — the creator's photo full-bleed behind a
// left-weighted scrim, with the eyebrow tokens, the white "simxmargo" wordmark (NO
// accent on the "x" — one uniform word), and the total-reach figure. Falls back to a
// solid dark card if no photo is available, so it never renders broken.

const SIZE = { width: 1200, height: 630 }
export const OG_SIZE = SIZE

const INK = '#f6f1e7' // text on the dark/photo canvas (≈ --ink)
const FAINT = 'rgba(246,241,231,0.74)' // eyebrow + label
const FALLBACK_BG = '#0b0a08' // shown when there is no photo (≈ --bg)

// Build the card element. Every string is pre-resolved by the caller (the generator
// computes reach + tokens + the photo data-URI from live data) so this stays pure +
// framework-free. `accent` only tints the eyebrow's dot separators, echoing the live
// site's theme — the wordmark itself is always plain white.
export function ogCard({ name = 'simxmargo', photo = '', tokens = [], reach = '', accent = '' } = {}) {
  const dotColor = accent || 'rgba(246,241,231,0.5)'

  // Background layers (only when a photo exists): the full-bleed image, a left scrim
  // so the left-aligned text stays legible, and a gentle bottom scrim under the reach.
  const layers = photo
    ? [
        {
          type: 'img',
          props: {
            // Explicit width/height means satori never needs to probe the image's
            // intrinsic size (which is what makes it throw on unknown formats).
            src: photo,
            width: SIZE.width,
            height: SIZE.height,
            style: { position: 'absolute', top: 0, left: 0, width: SIZE.width, height: SIZE.height, objectFit: 'cover' },
          },
        },
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute', top: 0, left: 0, width: SIZE.width, height: SIZE.height, display: 'flex',
              backgroundImage:
                'linear-gradient(90deg, rgba(8,7,5,0.95) 0%, rgba(8,7,5,0.82) 32%, rgba(8,7,5,0.34) 64%, rgba(8,7,5,0.05) 100%)',
            },
          },
        },
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute', top: 0, left: 0, width: SIZE.width, height: SIZE.height, display: 'flex',
              backgroundImage: 'linear-gradient(0deg, rgba(8,7,5,0.80) 0%, rgba(8,7,5,0.12) 36%, rgba(8,7,5,0) 58%)',
            },
          },
        },
      ]
    : []

  // Eyebrow: "Philippines · Fashion · Beauty · Lifestyle", dots in the theme accent.
  const eyebrow = []
  tokens.forEach((t, i) => {
    if (i > 0) eyebrow.push({ type: 'span', props: { style: { color: dotColor, marginLeft: 13, marginRight: 13 }, children: '·' } })
    eyebrow.push({ type: 'span', props: { children: t } })
  })

  const spacer = { type: 'div', props: { style: { display: 'flex' }, children: [] } }

  const content = {
    type: 'div',
    props: {
      style: {
        position: 'absolute', top: 0, left: 0, width: SIZE.width, height: SIZE.height,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: '76px 84px', fontFamily: 'Archivo', color: INK,
      },
      children: [
        tokens.length
          ? {
              type: 'div',
              props: {
                style: {
                  display: 'flex', alignItems: 'center', fontWeight: 600, fontSize: 25,
                  letterSpacing: 6, textTransform: 'uppercase', color: FAINT,
                },
                children: eyebrow,
              },
            }
          : spacer,
        {
          type: 'div',
          props: {
            style: {
              display: 'flex', fontFamily: 'Druk Wide', fontWeight: 700,
              fontSize: 84, lineHeight: 1, letterSpacing: -1, color: INK,
            },
            children: [name],
          },
        },
        reach
          ? {
              type: 'div',
              props: {
                style: { display: 'flex', flexDirection: 'column' },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: { display: 'flex', fontFamily: 'Druk Wide', fontWeight: 700, fontSize: 60, lineHeight: 1, color: INK },
                      children: [reach],
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      style: { display: 'flex', marginTop: 10, fontWeight: 600, fontSize: 22, letterSpacing: 5, textTransform: 'uppercase', color: FAINT },
                      children: 'Total reach',
                    },
                  },
                ],
              },
            }
          : spacer,
      ],
    },
  }

  return {
    type: 'div',
    props: {
      style: {
        position: 'relative', width: SIZE.width, height: SIZE.height, display: 'flex',
        background: FALLBACK_BG, color: INK, fontFamily: 'Archivo', overflow: 'hidden',
      },
      children: [...layers, content],
    },
  }
}
