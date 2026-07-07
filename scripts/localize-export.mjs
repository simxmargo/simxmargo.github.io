// Localize Supabase Storage assets into the static export, at deploy time.
//
// The public site is a static GitHub Pages export, but the data baked into it
// references images on Supabase Storage (portraits, portfolio video covers, the
// OG share card, an uploaded favicon). When the free-tier Supabase project PAUSES
// from inactivity, Storage goes dark with it — the HTML would survive but every
// one of those images would break. This script — run in the Pages workflow AFTER
// `next build` — downloads every referenced Storage asset into out/snap/ and
// rewrites the references to the site's own origin, so the deployed page renders
// completely with ZERO runtime dependency on Supabase.
//
//   node scripts/localize-export.mjs
//
// Notes:
// - Rewrites use ABSOLUTE ${SITE_URL}/snap/... URLs (og:image + JSON-LD need
//   absolute; <img src> is happy with either).
// - The client-side live refresh (MediaKitLive) still swaps in Storage URLs when
//   the project is AWAKE — that's fine, Storage is up then. When paused, the
//   refresh fails and the localized snapshot stays.
// - A failed download keeps the original remote URL for that one asset (no worse
//   than before) and warns, rather than failing the deploy.
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './sb.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'out')
const snapDir = join(outDir, 'snap')

const fileEnv = loadEnv()
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || fileEnv.NEXT_PUBLIC_SITE_URL || 'https://simxmargo.github.io').replace(/\/+$/, '')

if (!SUPABASE_URL) {
  console.log('No NEXT_PUBLIC_SUPABASE_URL — nothing to localize.')
  process.exit(0)
}

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

// Matches public-Storage object URLs for THIS project, stopping at any character
// that would terminate the URL in HTML attributes, JSON strings, or JS literals.
const escaped = SUPABASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const URL_RE = new RegExp(`${escaped}/storage/v1/object/public/[^"'\\\\<>\\s)]+`, 'g')

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
function localNameFor(url, contentType) {
  const path = url.split('?')[0]
  const ext = extname(path) || MIME_EXT[(contentType || '').split(';')[0].trim()] || '.bin'
  return createHash('sha1').update(url).digest('hex').slice(0, 16) + ext
}

const files = walk(outDir)
const found = new Set()
for (const f of files) {
  for (const m of readFileSync(f, 'utf8').matchAll(URL_RE)) found.add(m[0])
}

if (found.size === 0) {
  console.log('No Supabase Storage URLs in the export — nothing to localize.')
  process.exit(0)
}

mkdirSync(snapDir, { recursive: true })
const rewrites = new Map() // remote URL -> absolute local URL
let failed = 0

for (const url of found) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const name = localNameFor(url, res.headers.get('content-type'))
    writeFileSync(join(snapDir, name), buf)
    rewrites.set(url, `${SITE_URL}/snap/${name}`)
    console.log(`  ✓ ${url.split('/public/')[1]} → snap/${name} (${buf.length} bytes)`)
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

console.log(
  `✓ Localized ${rewrites.size}/${found.size} Storage asset(s) into out/snap/, rewrote ${filesRewritten} file(s)` +
    (failed ? ` — ${failed} left remote (see warnings above)` : ''),
)
