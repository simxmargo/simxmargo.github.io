// Full offline backup of the Supabase project (DB rows + auth users + Storage).
//
// WHY: the free-tier project pauses after ~7 days without API activity, and a
// project paused 90+ days is deleted — Supabase keeps ZERO backups on Free.
// The published Pages site survives that by design (localized snapshot), but
// the source data — inbound collab inquiries, every admin edit since seeding,
// outreach contacts, and all uploaded Storage originals — lives ONLY in the
// project. This pulls all of it to local disk so even a deleted project can be
// rebuilt (schema via `npm run db:apply`, data via these dumps).
//
//   npm run backup     →  backups/<stamp>/{db,auth,storage}/… + manifest.json
//
// Read-only: never writes to the project. Needs SUPABASE_SERVICE_ROLE_KEY in
// .env — most tables are RLS `is_admin()` and invisible to the anon key.
//
// ⚠ backups/ is gitignored ON PURPOSE: the repo is PUBLIC and these dumps hold
// PII (inquiry names/emails/messages, outreach contact emails). Never commit
// one; copy the folder somewhere private for long-term keeping.
//
// Restore into a fresh project:
//   1) update .env/.mcp.json with the new ref/keys, then `npm run db:apply`
//      (migrations are idempotent and include the media bucket).
//   2) search-replace the OLD project URL → new one across db/*.json — DB rows
//      embed Storage URLs (avatar/hero/favicon/logo/media[].url/seo).
//   3) POST db/*.json rows via PostgREST with the new service key
//      (`Prefer: resolution=merge-duplicates`; contacts before the tables
//      that FK it; skip admins — see 4).
//   4) recreate the auth user (GoTrue admin API, same email) and insert its
//      NEW uid into admins (the backed-up uid belongs to the old project).
//   5) re-upload storage/media/* under the SAME object paths.
//   6) redeploy Edge Functions + re-set their secrets (never in backups),
//      then update the URL/key hardcoded in pages.yml + keepalive.yml.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './sb.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = loadEnv()

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY || /REDACTED|PASTE/.test(SERVICE_KEY)) {
  console.error(
    '✖ Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.\n' +
      '  The service-role key is required: most tables are RLS-gated to the\n' +
      '  admin and the anon key cannot read them.',
  )
  process.exit(1)
}

const HEADERS = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
const BUCKET = 'media'

// pk per table only for stable pagination ordering.
const TABLES = {
  public_profile: 'id',
  portfolio_brands: 'id',
  social_stats: 'id',
  collab_inquiries: 'id',
  contacts: 'id',
  scrape_jobs: 'id',
  send_queue: 'id',
  suppression_list: 'email',
  app_settings: 'id',
  admins: 'id',
}

const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '').replace('T', '-')
const dest = join(root, 'backups', stamp)

async function dumpTable(name, pk) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${name}?select=*&order=${pk}.asc`, {
      headers: { ...HEADERS, Range: `${from}-${from + 999}` },
    })
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${await res.text()}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < 1000) break
  }
  return rows
}

async function dumpAuthUsers() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers: HEADERS })
  if (!res.ok) throw new Error(`auth users: HTTP ${res.status} ${await res.text()}`)
  const body = await res.json()
  // Keep only what a restore needs to re-create + re-link the admin account.
  return (body.users ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at,
  }))
}

async function listObjects(prefix = '') {
  const paths = []
  for (let offset = 0; ; offset += 100) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
    })
    if (!res.ok) throw new Error(`storage list "${prefix}": HTTP ${res.status} ${await res.text()}`)
    const entries = await res.json()
    for (const e of entries) {
      // Folder placeholders come back without an object id — recurse into them.
      if (e.id == null) paths.push(...(await listObjects(`${prefix}${e.name}/`)))
      else paths.push(`${prefix}${e.name}`)
    }
    if (entries.length < 100) break
  }
  return paths
}

async function downloadObject(path) {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

const manifest = {
  created_at: new Date().toISOString(),
  project_ref: env.SUPABASE_PROJECT_REF ?? new URL(SUPABASE_URL).hostname.split('.')[0],
  tables: {},
  auth_users: 0,
  storage: { bucket: BUCKET, objects: 0, bytes: 0, failed: [] },
}

console.log(`Backing up ${SUPABASE_URL} → backups/${stamp}/`)
mkdirSync(join(dest, 'db'), { recursive: true })

for (const [name, pk] of Object.entries(TABLES)) {
  const rows = await dumpTable(name, pk)
  writeFileSync(join(dest, 'db', `${name}.json`), JSON.stringify(rows, null, 2))
  manifest.tables[name] = rows.length
  console.log(`  db/${name}.json  ${rows.length} rows`)
}

mkdirSync(join(dest, 'auth'), { recursive: true })
const users = await dumpAuthUsers()
writeFileSync(join(dest, 'auth', 'users.json'), JSON.stringify(users, null, 2))
manifest.auth_users = users.length
console.log(`  auth/users.json  ${users.length} users`)

const objects = await listObjects()
for (const path of objects) {
  try {
    const buf = await downloadObject(path)
    const file = join(dest, 'storage', BUCKET, ...path.split('/'))
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, buf)
    manifest.storage.objects += 1
    manifest.storage.bytes += buf.length
  } catch (err) {
    manifest.storage.failed.push({ path, error: String(err?.message ?? err) })
    console.error(`  ✖ storage/${path}: ${err?.message ?? err}`)
  }
}
console.log(
  `  storage/${BUCKET}/  ${manifest.storage.objects}/${objects.length} objects, ` +
    `${(manifest.storage.bytes / 1024 / 1024).toFixed(1)} MB`,
)

writeFileSync(join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2))

if (manifest.storage.failed.length > 0) {
  console.error(`✖ ${manifest.storage.failed.length} storage object(s) failed — backup is INCOMPLETE (see manifest.json).`)
  process.exit(1)
}
console.log('✔ Backup complete. backups/ is gitignored (PII) — copy it somewhere private.')
