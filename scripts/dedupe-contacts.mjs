// Collapse the contacts table to one address per company — READ-ONLY.
//
//   npm run dedupe:contacts
//
// Reads the live table, ranks each company's addresses through the SAME
// lib/outreach/pickEmail.ts the scraper uses, and WRITES A .sql FILE for you to review
// and run. It never executes anything. There is no --apply flag on purpose: this
// deletes rows, and the review step is the safety.
//
// WHY A SCRIPT THAT EMITS SQL, RATHER THAN A MIGRATION
//   Expressing the ranking a second time in plpgsql would create exactly the drift this
//   change exists to remove — the scraper and the cleanup would slowly disagree about
//   which address is best, and nobody would notice until a pitch went to returns@.
//   The ranking runs once, in TypeScript, and the output is plain SQL you can read.
//
// WHAT IT WILL NEVER TOUCH
//   Rows with status 'sent', 'replied', 'inbound' or 'bounced'. Those are history:
//   a send that happened, a brand that answered, an address proven dead. `bounced` in
//   particular is load-bearing — the row is what stops a future scrape re-adding a
//   known-dead address, because contacts.unique(email) makes the upsert a no-op.
//
//   Deleting a contact CASCADES to send_queue (0001_init.sql), so any live queue row
//   for a doomed contact is cancelled first, in the same transaction.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { pickBestEmail, toStoredAlternates } = await import(
  pathToFileURL(join(root, 'lib', 'outreach', 'pickEmail.ts')).href
)

// ── env ─────────────────────────────────────────────────────────────────────────
const env = {}
try {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch {
  console.error('✖ Could not read .env')
  process.exit(1)
}
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_BASE || !KEY) {
  console.error('✖ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env')
  process.exit(1)
}

async function get(path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`)
  return res.json()
}

// Same normaliser the scraper groups on, so "one company" means one thing everywhere.
function normalizeDomain(website) {
  if (!website) return ''
  let s = String(website).trim().toLowerCase()
  if (!/^https?:\/\//.test(s)) s = 'https://' + s
  try {
    return new URL(s).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** History. Never deleted, never demoted. */
const PROTECTED = new Set(['sent', 'replied', 'inbound', 'bounced'])
const DELETABLE = new Set(['new', 'skip', 'queued'])

const sq = (v) => `'${String(v).replace(/'/g, "''")}'`

// ── load ────────────────────────────────────────────────────────────────────────
const contacts = await get(
  'contacts?select=id,brand,email,email_type,website,status,confidence,created_at&limit=10000',
)
console.log(`Read ${contacts.length} contacts.`)

const groups = new Map()
for (const c of contacts) {
  const key = normalizeDomain(c.website) || `id:${c.id}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(c)
}

// ── plan ────────────────────────────────────────────────────────────────────────
const doomed = [] // { id, email, why }
const survivors = [] // { id, email, score, alternates }
const keptProtected = [] // ids we refuse to touch, for the report
let unusableCompanies = 0

for (const [domain, rows] of groups) {
  const brand = rows[0].brand
  const pick = pickBestEmail(
    rows.map((r) => ({ email: r.email, via: 'body' })),
    domain,
    brand,
  )
  const rejectedEmails = new Map(pick.rejected.map((r) => [r.email, r.reason]))

  // Engagement outranks the ranking. If a brand has already been emailed or has
  // answered, that row IS the relationship — promoting a "better" address now would
  // orphan the history and invite a second pitch to a company already in conversation.
  const engaged = rows.find((r) => r.status === 'replied' || r.status === 'inbound')
    ?? rows.find((r) => r.status === 'sent')

  const winnerRow = engaged
    ?? (pick.winner ? rows.find((r) => r.email === pick.winner.email) : undefined)

  if (!winnerRow) {
    // Nothing here is usable — every address belonged to somebody else (font foundries
    // on manhattan-denim.com, a publisher network on thezoereport.com) or was debris.
    unusableCompanies++
  }

  for (const r of rows) {
    if (r.id === winnerRow?.id) continue
    if (PROTECTED.has(r.status)) {
      keptProtected.push(r)
      continue
    }
    if (!DELETABLE.has(r.status)) {
      keptProtected.push(r)
      continue
    }
    const why =
      rejectedEmails.get(r.email) ??
      (winnerRow ? `superseded by ${winnerRow.email}` : 'no usable address for this company')
    doomed.push({ ...r, domain, why })
  }

  if (winnerRow && pick.winner) {
    // Alternates exclude anything being deleted for being unusable — a runner-up you
    // could never send to is not a fallback.
    // The stored shape is {email,type,score} only — the reasons exist to explain a
    // decision to a human reading this script's output, not to live in the database.
    const alts = toStoredAlternates(pick.alternates.filter((a) => a.email !== winnerRow.email))
    const score = winnerRow.email === pick.winner.email ? pick.winner.score : null
    if (alts.length || (score !== null && score !== winnerRow.confidence)) {
      survivors.push({ id: winnerRow.id, email: winnerRow.email, score, alternates: alts })
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────────
const byReason = {}
for (const d of doomed) {
  const bucket = d.why.startsWith('superseded') ? 'superseded (duplicate company)' : d.why
  byReason[bucket] = (byReason[bucket] ?? 0) + 1
}
console.log(`\nCompanies:                    ${groups.size}`)
console.log(`Rows to delete:               ${doomed.length}`)
for (const [why, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(4)}  ${why}`)
}
console.log(`Rows protected (history):     ${keptProtected.length}`)
console.log(`Survivors to re-score:        ${survivors.length}`)
console.log(`Companies with NO usable address: ${unusableCompanies}`)
console.log(`Table after:                  ${contacts.length - doomed.length} rows`)

