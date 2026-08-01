// Localize every REMOTE image into the static export, at deploy time.
//
// The public site is a static GitHub Pages export, but the data baked into it
// references images that live on other people's servers: Supabase Storage
// (portraits, portfolio video covers, the OG share card, an uploaded favicon)
// and third-party CDNs for the brand logos (cdn.beacons.ai, img.logo.dev, and
// whatever host a brand's logo was scraped from). Every one of those is a
// separate point of failure and — on mobile — a separate DNS + TLS handshake on
// a high-latency link. When the free-tier Supabase project PAUSES from
// inactivity, Storage goes dark with it; when a brand CDN rotates a URL, that
// logo 404s. This script — run in the Pages workflow AFTER `next build` —
// downloads every referenced remote image into out/snap/ and rewrites the
// references to the site's own origin, so the deployed page renders completely
// from ONE origin with ZERO runtime dependency on anyone else.
//
//   node scripts/localize-export.mjs
//
// Notes:
// - Rewrites use ABSOLUTE ${SITE_URL}/snap/... URLs (og:image + JSON-LD need
//   absolute; <img src> is happy with either).
// - It also writes out/snap/manifest.json — a remote-URL → local-path map that
//   the CLIENT uses (lib/mediakit/localizedAssets.ts) to re-localize the LIVE
//   Supabase data it fetches after hydration. Without it, the live upgrade swaps
//   these local URLs back to remote ones and undoes the whole point of this
//   script. Values are PATHS, not absolute URLs, so they keep working if the
//   site later moves to a custom domain.
// - A failed download keeps the original remote URL for that one asset (no worse
//   than before) and warns, rather than failing the deploy.
// - Anything that downloads but isn't actually an image (wrong content-type) is
//   left alone — that's what makes the broad URL scan below safe.
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { loadEnv } from './sb.mjs'

// Downscale + re-encode budget. Measured on the deployed page: the brand tiles are
// painted into a 126px box on a DPR-3 phone and a 166px box on a DPR-2 desktop, so
// 384px covers the worst case with room to spare — yet the source logos were
// 800x800, and one was 3000x1870. That is ~589 KB of pixels no layout can ever
// show. The hero is the one image that genuinely needs to be big (778px box at
// DPR 2 = 1556px), so it keeps its resolution and only changes format.
const THUMB_MAX = 384
const LARGE_MAX = 1600
const WEBP_QUALITY_LARGE = 82
const WEBP_QUALITY_THUMB = 80

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'out')
const snapDir = join(outDir, 'snap')

const fileEnv = loadEnv()
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || fileEnv.NEXT_PUBLIC_SITE_URL || 'https://simxmargo.github.io').replace(/\/+$/, '')

// Not fatal any more: third-party logo CDNs get localized either way. Storage
// URLs are still matched by the generic image rules below (they carry a real
// file extension), this just loses the explicit prefix match.
if (!SUPABASE_URL) console.warn('⚠ No NEXT_PUBLIC_SUPABASE_URL — Storage URLs will only match by file extension.')

// Text formats that can carry asset URLs: HTML, RSC flight payloads (.txt),
// JS bundles, CSS, JSON-LD is inline in HTML, sitemap XML.
const TEXT_EXT = new Set(['.html', '.txt', '.js', '.css', '.json', '.xml'])

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p, acc)
    else if (TEXT_EXT.has(extname(entry.name).toLowerCase())) acc.push(p)
  }
  return acc
}

