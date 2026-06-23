// Per-repo Supabase CLI wrapper.
//
// Loads THIS repo's .env and injects SUPABASE_ACCESS_TOKEN (+ SUPABASE_DB_PASSWORD)
// into the environment, then runs the Supabase CLI with whatever args you pass.
// The env-var token OVERRIDES the machine-global `supabase login`, so this repo
// always talks to the brand-outreach account even while HABITS/Momma are logged
// in elsewhere. Work multiple Supabase projects at once, no re-login needed.
//
//   npm run sb -- projects list          # uses THIS repo's account
//   npm run sb -- migration list --linked
//
// (the `--` passes the rest through to `supabase`)
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export function loadEnv() {
  const env = {}
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
      if (line.trimStart().startsWith('#')) continue
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) env[m[1]] = m[2]
    }
  } catch {
    /* no .env — fall through to the token check below */
  }
  return env
}

// A real PAT is `sbp_` + 40 hex chars. Reject the redacted placeholder so a
// misconfigured repo fails loudly instead of hitting the API with a junk token.
export function requireToken(env) {
  const t = env.SUPABASE_ACCESS_TOKEN
  if (!t || /REDACTED|PASTE|^$/.test(t)) {
    console.error(
      '✖ SUPABASE_ACCESS_TOKEN is missing or still the placeholder in .env.\n' +
        '  Create one at https://supabase.com/dashboard/account/tokens (on the\n' +
        '  brand-outreach account) and set SUPABASE_ACCESS_TOKEN=sbp_... in .env.',
    )
    process.exit(1)
  }
  return t
}

// Only run the CLI when invoked directly (not when imported by db-apply.mjs).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sb.mjs')) {
  const env = loadEnv()
  const token = requireToken(env)
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const res = spawnSync(npx, ['-y', 'supabase', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token, SUPABASE_DB_PASSWORD: env.SUPABASE_DB_PASSWORD ?? '' },
  })
  process.exit(res.status ?? 1)
}
