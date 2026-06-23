// Runs supabase/seed_dev.sql against the project via the Management API (same
// IPv4-safe path as db-apply). The seed is idempotent. Usage: npm run db:seed
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, requireToken } from './sb.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = loadEnv()
const token = requireToken(env)
const ref = env.SUPABASE_PROJECT_REF
const sql = readFileSync(join(root, 'supabase', 'seed_dev.sql'), 'utf8')

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
})
const text = await res.text()
if (!res.ok) {
  console.error('✖ SEED FAILED:', text.slice(0, 500))
  process.exit(1)
}
console.log('✓ Applied supabase/seed_dev.sql')
