// Client-side regeneration of the OpenGraph share card.
//
// WHY THIS EXISTS: the public site is a static GitHub Pages export, so its og:image
// meta tag is FROZEN at deploy time. To let the admin change the share card WITHOUT a
// redeploy, app/page.tsx points og:image at a STABLE Supabase Storage URL
// (media/og/card.png), and this module re-renders + OVERWRITES that file whenever the
// admin saves. Crawlers re-fetch the same URL and get the new card (modulo their own
// embed cache — re-shares can still lag, which no one can defeat for an unchanged URL).
//
// WHY CANVAS, NOT SATORI: reusing lib/og/ogCard.mjs in the browser would pull satori's
// yoga-wasm layout engine + a wasm rasterizer into the client bundle for ONE fixed
// card. The Canvas 2D API renders it in ~a dozen draw calls with no wasm and no new
// deps. The constants below MIRROR lib/og/ogCard.mjs (the satori design the CI fallback
// still uses) — keep the two in sync if the card design changes.

import { supabaseBrowser } from '@/lib/supabase/browser'
import { formatCount } from '@/lib/mediakit-types'

// Canvas + palette — mirrors lib/og/ogCard.mjs.
const W = 1200
const H = 630
const INK = '#f6f1e7'
const FAINT = 'rgba(246,241,231,0.74)'
const FALLBACK_BG = '#0b0a08'
const SCRIM = (a: number) => `rgba(8,7,5,${a})`
const PAD_Y = 76
const PAD_X = 84

const BUCKET = 'media'
const CARD_PATH = 'og/card.png' // the STABLE key og:image points at

export type RegenResult = { ok: true; url: string } | { ok: false; error: string }

interface CardData {
  name: string
  photoUrl: string
  tokens: string[]
  reach: string
  accent: string
}

// --- fonts -----------------------------------------------------------------
// The exact faces the satori card uses, copied to public/og so the browser can fetch
// them. Memoised so repeated saves don't refetch; a failure clears the cache to retry.
let fontsReady: Promise<void> | null = null
function ensureFonts(): Promise<void> {
  if (fontsReady) return fontsReady
  fontsReady = (async () => {
    const defs: Array<[family: string, url: string, weight: string]> = [
      ['Druk Wide', '/og/DrukWideBold.ttf', '700'],
      ['Archivo', '/og/archivo-600.woff', '600'],
      ['Archivo', '/og/archivo-400.woff', '400'],
    ]
    await Promise.all(
      defs.map(async ([family, url, weight]) => {
        const face = new FontFace(family, `url(${url})`, { weight })
        await face.load()
        document.fonts.add(face)
      }),
    )
  })().catch((err) => {
    fontsReady = null
    throw err
  })
  return fontsReady
}

// Load an image CORS-clean so the canvas isn't tainted (Supabase public objects send
// Access-Control-Allow-Origin). A non-CORS / missing image rejects → caller draws the
// photo-less fallback card, exactly like gen-og.mjs degrades.
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('share-image load failed'))
    img.src = url
  })
}

type Sb = NonNullable<typeof supabaseBrowser>

// Same fields + reach logic as gen-og.mjs's liveData(), read from the canonical
// columns. NOTE: the photo key is seo.og_image_url (snake) — the key the app writes
// and reads; gen-og historically read the camelCase key and silently used the avatar.
async function liveData(sb: Sb): Promise<CardData> {
  const [{ data: profile }, { data: socials }] = await Promise.all([
    sb
      .from('public_profile')
      .select('display_name,total_followers,niche,location,seo,theme,avatar_url')
      .eq('id', 1)
      .maybeSingle(),
    sb.from('social_stats').select('followers'),
  ])
  const p = (profile ?? {}) as Record<string, unknown>
  const seo = (p.seo ?? {}) as Record<string, unknown>
  const theme = (p.theme ?? {}) as Record<string, unknown>

  const sum = (Array.isArray(socials) ? socials : []).reduce(
    (acc: number, s: { followers?: number | null }) => acc + Number(s.followers || 0),
    0,
  )
  const total = p.total_followers != null ? Number(p.total_followers) : sum

  const nicheTokens = String(p.niche || '')
    .split('·')
    .map((t) => t.trim())
    .filter(Boolean)
  const tokens = [p.location, ...nicheTokens].map((t) => String(t || '').trim()).filter(Boolean)

  return {
    name: String(p.display_name || 'simxmargo'),
    photoUrl: String(seo.og_image_url || p.avatar_url || ''),
    tokens,
    reach: total > 0 ? formatCount(total) : '',
    accent: typeof theme.accent === 'string' ? theme.accent : '',
  }
}

