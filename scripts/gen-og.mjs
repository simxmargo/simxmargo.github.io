// Generate public/og.png from LIVE data, at deploy time.
//
// The site is a static GitHub Pages export, so social crawlers read a frozen og.png.
// This script — run in the Pages workflow BEFORE `next build` — re-renders that card
// from the current Supabase data so the share thumbnail never goes stale. It mirrors
// the on-site hero: the creator's social-share photo full-bleed, the white "simxmargo"
// wordmark, the eyebrow tokens, and the live total reach (the total_followers override
// if set, else the sum of all platforms). satori draws to SVG; resvg rasterizes to PNG.
//
//   node scripts/gen-og.mjs
//
// Env: NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (CI passes them; a
// local run falls back to .env). Degrades gracefully — any field that can't be read is
// simply omitted (no photo / no reach line) rather than failing the build.
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './sb.mjs'
import { ogCard, OG_SIZE } from '../lib/og/ogCard.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const font = (p) => readFileSync(join(root, 'assets/og', p))

const fileEnv = loadEnv()
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Mirror lib/mediakit-types formatCount so the card matches the on-site numbers.
function formatCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

// resvg can decode these embedded raster formats; AVIF it cannot, so we skip the photo
// for AVIF (the card still renders on its solid fallback) rather than emit a blank hole.
const EMBEDDABLE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

function sniffMime(buf) {
  if (buf.length < 12) return ''
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'image/avif' // ftypavif/ftypheic family
  return ''
}

// Download a remote image → base64 data-URI satori can embed. Returns '' on any failure
// or an unembeddable format, so the caller falls back to the photo-less card.
async function fetchImageDataUri(url) {
  if (!url) return ''
  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.warn(`⚠ Share image fetch ${res.status} — rendering card without the photo.`)
      return ''
    }
    const buf = Buffer.from(await res.arrayBuffer())
    let mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!EMBEDDABLE.has(mime)) mime = sniffMime(buf) // trust the bytes if the header is vague
    if (!EMBEDDABLE.has(mime)) {
      console.warn(`⚠ Share image is "${mime || 'unknown'}" (not embeddable) — rendering card without the photo.`)
      return ''
    }
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch (err) {
    console.warn('⚠ Share image fetch failed — rendering card without the photo:', err.message)
    return ''
  }
}

async function liveData() {
  if (!SUPABASE_URL || !ANON) {
    console.warn('⚠ No Supabase env — rendering the fallback card (no photo / reach).')
    return { name: 'simxmargo', photo: '', tokens: [], reach: '', accent: '' }
  }
  const headers = { apikey: ANON, Authorization: `Bearer ${ANON}` }
  try {
    const [socialsRes, profileRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/social_stats?select=followers&order=followers.desc`, { headers }),
      fetch(
        `${SUPABASE_URL}/rest/v1/public_profile?select=display_name,total_followers,niche,location,seo,theme,avatar_url&id=eq.1`,
        { headers },
      ),
    ])
    const socials = socialsRes.ok ? await socialsRes.json() : []
    const profile = profileRes.ok ? (await profileRes.json())[0] ?? {} : {}

    // totalReach(): the manual override wins when set, else the sum of all platforms.
    const sum = socials.reduce((acc, s) => acc + Number(s.followers || 0), 0)
    const total = profile.total_followers != null ? Number(profile.total_followers) : sum

    // Eyebrow tokens mirror the hero: [location, ...every niche token].
    const nicheTokens = String(profile.niche || '')
      .split('·')
      .map((t) => t.trim())
      .filter(Boolean)
    const tokens = [profile.location, ...nicheTokens].map((t) => String(t || '').trim()).filter(Boolean)

    // The uploaded "Social share image" lives in seo.og_image_url (snake — the key the
    // app writes/reads); avatar is the fallback. (Previously read the camelCase key by
    // mistake and always fell back to the avatar.)
    const seo = profile.seo || {}
    const theme = profile.theme || {}
    const photo = await fetchImageDataUri(seo.og_image_url || profile.avatar_url || '')

    return {
      name: profile.display_name || 'simxmargo',
      photo,
      tokens,
      reach: total > 0 ? formatCount(total) : '',
      accent: typeof theme.accent === 'string' ? theme.accent : '',
    }
  } catch (err) {
    console.warn('⚠ Live read failed — rendering the fallback card:', err.message)
    return { name: 'simxmargo', photo: '', tokens: [], reach: '', accent: '' }
  }
}

const data = await liveData()

const svg = await satori(ogCard(data), {
  ...OG_SIZE,
  fonts: [
    { name: 'Druk Wide', data: font('DrukWideBold.ttf'), weight: 700, style: 'normal' },
    { name: 'Archivo', data: font('archivo-600.woff'), weight: 600, style: 'normal' },
    { name: 'Archivo', data: font('archivo-400.woff'), weight: 400, style: 'normal' },
  ],
})

const png = new Resvg(svg, { fitTo: { mode: 'width', value: OG_SIZE.width } }).render().asPng()
writeFileSync(join(root, 'public', 'og.png'), png)
console.log(
  `✓ public/og.png — reach=${data.reach || '(none)'} · photo=${data.photo ? 'yes' : 'no'} · tokens=[${data.tokens.join(', ')}] · ${png.length} bytes`,
)
