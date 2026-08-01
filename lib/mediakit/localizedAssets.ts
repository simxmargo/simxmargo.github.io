// Runtime half of the deploy-time localization in scripts/localize-export.mjs.
//
// The static export ships with every image rewritten to a local /snap/ copy, but
// MediaKitLive then fetches LIVE rows from Supabase after hydration — and those
// rows carry the ORIGINAL remote URLs (Supabase Storage, cdn.beacons.ai,
// img.logo.dev, …). Swapping them straight in undid the localization completely:
// every image was re-requested from a slower third-party origin, and on a slow
// mobile link the still-in-flight /snap/ downloads were ABORTED mid-request when
// their `src` changed. Measured on Slow 4G / iPhone 13, that turned a 7.8s load
// into a 24.2s one and left the hero portrait blank for ~23 seconds.
//
// So: run live data through the manifest the build wrote, mapping each remote URL
// back to its local copy. Live TEXT still updates without a rebuild; images stay
// local, and an image that has no local twin (added in the admin since the last
// deploy) simply keeps its remote URL.
export type SnapManifest = Record<string, string>

// Cached module-wide: the manifest is immutable per deploy, and MediaKitLive is
// mounted once, but a cache keeps a future second caller free.
let cached: Promise<SnapManifest> | null = null

// Never rejects — no manifest (dev server, or a deploy before this script landed)
// just means "localize nothing", which is exactly the old behaviour.
export function loadSnapManifest(): Promise<SnapManifest> {
  if (!cached) {
    cached = fetch('/snap/manifest.json', { cache: 'force-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<SnapManifest>) : {}))
      .catch(() => ({}))
  }
  return cached
}

// Deep-walks any JSON-ish value and swaps strings that are manifest keys. Written
// generically rather than field-by-field (profile.avatarUrl, brands[].logoUrl,
// media[].coverUrl, …) so a newly-added image field can't silently miss out.
export function localizeAssets<T>(value: T, manifest: SnapManifest): T {
  if (!manifest || Object.keys(manifest).length === 0) return value

  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return manifest[v] ?? v
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val)
      return out
    }
    return v
  }

  return walk(value) as T
}
