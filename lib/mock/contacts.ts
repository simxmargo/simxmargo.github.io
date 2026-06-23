import type { Contact } from '../types'

// Mock data so the UI is fully usable before the scraper/Supabase are wired.
// Mix of mid-size/DTC brands (best reply odds) and a couple of big names, with
// varied statuses, countries, email types, and fit scores.
export const mockContacts: Contact[] = [
  {
    id: 'c_001', brand: 'Reformation', email: 'partnerships@thereformation.com', emailType: 'partnerships',
    country: 'United States', website: 'thereformation.com', fitScore: 9,
    fitReason: 'Sustainable womenswear with a young, fashion-forward IG audience — strong overlap.',
    status: 'new', notes: '', lastEmailedAt: null, createdAt: '2026-06-10T09:00:00Z',
  },
  {
    id: 'c_002', brand: 'Glossier', email: 'press@glossier.com', emailType: 'press',
    country: 'United States', website: 'glossier.com', fitScore: 8,
    fitReason: 'Beauty brand built on creator content; press inbox monitored for collabs.',
    status: 'new', notes: '', lastEmailedAt: null, createdAt: '2026-06-10T09:01:00Z',
  },
  {
    id: 'c_003', brand: 'Gymshark', email: 'influencers@gymshark.com', emailType: 'named',
    country: 'United Kingdom', website: 'gymshark.com', fitScore: 7,
    fitReason: 'Heavy influencer program; lifestyle/fitness lean fits part of your content.',
    status: 'queued', notes: 'Pitch the athleisure angle.', lastEmailedAt: null, createdAt: '2026-06-09T12:00:00Z',
  },
  {
    id: 'c_004', brand: 'Frank Body', email: 'hello@frankbody.com', emailType: 'generic',
    country: 'Australia', website: 'frankbody.com', fitScore: 8,
    fitReason: 'Skincare DTC with playful creator-led marketing; SEA audience is a plus.',
    status: 'new', notes: '', lastEmailedAt: null, createdAt: '2026-06-10T09:03:00Z',
  },
  {
    id: 'c_005', brand: 'Mejuri', email: 'partnerships@mejuri.com', emailType: 'partnerships',
    country: 'Canada', website: 'mejuri.com', fitScore: 8,
    fitReason: 'Everyday fine jewelry; strong fit for OOTD/lifestyle styling content.',
    status: 'sent', notes: 'Sent 2026-06-12.', lastEmailedAt: '2026-06-12T03:00:00Z', createdAt: '2026-06-08T10:00:00Z',
  },
  {
    id: 'c_006', brand: 'Dr. Jart+', email: 'info@drjart.com', emailType: 'generic',
    country: 'United States', website: 'drjart.com', fitScore: 6,
    fitReason: 'K-beauty skincare; relevant niche but large brand, generic inbox.',
    status: 'new', notes: '', lastEmailedAt: null, createdAt: '2026-06-10T09:05:00Z',
  },
  {
    id: 'c_007', brand: 'Princess Polly', email: 'collabs@princesspolly.com', emailType: 'named',
    country: 'Australia', website: 'princesspolly.com', fitScore: 9,
    fitReason: 'Gen-Z fashion, dedicated collabs inbox, exactly your demographic.',
    status: 'replied', notes: 'Replied — asked for media kit!', lastEmailedAt: '2026-06-11T02:00:00Z', createdAt: '2026-06-07T10:00:00Z',
  },
  {
    id: 'c_008', brand: 'The Inkey List', email: 'press@theinkeylist.com', emailType: 'press',
    country: 'United Kingdom', website: 'theinkeylist.com', fitScore: 7,
    fitReason: 'Affordable skincare popular with beauty creators; press inbox.',
    status: 'new', notes: '', lastEmailedAt: null, createdAt: '2026-06-10T09:07:00Z',
  },
  {
    id: 'c_009', brand: 'Sézane', email: 'contact@sezane.com', emailType: 'generic',
    country: 'Ireland', website: 'sezane.com', fitScore: 7,
    fitReason: 'French-inspired fashion with EU/IE presence; elevated lifestyle fit.',
    status: 'new', notes: '', lastEmailedAt: null, createdAt: '2026-06-10T09:08:00Z',
  },
  {
    id: 'c_010', brand: 'Aritzia', email: 'pr@aritzia.com', emailType: 'press',
    country: 'Canada', website: 'aritzia.com', fitScore: 6,
    fitReason: 'Popular everyday fashion; bigger brand, PR inbox — worth a shot.',
    status: 'skip', notes: 'Too big, low reply odds — deprioritized.', lastEmailedAt: null, createdAt: '2026-06-09T08:00:00Z',
  },
  {
    id: 'c_011', brand: 'Youth To The People', email: 'partnerships@youthtothepeople.com', emailType: 'partnerships',
    country: 'United States', website: 'youthtothepeople.com', fitScore: 8,
    fitReason: 'Clean skincare, creator-friendly, clear partnerships contact.',
    status: 'new', notes: '', lastEmailedAt: null, createdAt: '2026-06-10T09:10:00Z',
  },
  {
    id: 'c_012', brand: 'Monica Vinader', email: 'hello@monicavinader.com', emailType: 'generic',
    country: 'United Kingdom', website: 'monicavinader.com', fitScore: 7,
    fitReason: 'Demi-fine jewelry; styling content fit, UK-based.',
    status: 'new', notes: '', lastEmailedAt: null, createdAt: '2026-06-10T09:11:00Z',
  },
]
