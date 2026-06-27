// Brand glyphs + colors for TikTok / Instagram / Facebook. Inline SVG (no extra
// dependency). Each glyph paints in its brand color by default; Instagram uses its
// signature gradient via an SVG <linearGradient>. Used on the public Reach section
// and the admin Social Stats integrations.

export type BrandKey = 'tiktok' | 'instagram' | 'facebook'

export const BRAND_META: Record<BrandKey, { label: string; color: string }> = {
  // Solid accent colors (used for borders/labels). IG also has a gradient below.
  tiktok: { label: 'TikTok', color: '#FE2C55' },
  instagram: { label: 'Instagram', color: '#E1306C' },
  facebook: { label: 'Facebook', color: '#1877F2' },
}

export const INSTAGRAM_GRADIENT = 'linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)'

interface GlyphProps {
  platform: string
  size?: number
  /** false → inherit currentColor instead of the brand color. */
  colored?: boolean
  className?: string
}

export function BrandGlyph({ platform, size = 20, colored = true, className }: GlyphProps) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', className, 'aria-hidden': true as const }

  if (platform === 'tiktok') {
    return (
      <svg {...common} fill={colored ? BRAND_META.tiktok.color : 'currentColor'}>
        <path d="M16.6 3c.27 1.94 1.37 3.46 3.4 3.6V9.6c-1.18.12-2.2-.27-3.4-.99v6.18a5.7 5.7 0 1 1-5.7-5.7c.2 0 .4.02.6.05v2.93a2.8 2.8 0 1 0 1.95 2.67V3h3.15z" />
      </svg>
    )
  }

  if (platform === 'instagram') {
    const id = 'ig-grad'
    return (
      <svg {...common} fill="none" stroke={colored ? `url(#${id})` : 'currentColor'} strokeWidth={2}>
        {colored && (
          <defs>
            <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#feda75" />
              <stop offset="0.35" stopColor="#fa7e1e" />
              <stop offset="0.6" stopColor="#d62976" />
              <stop offset="0.8" stopColor="#962fbf" />
              <stop offset="1" stopColor="#4f5bd5" />
            </linearGradient>
          </defs>
        )}
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
        <circle cx="12" cy="12" r="4.2" />
        <circle cx="17.3" cy="6.7" r="1.1" fill={colored ? `url(#${id})` : 'currentColor'} stroke="none" />
      </svg>
    )
  }

  if (platform === 'facebook') {
    return (
      <svg {...common} fill={colored ? BRAND_META.facebook.color : 'currentColor'}>
        <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.51 1.49-3.9 3.78-3.9 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.45 2.89h-2.33v6.99A10 10 0 0 0 22 12z" />
      </svg>
    )
  }

  return null
}
