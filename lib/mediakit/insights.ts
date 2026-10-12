import type { InsightChart, InsightPlatform, InsightSlice, Insights, Platform } from '@/lib/mediakit-types'

// Audience-insights helpers shared by the public section and the admin editor.

// Platforms the admin editor offers, in display order.
export const INSIGHT_PLATFORMS: Platform[] = ['tiktok', 'instagram', 'facebook']

// Every platform the kit knows; anything else in the jsonb is not drawn (its name
// also becomes a DOM id, so it must be a known token).
const ALL_PLATFORMS: Platform[] = ['tiktok', 'instagram', 'facebook', 'youtube', 'x', 'twitch']

export const INSIGHT_PLATFORM_LABEL: Partial<Record<Platform, string>> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function cleanSlices(raw: any): InsightSlice[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((s) => {
      const color = safeColor(s?.color)
      return { label: String(s?.label ?? '').trim(), value: Number(s?.value), ...(color ? { color } : {}) }
    })
    .filter((s) => s.label && Number.isFinite(s.value) && s.value > 0)
}

// What the public page may draw: jsonb is untyped at rest, so drop anything
// malformed or empty rather than render a broken pie.
export function renderableInsights(raw: Insights | undefined): InsightPlatform[] {
  if (!raw || raw.enabled !== true || !Array.isArray(raw.platforms)) return []
  return raw.platforms
    .map((p: any) => ({
      platform: p?.platform as Platform,
      charts: (Array.isArray(p?.charts) ? p.charts : [])
        .map((c: any): InsightChart => ({ title: String(c?.title ?? '').trim(), slices: cleanSlices(c?.slices) }))
        .filter((c: InsightChart) => c.slices.length > 0),
    }))
    .filter((p) => ALL_PLATFORMS.includes(p.platform) && p.charts.length > 0)
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// A custom slice colour as stored: hex, a colour function (rgb, hsl, oklch, ...) or a
// named colour. Shape-checked only, so nothing but a colour token reaches the markup.
const COLOR_RE =
  /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl|hwb|lab|lch|oklab|oklch)a?\([0-9a-z\s.,%/+-]{1,60}\)|[a-z]{3,30})$/i

export function safeColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const c = v.trim()
  // Keywords that parse as colours but paint nothing useful on a pie.
  if (/^(none|inherit|initial|unset|revert|transparent|currentcolor)$/i.test(c)) return undefined
  return COLOR_RE.test(c) ? c : undefined
}

// Slice colours. Four hues validated as a ring on the dark surface (every adjacent
// pair, including last→first, clears the colour-blind and normal-vision floors);
// "Other" and any slice past the fourth fall back to neutral greys. A slice's own colour
// wins, but still takes its turn in the palette so its neighbours keep theirs.
const SLICE_HUES = ['#d55181', '#3987e5', '#c98500', '#9085e9']
const SLICE_NEUTRALS = ['#8a847a', '#5f5a52']

export function sliceColors(slices: InsightSlice[]): string[] {
  let hue = 0
  let neutral = 0
  return slices.map((s) => {
    const isOther = /^others?$/i.test(s.label.trim())
    const auto =
      !isOther && hue < SLICE_HUES.length ? SLICE_HUES[hue++] : SLICE_NEUTRALS[neutral++ % SLICE_NEUTRALS.length]
    return safeColor(s.color) ?? auto
  })
}

export function formatPercent(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`
}
