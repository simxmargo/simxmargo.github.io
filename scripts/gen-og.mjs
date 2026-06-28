// Generate public/og.png from LIVE data, at deploy time.
//
// The site is a static GitHub Pages export, so social crawlers read a frozen og.png.
// This script — run in the Pages workflow BEFORE `next build` — re-renders that card
// from the current Supabase data (total reach = the site's totalReach: the
// total_followers override if set, else the sum of all platforms) so the share
// thumbnail never goes stale. satori draws the text as vector paths; resvg rasterizes.
//
//   node scripts/gen-og.mjs
//
// Env: NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (CI passes them; a
// local run falls back to .env). Degrades gracefully — if data can't be read, the
// card renders without the follower line rather than failing the build.
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

const PLATFORM_LABEL = {
  tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook',
  youtube: 'YouTube', x: 'X', twitch: 'Twitch',
}

// Mirror lib/mediakit-types formatCount so the card matches the on-site numbers.
function formatCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

async function liveReach() {
  if (!SUPABASE_URL || !ANON) {
    console.warn('⚠ No Supabase env — rendering card without the follower line.')
    return { reach: '', platforms: [] }
  }
  const headers = { apikey: ANON, Authorization: `Bearer ${ANON}` }
  try {
    const [socialsRes, profileRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/social_stats?select=platform,followers&order=followers.desc`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/public_profile?select=total_followers&id=eq.1`, { headers }),
    ])
    const socials = socialsRes.ok ? await socialsRes.json() : []
    const profile = profileRes.ok ? (await profileRes.json())[0] ?? {} : {}
    const sum = socials.reduce((acc, s) => acc + Number(s.followers || 0), 0)
    // totalReach(): the manual override wins when set, else the sum of all platforms.
    const total = profile.total_followers != null ? Number(profile.total_followers) : sum
    return {
      reach: total > 0 ? formatCount(total) : '',
      platforms: socials.map((s) => PLATFORM_LABEL[s.platform] || s.platform),
    }
  } catch (err) {
    console.warn('⚠ Live read failed — rendering card without the follower line:', err.message)
    return { reach: '', platforms: [] }
  }
}

const { reach, platforms } = await liveReach()

const svg = await satori(
  ogCard({ name: 'simxmargo', descriptor: 'Fashion & beauty creator', reach, platforms }),
  {
    ...OG_SIZE,
    fonts: [
      { name: 'Bodoni Moda', data: font('bodoni-700.woff'), weight: 700, style: 'normal' },
      { name: 'Archivo', data: font('archivo-600.woff'), weight: 600, style: 'normal' },
      { name: 'Archivo', data: font('archivo-400.woff'), weight: 400, style: 'normal' },
    ],
  },
)

const png = new Resvg(svg, { fitTo: { mode: 'width', value: OG_SIZE.width } }).render().asPng()
writeFileSync(join(root, 'public', 'og.png'), png)
console.log(`✓ public/og.png — reach=${reach || '(none)'} · platforms=[${platforms.join(', ')}] · ${png.length} bytes`)
