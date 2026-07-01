// WCAG contrast helpers for the Theme editor + the server-side token injection.
//
// The public kit uses ONE brand accent for two jobs: as a fill (button/marquee
// backgrounds — always fine) and as TEXT/icon colour on the near-black page. A dark
// brand colour (e.g. #990000) is unreadable in the second role. These pure helpers let
// us (a) auto-pick a legible on-accent label colour and (b) auto-lighten the accent when
// it fails as text — plus surface the live ratio in the editor so bad combos are visible.
//
// Pure + dependency-free → safe in the server component (app/page.tsx) AND the client.

// The kit's two "ink" options + the page background, from globals.css (.mk root).
export const INK_DARK = '#14110d'
export const INK_LIGHT = '#f4efe5'
export const PAGE_BG = '#0b0a08'
export const AA_TEXT = 4.5 // WCAG AA for normal text
export const AA_LARGE = 3 // WCAG AA for large text / UI

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

// WCAG relative luminance (sRGB → linear).
function relLuminance([r, g, b]: [number, number, number]): number {
  const chan = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}

// WCAG contrast ratio (1–21). Invalid hex ⇒ 1 (fails everything) so callers stay safe.
export function contrastRatio(a: string, b: string): number {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  if (!ra || !rb) return 1
  const la = relLuminance(ra)
  const lb = relLuminance(rb)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

// The legible label colour to draw ON an accent fill (button text): whichever kit ink
// contrasts more with the accent. Fixes "dark text on a dark-red button".
export function onAccentInk(accent: string): string {
  return contrastRatio(INK_LIGHT, accent) >= contrastRatio(INK_DARK, accent) ? INK_LIGHT : INK_DARK
}

// Mix two hex colours (t = 0 → a, 1 → b).
function mix(a: string, b: string, t: number): string {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  if (!ra || !rb) return a
  return rgbToHex([ra[0] + (rb[0] - ra[0]) * t, ra[1] + (rb[1] - ra[1]) * t, ra[2] + (rb[2] - ra[2]) * t])
}

// A legible version of the accent for TEXT on `bg`: the accent itself if it already
// meets `min`, otherwise the accent blended toward white just enough to pass (keeps the
// hue, so a dark red becomes a readable lighter red rather than plain white).
export function readableAccentText(accent: string, bg: string = PAGE_BG, min: number = AA_TEXT): string {
  if (!hexToRgb(accent)) return INK_LIGHT
  if (contrastRatio(accent, bg) >= min) return accent
  for (let t = 0.1; t <= 1; t += 0.1) {
    const candidate = mix(accent, '#ffffff', t)
    if (contrastRatio(candidate, bg) >= min) return candidate
  }
  return '#ffffff'
}

// Small helper for the editor's badges.
export function contrastLabel(ratio: number): { text: string; pass: boolean } {
  return { text: `${ratio.toFixed(1)}:1`, pass: ratio >= AA_TEXT }
}