if (doomed.length === 0 && survivors.length === 0) {
  console.log('\n✓ Nothing to do — the table is already one ranked address per company.')
  process.exit(0)
}

// ── emit SQL ────────────────────────────────────────────────────────────────────
const ids = doomed.map((d) => sq(d.id))
const lines = []
lines.push('-- Generated by scripts/dedupe-contacts.mjs — REVIEW BEFORE RUNNING.')
lines.push('-- Ranking comes from lib/outreach/pickEmail.ts, the same module the scraper uses.')
lines.push('--')
lines.push(`-- Contacts now:   ${contacts.length}`)
lines.push(`-- Deleting:       ${doomed.length}`)
lines.push(`-- Re-scoring:     ${survivors.length}`)
lines.push(`-- Contacts after: ${contacts.length - doomed.length}`)
lines.push('--')
lines.push("-- Rows with status 'sent', 'replied', 'inbound' or 'bounced' are NEVER touched.")
lines.push('--')
lines.push('-- Run migration 0016_contact_alternates.sql FIRST (npm run db:apply) — the')
lines.push('-- UPDATEs below write contacts.alternates, which 0016 creates.')
lines.push('')
lines.push('begin;')
lines.push('')

if (doomed.length) {
  lines.push('-- ── 1. Cancel any live queue row for a contact about to be deleted ──────────')
  lines.push('-- send_queue.contact_id cascades on delete, so an unsent pitch would vanish')
  lines.push('-- silently. Cancelling first leaves a readable reason behind.')
  lines.push('update public.send_queue')
  lines.push("   set status = 'canceled',")
  lines.push("       error  = 'Superseded — a better address was kept for this company.',")
  lines.push('       updated_at = now()')
  lines.push(` where contact_id in (${ids.join(', ')})`)
  lines.push("   and status in ('queued','sending');")
  lines.push('')

  lines.push('-- ── 2. Delete the redundant and unusable rows ───────────────────────────────')
  for (const d of doomed) {
    lines.push(`--  ${d.domain.padEnd(28)} ${d.email.padEnd(42)} [${d.status}] ${d.why}`)
  }
  lines.push('delete from public.contacts')
  lines.push(` where id in (${ids.join(', ')})`)
  lines.push("   and status in ('new','skip','queued');  -- re-checked at execution time")
  lines.push('')
}

if (survivors.length) {
  lines.push('-- ── 3. Record the score and the alternates on the survivor ──────────────────')
  for (const s of survivors) {
    const alts = JSON.stringify(s.alternates)
    const sets = [`alternates = ${sq(alts)}::jsonb`]
    if (s.score !== null) sets.push(`confidence = ${s.score}`)
    lines.push(`update public.contacts set ${sets.join(', ')} where id = ${sq(s.id)};  -- ${s.email}`)
  }
  lines.push('')
}

lines.push('commit;')
lines.push('')
lines.push('-- Verify:')
lines.push("--   select count(*) from public.contacts;")
lines.push('--   select regexp_replace(lower(website), \'^www\\.\', \'\') as company, count(*)')
lines.push('--     from public.contacts group by 1 having count(*) > 1 order by 2 desc;')
lines.push('')

const outDir = join(root, 'supabase', 'cleanup')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'dedupe_contacts.sql')
writeFileSync(outFile, lines.join('\n'), 'utf8')

console.log(`\n✓ Wrote ${outFile}`)
console.log('  Nothing has been changed. Read it, then run it in the Supabase SQL editor.')
