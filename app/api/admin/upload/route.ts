import { requireAdmin } from '@/lib/requireAdmin'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

// Admin image upload → Supabase Storage. The whole app otherwise uses hosted
// URLs (portfolio logos, brand media are scraped), so this is the one place a
// file becomes a URL. Used by the ProfileEditor ImageField for avatar/hero
// portraits. Node runtime (requireAdmin needs node:crypto; also we read the
// service-role key here). requireAdmin gates it; the service-role client bypasses
// RLS, and the bucket is public-read, so no policy SQL is needed.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'media'
const MAX_BYTES = 8 * 1024 * 1024 // 8 MB
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
}

// Create the public bucket on first use so the feature is self-contained (no
// separate infra step). Idempotent: a 409/"already exists" is success.
async function ensureBucket(sb: ReturnType<typeof getSupabaseAdmin>) {
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: [...ALLOWED],
  })
  // Tolerate the race / pre-existing bucket; surface anything else.
  if (error && !/exist/i.test(error.message)) throw new Error(error.message)
}

// "Portrait 2.PNG" → "portrait-2" (the extension is re-derived from the mime).
function slugify(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'image'
  )
}

export async function POST(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  let sb
  try {
    sb = getSupabaseAdmin()
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 503 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'Expected multipart/form-data with a "file" field.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file provided.' }, { status: 400 })
  }
  if (!ALLOWED.has(file.type)) {
    return Response.json(
      { error: `Unsupported type "${file.type || 'unknown'}". Use JPG, PNG, WebP, AVIF or GIF.` },
      { status: 400 },
    )
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `Image is too large (max ${MAX_BYTES / 1024 / 1024}MB).` }, { status: 400 })
  }

  // Optional folder hint from the client (e.g. "portraits"); sanitised, defaulted.
  const folderRaw = form.get('folder')
  const folder = typeof folderRaw === 'string' ? slugify(folderRaw) : 'uploads'
  const path = `${folder}/${Date.now()}-${slugify(file.name)}.${EXT[file.type]}`

  try {
    await ensureBucket(sb)
  } catch (e) {
    return Response.json({ error: `Storage not ready: ${(e as Error).message}` }, { status: 500 })
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  })
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 })

  const { data } = sb.storage.from(BUCKET).getPublicUrl(path)
  return Response.json({ url: data.publicUrl, path })
}