// Every absolute http(s) URL, stopping at any character that would terminate it
// in an HTML attribute, JSON string, or JS literal. Deliberately broad — the
// filter below decides what's an image, and the content-type check at download
// time is the final gate, so a false positive costs one HEAD-ish fetch and is
// then left untouched.
const URL_RE = /https?:\/\/[^"'\\<>\s)]+/g

const STORAGE_PREFIX = SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public/` : null
const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|gif|avif|svg)$/i
// Image CDNs whose URLs carry NO file extension, so the rule above can't see
// them — e.g. https://img.logo.dev/ohpolly.com?token=... returns a PNG. Add a
// host here when a new brand logo comes from an extension-less CDN.
const EXTENSIONLESS_IMAGE_HOSTS = new Set(['img.logo.dev'])
const siteHost = (() => {
  try {
    return new URL(SITE_URL).host
  } catch {
    return ''
  }
})()

function isCandidateImage(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  // Already ours (including a previous run's /snap/ URLs) or a build asset.
  if (u.host === siteHost || u.pathname.startsWith('/_next/')) return false
  if (STORAGE_PREFIX && raw.startsWith(STORAGE_PREFIX)) return true
  if (EXTENSIONLESS_IMAGE_HOSTS.has(u.host)) return true
  return IMAGE_EXT_RE.test(u.pathname)
}

// Extension for the local copy: from the URL path, else from the content type.
const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
}
function localNameFor(url, contentType, forcedExt) {
  // A re-encoded image must be named for what it now IS, not what it was fetched
  // as — a WebP written as .jpg is served as image/jpeg and will not decode.
  if (forcedExt) return createHash('sha1').update(url).digest('hex').slice(0, 16) + forcedExt
  const urlExt = extname(url.split('?')[0]).toLowerCase()
  // Only trust the URL's extension when it IS an image extension. Extension-less
  // image CDNs otherwise poison this: extname('/fashionnova.com') === '.com', and
  // a file written as .com is served as application/octet-stream, which the
  // browser will not render as an image. Fall back to the response's own type.
  const ext = (IMAGE_EXT_RE.test(urlExt) ? urlExt : '') || MIME_EXT[(contentType || '').split(';')[0].trim()] || '.bin'
  return createHash('sha1').update(url).digest('hex').slice(0, 16) + ext
}

const files = walk(outDir)
const found = new Set()
for (const f of files) {
  for (const m of readFileSync(f, 'utf8').matchAll(URL_RE)) {
    if (isCandidateImage(m[0])) found.add(m[0])
  }
}

// Which images may NOT be touched, and which must stay big. Both are read out of
// the exported HTML rather than the database: it needs no key, no network, and it
// describes exactly what this build actually renders. Attribute order is not
// guaranteed, so each tag is matched from either direction.
const HERO_RE = [
  /<img[^>]+class=["'][^"']*hero-photo[^"']*["'][^>]*src=["']([^"']+)["']/gi,
  /<img[^>]+src=["']([^"']+)["'][^>]*class=["'][^"']*hero-photo[^"']*["']/gi,
]
// og:image and favicons are consumed by OTHER people's software — Discord, Slack,
// iMessage, the browser tab — where WebP support is patchy and a broken share card
// is invisible to us. So these keep their original FORMAT. They are still resized:
// changing pixels is safe, changing the container is not, and the favicon is
// downloaded by every visitor on every page load (it was a 272 KB PNG).
const OG_RE = [
  /<meta[^>]+(?:property|name)=["'][^"']*image[^"']*["'][^>]*content=["']([^"']+)["']/gi,
  /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'][^"']*image[^"']*["']/gi,
]
const ICON_RE = [
  /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/gi,
  /<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["']/gi,
]

const largeUrls = new Set()
const ogUrls = new Set()
const iconUrls = new Set()
for (const f of files.filter((p) => extname(p).toLowerCase() === '.html')) {
  const html = readFileSync(f, 'utf8')
  for (const re of HERO_RE) for (const m of html.matchAll(re)) largeUrls.add(m[1])
  for (const re of OG_RE) for (const m of html.matchAll(re)) ogUrls.add(m[1])
  for (const re of ICON_RE) for (const m of html.matchAll(re)) iconUrls.add(m[1])
}

// icon beats og: the same file can legitimately be both, and the icon cap is the
// safe one to apply.
function roleFor(url) {
  if (iconUrls.has(url)) return 'icon'
  if (ogUrls.has(url)) return 'og'
  return largeUrls.has(url) ? 'large' : 'thumb'
}

// Pixel cap per role. og:image is the size every social platform actually renders.
const MAX_FOR = { thumb: THUMB_MAX, large: LARGE_MAX, og: 1200, icon: 256 }
const KEEPS_FORMAT = new Set(['og', 'icon'])

if (found.size === 0) {
  console.log('No remote image URLs in the export — nothing to localize.')
  process.exit(0)
}

mkdirSync(snapDir, { recursive: true })
const rewrites = new Map() // remote URL -> absolute local URL
let failed = 0
let savedBytes = 0

let skippedNotImage = 0

for (const url of found) {
  try {
    // Some CDNs 403 a bare fetch with no UA; ask like a browser.
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; simxmargo-localize/1.0)' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const type = (res.headers.get('content-type') || '').split(';')[0].trim()
    // The gate that makes the broad URL scan safe: if it isn't an image, walk away
    // and leave the reference exactly as it was.
    if (!type.startsWith('image/')) {
      skippedNotImage++
      continue
    }
    const original = Buffer.from(await res.arrayBuffer())
    let buf = original
    let forcedExt = null
    const role = roleFor(url)

    // SVG is already resolution-independent and GIF may be animated (sharp would
    // flatten it to a still frame), so both are copied through untouched.
    const transformable = type !== 'image/svg+xml' && type !== 'image/gif'
    if (transformable) {
      try {
        const max = MAX_FOR[role]
        let pipe = sharp(original)
          .rotate() // honour EXIF orientation before it is stripped
          .resize(max, max, { fit: 'inside', withoutEnlargement: true })
        // No format call = sharp writes back the format it read, which is what
        // keeps share cards and favicons decodable everywhere.
        if (!KEEPS_FORMAT.has(role)) {
          pipe = pipe.webp({ quality: role === 'large' ? WEBP_QUALITY_LARGE : WEBP_QUALITY_THUMB })
          forcedExt = '.webp'
        }
        buf = await pipe.toBuffer()
        savedBytes += original.length - buf.length
      } catch (err) {
        // Fail SOFT: an image sharp cannot read is still worth localizing at its
        // original size. Losing a logo entirely would be a worse trade than
        // shipping it a few KB heavier.
        buf = original
        forcedExt = null
        console.warn(`  ⚠ could not re-encode, storing original: ${err.message}`)
      }
    }

    const name = localNameFor(url, type, forcedExt)
    writeFileSync(join(snapDir, name), buf)
    rewrites.set(url, `${SITE_URL}/snap/${name}`)
    const u = new URL(url)
    const shrink = buf.length < original.length ? ` (${Math.round((1 - buf.length / original.length) * 100)}% smaller)` : ''
    console.log(
      `  ✓ [${role}] ${u.host}/…/${decodeURIComponent(u.pathname.split('/').pop())} → snap/${name} ` +
        `${original.length} → ${buf.length} bytes${shrink}`,
    )
  } catch (err) {
    failed++
    console.warn(`  ⚠ keeping remote URL (download failed: ${err.message}): ${url}`)
  }
}

let filesRewritten = 0
for (const f of files) {
  const before = readFileSync(f, 'utf8')
  let after = before
  for (const [remote, local] of rewrites) after = after.split(remote).join(local)
  if (after !== before) {
    writeFileSync(f, after)
    filesRewritten++
  }
}

// Written AFTER the rewrite pass on purpose: its KEYS are the remote URLs, and
// the pass above would have rewritten them into local ones, making the map an
// identity function. `files` was also captured before this file existed, so it
// can never be picked up by a rewrite.
const manifest = Object.fromEntries([...rewrites].map(([remote, local]) => [remote, new URL(local).pathname]))
writeFileSync(join(snapDir, 'manifest.json'), JSON.stringify(manifest, null, 0))

console.log(
  `✓ Localized ${rewrites.size}/${found.size} remote image(s) into out/snap/, rewrote ${filesRewritten} file(s)` +
    (skippedNotImage ? ` — ${skippedNotImage} skipped (not an image)` : '') +
    (failed ? ` — ${failed} left remote (see warnings above)` : ''),
)
console.log(
  `✓ Resized (thumb ≤${THUMB_MAX}px · hero ≤${LARGE_MAX}px · og ≤${MAX_FOR.og}px · icon ≤${MAX_FOR.icon}px);` +
    ` WebP for page images, original format kept for share cards + favicons — saved ${Math.round(savedBytes / 1024)} KB`,
)
console.log(`✓ Wrote out/snap/manifest.json with ${rewrites.size} entr${rewrites.size === 1 ? 'y' : 'ies'} for the client-side live upgrade`)
