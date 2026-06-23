import { createHash } from 'node:crypto'
import { supabasePublic } from '@/lib/supabase/public'

// Public "Work with me" submissions → collab_inquiries (anon INSERT, RLS-gated:
// the policy only allows status='new' with a non-empty message). Server-side
// validation mirrors the DB CHECKs; the raw IP is hashed (never stored). The
// client also has a honeypot, re-checked here as defense in depth.
export const runtime = 'nodejs'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const IP_SALT = 'simxmargo-collab-v1' // not a secret; just so stored hashes aren't a plain IP rainbow lookup

export async function POST(req: Request) {
  let body: Record<string, unknown> | null = null
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body) return Response.json({ error: 'Empty body' }, { status: 400 })

  // Honeypot: a bot fills the hidden "website" field. Pretend success, store nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return Response.json({ ok: true })
  }

  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim()
  const message = String(body.message ?? '').trim()
  if (name.length < 1 || name.length > 120) return Response.json({ error: 'Please enter your name.' }, { status: 400 })
  if (!EMAIL_RE.test(email)) return Response.json({ error: 'Please enter a valid email.' }, { status: 400 })
  if (message.length < 1 || message.length > 4000)
    return Response.json({ error: 'Please include a message.' }, { status: 400 })

  const deliverables = Array.isArray(body.deliverables) ? body.deliverables.map(String).slice(0, 20) : []
  const ipRaw = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim()
  const ipHash = ipRaw ? createHash('sha256').update(ipRaw + IP_SALT).digest('hex').slice(0, 32) : ''

  const { error } = await supabasePublic.from('collab_inquiries').insert({
    name,
    email,
    company: String(body.company ?? '').slice(0, 160),
    budget: String(body.budget ?? '').slice(0, 120),
    message,
    deliverables,
    source_path: String(body.sourcePath ?? '/'),
    ip_hash: ipHash,
    user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300),
    status: 'new',
  })

  if (error) {
    console.error('[collab] insert failed:', error.message)
    return Response.json({ error: 'Could not submit right now. Please email me directly.' }, { status: 502 })
  }
  return Response.json({ ok: true })
}
