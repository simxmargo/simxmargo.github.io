// The brand mark, generated as a pure data-URL — shared by the SERVER root layout
// (the browser-tab favicon in app/layout.tsx) AND the CLIENT studio chrome (the
// sidebar mark + the Settings preview), so the tab icon and the in-app brand mark
// are always the same image. Pure (strings in, data-URL out): no imports, no async,
// no server-only APIs → safe to import on BOTH sides of the RSC boundary.

// Only accept a real hex colour before baking it into the SVG — a malformed theme
// value can't break rendering or inject markup. Falls back to the design accent.
export function safeAccent(input: string | undefined | null): string {
  const v = (input ?? '').trim()
  return /^#[0-9a-f]{3,8}$/i.test(v) ? v : '#e0694b'
}

// A warm-dark squircle with the signature italic "x" in the THEME accent, so the mark
// tracks the selected theme colour. Used wherever there's no custom uploaded favicon.
// The "x" is sized to fill the tile (font-size 29 in a 32 box) and vertically centred
// via a manual baseline (favicon renderers ignore dominant-baseline) — so it reads
// crisply at 16px tab size AND as the larger studio brand mark / Settings preview.
export function themeFaviconDataUrl(accent: string | undefined | null): string {
  const c = safeAccent(accent)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<defs><linearGradient id="fvg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#221a12"/><stop offset="1" stop-color="#0f0b07"/>` +
    `</linearGradient></defs>` +
    `<rect width="32" height="32" rx="7.5" fill="url(#fvg)"/>` +
    `<text x="16" y="23" font-size="29" text-anchor="middle" fill="${c}" ` +
    `font-family="Georgia,'Times New Roman',serif" font-style="italic" font-weight="700">x</text>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
