import type { InsightChart, InsightPlatform, InsightSlice, Insights, Platform } from '@/lib/mediakit-types'
import { INK_LIGHT, PAGE_BG, hexToRgb, mix } from '@/lib/theme/contrast'

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

const DEFAULT_ACCENT = '#e0694b' // globals.css --accent, used until a theme accent is saved

// Hex <-> HSL (h in degrees, s and l in 0..1), for building the palette around the accent's hue.
function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = (hexToRgb(hex) ?? [0, 0, 0]).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + ((h % 360) + 360) % 360 / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const ch = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))
  return `#${[ch(0), ch(8), ch(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

// The automatic slice colours, built around the kit's accent so the pies match the
// page: the accent exactly as the buttons use it, then its warm and cool neighbours
// on the colour wheel. "Other" and any slice past the fourth take a quiet grey or
// the cream ink.
export function themePalette(accent?: string): { hues: string[]; neutrals: string[] } {
  const primary = accent && hexToRgb(accent) ? accent : DEFAULT_ACCENT
  const [h] = hexToHsl(primary)
  return {
    hues: [primary, hslToHex(h + 28, 0.86, 0.54), hslToHex(h - 20, 0.72, 0.6), hslToHex(h + 44, 0.82, 0.62)],
    neutrals: [mix(INK_LIGHT, PAGE_BG, 0.62), INK_LIGHT],
  }
}

// One colour per slice. A slice's own colour wins, but it still takes its turn in the
// palette so its neighbours keep theirs.
export function sliceColors(slices: InsightSlice[], accent?: string): string[] {
  const { hues, neutrals } = themePalette(accent)
  let hue = 0
  let neutral = 0
  return slices.map((s) => {
    const isOther = /^others?$/i.test(s.label.trim())
    const auto = !isOther && hue < hues.length ? hues[hue++] : neutrals[neutral++ % neutrals.length]
    return safeColor(s.color) ?? auto
  })
}

export function formatPercent(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`
}
