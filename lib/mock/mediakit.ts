import type { MediaKitData, PortfolioBrand, PublicProfile, SocialStat } from '@/lib/mediakit-types'

// Mock mediakit data so the public page is fully designable before the live
// Supabase reads (Phase 4). Mirrors the seeded DB rows (social stats are the real
// numbers: TikTok 2.7M / IG 1.3M / FB 394k). Brands are the real partners visible
// on beacons.ai/simxmargo/mediakit. Logos are intentionally empty → BrandCard
// renders a styled monogram fallback (no external image deps in the shell).

export const mockProfile: PublicProfile = {
  displayName: 'simxmargo',
  handle: '@simxmargo',
  tagline: 'Fashion, beauty & everyday inspiration — for brands that want to feel real.',
  bioMd:
    'Simone Marie Golez is a Filipino lifestyle content creator specializing in fashion, beauty, editing, and day-to-day inspiration. She creates engaging digital content that blends aesthetics with authenticity, letting brands connect meaningfully with her audience.',
  avatarUrl: '',
  heroImageUrl: '',
  faviconUrl: '',
  location: 'Philippines',
  niche: 'Photography & Videography · Fashion & Styling',
  audience: '',
  replyToEmail: '',
  mailingAddress: '',
  mediaKitUrl: '',
  totalFollowers: null, // computed from socials → 4.394M
  rateCard: [
    { deliverable: 'TikTok video (1 × 30–60s)', price: 'from $1,200', note: 'concept, shoot, edit' },
    { deliverable: 'Instagram Reel + 3 Stories', price: 'from $950', note: 'usage 30 days' },
    { deliverable: 'UGC bundle (3 videos)', price: 'from $1,800', note: 'no posting, brand-owned' },
    { deliverable: 'Ambassadorship (monthly)', price: "let's talk", note: 'ongoing partnership' },
  ],
  showRates: true,
  showRatesSection: true,
  pressLogos: [],
  seo: {
    title: 'simxmargo — Media Kit',
    description: 'Fashion & beauty creator across TikTok, Instagram & Facebook. Collab with simxmargo.',
  },
  isPublished: true,
}

export const mockSocials: SocialStat[] = [
  {
    platform: 'tiktok', handle: '@simxmargo', profileUrl: 'https://tiktok.com/@simxmargo',
    followers: 2_700_000, avgViews: 480_000, engagementRate: 7.4, growth30d: 3.1,
    history: [
      { date: '2026-01', followers: 2_400_000 }, { date: '2026-02', followers: 2_480_000 },
      { date: '2026-03', followers: 2_550_000 }, { date: '2026-04', followers: 2_610_000 },
      { date: '2026-05', followers: 2_660_000 }, { date: '2026-06', followers: 2_700_000 },
    ],
  },
  {
    platform: 'instagram', handle: '@simxmargo', profileUrl: 'https://instagram.com/simxmargo',
    followers: 1_300_000, avgViews: 210_000, engagementRate: 5.8, growth30d: 2.2,
    history: [
      { date: '2026-01', followers: 1_180_000 }, { date: '2026-02', followers: 1_210_000 },
      { date: '2026-03', followers: 1_240_000 }, { date: '2026-04', followers: 1_265_000 },
      { date: '2026-05', followers: 1_285_000 }, { date: '2026-06', followers: 1_300_000 },
    ],
  },
  {
    platform: 'facebook', handle: 'simxmargo', profileUrl: 'https://facebook.com/simxmargo',
    followers: 394_000, avgViews: 88_000, engagementRate: 4.1, growth30d: 1.4,
    history: [
      { date: '2026-01', followers: 360_000 }, { date: '2026-02', followers: 368_000 },
      { date: '2026-03', followers: 376_000 }, { date: '2026-04', followers: 383_000 },
      { date: '2026-05', followers: 389_000 }, { date: '2026-06', followers: 394_000 },
    ],
  },
]

const featured = (over: Partial<PortfolioBrand> & Pick<PortfolioBrand, 'id' | 'brand' | 'category'>): PortfolioBrand => ({
  website: '', logoUrl: '', blurb: '', campaignTitle: '', metrics: {}, media: [], featured: false, ...over,
})

export const mockBrands: PortfolioBrand[] = [
  featured({
    id: 'b_lacemade', brand: 'LaceMade', category: 'fashion', featured: true,
    website: 'lacemade.com', campaignTitle: 'Spring Lace Capsule',
    blurb: 'Feminine, romantic ready-to-wear — styled across a 3-look TikTok series and IG Reels.',
    metrics: { reach: '1.9M', views: '740K', engagement: '8.2%', deliverables: ['1 TikTok', '1 Reel', '4 Stories'] },
  }),
  featured({
    id: 'b_fashionnova', brand: 'Fashion Nova', category: 'fashion', featured: true,
    website: 'fashionnova.com', campaignTitle: 'OOTD Drop',
    blurb: 'Trend-led fast fashion hauls and styling for a Gen-Z audience.',
    metrics: { reach: '2.4M', views: '1.1M', engagement: '6.9%', deliverables: ['2 TikToks', '5 Stories'] },
  }),
  featured({
    id: 'b_ohpolly', brand: 'Oh Polly', category: 'fashion', featured: true,
    website: 'ohpolly.com', campaignTitle: 'Occasionwear Edit',
    blurb: 'Going-out and occasionwear styling with a glossy editorial treatment.',
    metrics: { reach: '1.5M', views: '620K', engagement: '7.7%', deliverables: ['1 Reel', '1 TikTok'] },
  }),
  featured({
    id: 'b_beautyplus', brand: 'BeautyPlus App', category: 'beauty', featured: true,
    website: 'beautyplus.com', campaignTitle: 'Edit Like Me',
    blurb: 'Tutorial-style content showing real editing workflows — a strong fit for her editing niche.',
    metrics: { reach: '2.1M', views: '980K', engagement: '9.0%', deliverables: ['1 TikTok tutorial'] },
  }),
  featured({ id: 'b_kapicam', brand: 'Kapi Cam', category: 'app', website: 'kapi.cam', blurb: 'Retro camera app — playful day-in-the-life content.' }),
  featured({ id: 'b_flighthouse', brand: 'Flighthouse', category: 'media', website: 'flighthouse.com', blurb: 'Entertainment media collab amplifying short-form trends.' }),
  featured({ id: 'b_chnge', brand: 'CHNGE', category: 'fashion', website: 'chnge.com', blurb: 'Sustainable basics with a values-led message.' }),
  featured({ id: 'b_glowmode', brand: 'Glowmode', category: 'fashion', website: 'glowmode.com', blurb: 'Activewear styling and movement content.' }),
  featured({ id: 'b_filmora', brand: 'Filmora', category: 'app', website: 'filmora.wondershare.com', blurb: 'Editing software walkthroughs for creators.' }),
  featured({ id: 'b_fashionchingu', brand: 'Fashion Chingu', category: 'fashion', website: 'fashionchingu.com', blurb: 'K-fashion hauls and styling.' }),
  featured({ id: 'b_oldroll', brand: 'OldRoll Cam', category: 'app', website: 'oldroll.com', blurb: 'Vintage film-camera aesthetic content.' }),
  featured({ id: 'b_vivavideo', brand: 'VivaVideo', category: 'app', website: 'vivavideo.tv', blurb: 'Mobile video editing features showcase.' }),
]

export const mockMediaKit: MediaKitData = {
  profile: mockProfile,
  socials: mockSocials,
  brands: mockBrands,
}
