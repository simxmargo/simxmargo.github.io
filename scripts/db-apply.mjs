// Apply supabase/migrations/*.sql to the remote project via the Supabase
// Management API (HTTPS POST to /v1/projects/{ref}/database/query).
//
// Why not `supabase db push` / raw `pg`? On this machine the direct DB host
// (db.<ref>.supabase.co:5432) is IPv6-only and won't resolve, and the IPv4
// pooler presents a private-CA cert. The Management API runs over plain HTTPS to
// api.supabase.com, so it sidesteps both. Our migrations are idempotent
// (`create ... if not exists`, `add column if not exists`) → safe to re-run.
//
//   npm run db:apply
//
// NOTE: this does NOT write Supabase's migration-history table. It's the
// get-it-running / one-off apply path. For tracked migrations on an IPv6-capable
// network, use `npm run db:push` instead (see README).
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, requireToken } from './sb.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.supabase.com/v1'

const env = loadEnv()
const token = requireToken(env)
const ref = env.SUPABASE_PROJECT_REF
if (!ref) {
  console.error('✖ SUPABASE_PROJECT_REF missing in .env')
  process.exit(1)
}

// Run one SQL statement-batch against the project. Returns parsed JSON rows.
async function runSql(query) {
  const res = await fetch(`${API}/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const dir = join(root, 'supabase', 'migrations')
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

if (!files.length) {
  console.error('✖ No .sql files in supabase/migrations/')
  process.exit(1)
}

console.log(`Applying ${files.length} migration(s) to project ${ref} via Management API:\n`)
try {
  for (const f of files) {
    await runSql(readFileSync(join(dir, f), 'utf8'))
    console.log(`  ✓ ${f}`)
  }
  const tables = await runSql(
    `select table_name from information_schema.tables
     where table_schema = 'public' order by table_name`,
  )
  const names = Array.isArray(tables) ? tables.map((r) => r.table_name) : tables
  console.log('\nPublic tables now present:', Array.isArray(names) ? names.join(', ') : names)
  console.log('Done.')
} catch (err) {
  console.error('\n✖ MIGRATION FAILED:', err.message)
  if (/401|403/.test(err.message)) {
    console.error('  → The PAT is invalid or lacks access to this project. Check the account/token.')
  }
  process.exit(1)
}