// --- render ----------------------------------------------------------------
// `letterSpacing` is valid on CanvasRenderingContext2D in modern browsers but missing
// from some TS lib targets — set it through a tiny typed shim rather than `any`.
type SpacedCtx = CanvasRenderingContext2D & { letterSpacing: string }

function drawCard(ctx: CanvasRenderingContext2D, data: CardData, photo: HTMLImageElement | null) {
  const c = ctx as SpacedCtx

  // Base (also the no-photo fallback).
  c.fillStyle = FALLBACK_BG
  c.fillRect(0, 0, W, H)

  if (photo) {
    // Cover-fit the photo full-bleed (max-scale, centred).
    const scale = Math.max(W / photo.width, H / photo.height)
    const dw = photo.width * scale
    const dh = photo.height * scale
    c.drawImage(photo, (W - dw) / 2, (H - dh) / 2, dw, dh)

    // Left scrim — mirrors ogCard's 90deg gradient (keeps the left text legible).
    const g1 = c.createLinearGradient(0, 0, W, 0)
    g1.addColorStop(0, SCRIM(0.95))
    g1.addColorStop(0.32, SCRIM(0.82))
    g1.addColorStop(0.64, SCRIM(0.34))
    g1.addColorStop(1, SCRIM(0.05))
    c.fillStyle = g1
    c.fillRect(0, 0, W, H)

    // Bottom scrim — mirrors ogCard's 0deg gradient (bottom → up, under the reach).
    const g2 = c.createLinearGradient(0, H, 0, 0)
    g2.addColorStop(0, SCRIM(0.8))
    g2.addColorStop(0.36, SCRIM(0.12))
    g2.addColorStop(0.58, SCRIM(0))
    c.fillStyle = g2
    c.fillRect(0, 0, W, H)
  }

  c.textAlign = 'left'

  // Eyebrow tokens (top), dots in the theme accent. e.g. PHILIPPINES · FASHION · BEAUTY
  if (data.tokens.length) {
    c.textBaseline = 'top'
    c.font = '600 25px Archivo'
    c.letterSpacing = '6px'
    const dotColor = data.accent || 'rgba(246,241,231,0.5)'
    let x = PAD_X
    data.tokens.forEach((t, i) => {
      const label = t.toUpperCase()
      if (i > 0) {
        x += 13
        c.fillStyle = dotColor
        c.fillText('·', x, PAD_Y)
        x += c.measureText('·').width + 13
      }
      c.fillStyle = FAINT
      c.fillText(label, x, PAD_Y)
      x += c.measureText(label).width
    })
    c.letterSpacing = '0px'
  }

  // Wordmark (vertically centred), uniform white — no accent on the "x".
  c.textBaseline = 'middle'
  c.font = '700 84px "Druk Wide"'
  c.letterSpacing = '-1px'
  c.fillStyle = INK
  c.fillText(data.name, PAD_X, H / 2)
  c.letterSpacing = '0px'

  // Reach (bottom): big number above a "TOTAL REACH" label.
  if (data.reach) {
    c.textBaseline = 'alphabetic'
    const labelBaseline = H - PAD_Y
    c.font = '600 22px Archivo'
    c.letterSpacing = '5px'
    c.fillStyle = FAINT
    c.fillText('TOTAL REACH', PAD_X, labelBaseline)

    c.letterSpacing = '0px'
    c.font = '700 60px "Druk Wide"'
    c.fillStyle = INK
    c.fillText(data.reach, PAD_X, labelBaseline - 22 - 12)
  }
}

// Re-render the share card from live data and overwrite media/og/card.png.
// Pure runtime/admin action — never throws; returns a typed result for the UI.
export async function regenerateShareCard(): Promise<RegenResult> {
  const sb = supabaseBrowser
  if (!sb) return { ok: false, error: 'Studio is not configured.' }

  try {
    await ensureFonts()
    const data = await liveData(sb)

    let photo: HTMLImageElement | null = null
    if (data.photoUrl) {
      try {
        photo = await loadImage(data.photoUrl)
      } catch {
        photo = null // fall back to the solid card rather than failing the whole regen
      }
    }

    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) return { ok: false, error: 'Canvas is unavailable in this browser.' }
    drawCard(ctx, data, photo)

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) return { ok: false, error: 'Could not encode the card image.' }

    const { error } = await sb.storage.from(BUCKET).upload(CARD_PATH, blob, {
      upsert: true,
      contentType: 'image/png',
      cacheControl: '300', // 5 min — short, so crawlers re-pull soon after a change
    })
    if (error) return { ok: false, error: error.message }

    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(CARD_PATH)
    return { ok: true, url: pub.publicUrl }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to update the share card.' }
  }
}
