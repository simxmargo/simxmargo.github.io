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

// Starting point for the admin editor ("Load starter numbers"), taken from the
// creator's own Insights sheet. Never rendered publicly until saved + enabled.
export const INSIGHTS_TEMPLATE: InsightPlatform[] = [
  {
    platform: 'tiktok',
    charts: [
      { title: 'Gender', slices: [{ label: 'Female', value: 68 }, { label: 'Male', value: 32 }] },
      {
        title: 'Age',
        slices: [
          { label: '18-24', value: 41.6 },
          { label: '25-34', value: 39.9 },
          { label: '35-44', value: 13.5 },
          { label: '45-54', value: 4.9 },
        ],
      },
      {
        title: 'Top countries',
        slices: [
          { label: 'Philippines', value: 28.1 },
          { label: 'Pakistan', value: 6.8 },
          { label: 'Saudi Arabia', value: 6.7 },
          { label: 'Other', value: 58.4 },
        ],
      },
    ],
  },
  {
    platform: 'instagram',
    charts: [
      { title: 'Gender', slices: [{ label: 'Female', value: 87.7 }, { label: 'Male', value: 12.3 }] },
      {
        title: 'Age',
        slices: [
          { label: '13-17', value: 12.2 },
          { label: '18-24', value: 47.2 },
          { label: '25-34', value: 32.8 },
          { label: '35-44', value: 7.8 },
        ],
      },
      {
        title: 'Top countries',
        slices: [
          { label: 'Philippines', value: 24.8 },
          { label: 'Indonesia', value: 16.9 },
          { label: 'United States', value: 5.5 },
          { label: 'Other', value: 52.8 },
        ],
      },
    ],
  },
]

/* eslint-disable @typescript-eslint/no-explicit-any */
function cleanSlices(raw: any): InsightSlice[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((s) => ({ label: String(s?.label ?? '').trim(), value: Number(s?.value) }))
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

// Slice colours. Four hues validated as a ring on the dark surface (every adjacent
// pair, including last→first, clears the colour-blind and normal-vision floors);
// "Other" and any slice past the fourth fall back to neutral greys.
const SLICE_HUES = ['#d55181', '#3987e5', '#c98500', '#9085e9']
const SLICE_NEUTRALS = ['#8a847a', '#5f5a52']

export function sliceColors(slices: InsightSlice[]): string[] {
  let hue = 0
  let neutral = 0
  return slices.map((s) => {
    const isOther = /^others?$/i.test(s.label.trim())
    if (!isOther && hue < SLICE_HUES.length) return SLICE_HUES[hue++]
    return SLICE_NEUTRALS[neutral++ % SLICE_NEUTRALS.length]
  })
}

export function formatPercent(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`
}
