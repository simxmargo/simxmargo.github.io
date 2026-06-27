// `collab` Edge Function — public "Work with me" submissions → collab_inquiries.
//
// This is the static-host (GitHub Pages) stand-in for app/api/collab/route.ts: the
// exported site has no Next server, so the public media-kit form POSTs here instead
// (selected via NEXT_PUBLIC_COLLAB_ENDPOINT; locally it still hits /api/collab).
// Behavior is preserved 1:1 with the route handler — honeypot, server-side
// validation mirroring the DB CHECKs, and a salted SHA-256 of the caller IP (the
// raw IP is never stored). Inserts with the ANON key, so RLS is the boundary (the
// policy only allows status='new' + a non-empty message).
//
// Deploy:  npm run sb -- functions deploy collab --no-verify-jwt
//   --no-verify-jwt because this is a PUBLIC endpoint; the honeypot + RLS + DB
//   CHECKs are the protection, not a JWT. Supabase auto-injects SUPABASE_URL +
//   SUPABASE_ANON_KEY into the function env — no secrets to set.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { json, preflight } from '../_shared/http.ts'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const IP_SALT = 'simxmargo-collab-v1' // not a secret; just so stored hashes aren't a plain-IP rainbow lookup

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: Record<string, unknown> | null = null
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  if (!body) return json({ error: 'Empty body' }, 400)

  // Honeypot: a bot fills the hidden "website" field. Pretend success, store nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return json({ ok: true })
  }

  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim()
  const message = String(body.message ?? '').trim()
  if (name.length < 1 || name.length > 120) return json({ error: 'Please enter your name.' }, 400)
  if (!EMAIL_RE.test(email)) return json({ error: 'Please enter a valid email.' }, 400)
  if (message.length < 1 || message.length > 4000) return json({ error: 'Please include a message.' }, 400)

  const deliverables = Array.isArray(body.deliverables) ? body.deliverables.map(String).slice(0, 20) : []
  const ipRaw = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim()
  const ipHash = ipRaw ? (await sha256Hex(ipRaw + IP_SALT)).slice(0, 32) : ''

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error } = await supabase.from('collab_inquiries').insert({
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
    return json({ error: 'Could not submit right now. Please email me directly.' }, 502)
  }
  return json({ ok: true })
})
