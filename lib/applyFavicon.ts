// Swap the browser-tab icon at RUNTIME. The static export bakes whatever favicon
// existed at BUILD time into every page's <head> (app/layout.tsx generateMetadata,
// then frozen further by scripts/localize-export.mjs) — so a Settings upload never
// showed without a redeploy. Calling this after a live read lets the current value
// win, while an empty/failed read keeps the baked icon (paused-Supabase safe).
// Accepts http(s) Storage URLs and the data: theme-mark fallback; anything else is
// ignored so a bad stored value can't become tab chrome.
export function applyFavicon(url: string | null | undefined): void {
  if (typeof document === 'undefined' || !url) return
  if (!/^(https?:|data:image\/)/.test(url)) return
  for (const rel of ['icon', 'shortcut icon', 'apple-touch-icon']) {
    let link = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
    if (!link) {
      link = document.createElement('link')
      link.rel = rel
      document.head.appendChild(link)
    }
    link.href = url
  }
}
