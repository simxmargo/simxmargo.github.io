// AI fit-scoring — ported from the original `brand-outreach` Python CLI
// (brand_outreach/qualify.py). The valuable part carried over verbatim: forced
// tool-use with an enum-constrained 1-10 score + clamping, which guarantees
// structured output. Re-aimed from "marketing agencies" to "fashion brands".
//
// Dependency-free: calls Anthropic's Messages API directly via fetch (ideal for
// a Deno Edge Function — no SDK bundle needed). The API key stays server-side.

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001' // cheap + fast for bulk scoring
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MAX_TOKENS = 300 // the reply is just a tiny tool-call payload

// The brand fields the scorer needs. Mirrors the studio `Contact` shape.
export interface ScoreInput {
  brand: string
  website?: string
  country?: string
  emailType?: string
}

// The creator profile (from app_settings.profile). All optional so a partial
// profile still scores.
export interface ProfileInput {
  name?: string
  niche?: string
  followers?: string
  avgViews?: string
  engagement?: string
  audience?: string
}

export interface FitResult {
  fitScore: number // 1 (poor) .. 10 (excellent)
  reason: string
}

export class QualifyError extends Error {}

// The tool the model is forced to call — enum + required fields constrain the
// output; coerceScore() defends against anything unexpected.
const QUALIFIER_TOOL = {
  name: 'record_brand_fit',
  description: 'Record how well a fashion brand fits the creator for a collab pitch.',
  input_schema: {
    type: 'object',
    properties: {
      fit_score: {
        type: 'integer',
        enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        description: '1 (poor fit) to 10 (excellent fit) for the creator pitching this brand.',
      },
      reason: {
        type: 'string',
        description: 'One concise sentence explaining the score.',
      },
    },
    required: ['fit_score', 'reason'],
    additionalProperties: false,
  },
}

function profileToText(p: ProfileInput): string {
  return [
    `Name: ${p.name || 'a creator'}`,
    `Niche: ${p.niche || 'beauty/fashion/lifestyle'}`,
    `Audience size: ${p.followers || 'n/a'}`,
    `Typical reach: ${p.avgViews || 'n/a'} views/post`,
    `Engagement: ${p.engagement || 'n/a'}`,
    `Audience: ${p.audience || 'n/a'}`,
  ].join('\n')
}

function coerceScore(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10)
  if (Number.isNaN(n)) return 1
  return Math.max(1, Math.min(10, Math.round(n)))
}

export async function scoreBrandFit(
  input: ScoreInput,
  profile: ProfileInput,
  apiKey: string,
): Promise<FitResult> {
  if (!apiKey) throw new QualifyError('Missing ANTHROPIC_API_KEY')

  const prompt =
    'You are helping a beauty/fashion/lifestyle creator decide which brands are ' +
    'worth pitching for paid collabs and ambassadorships.\n\n' +
    `CREATOR PROFILE:\n${profileToText(profile)}\n\n` +
    `BRAND:\nName: ${input.brand}\nWebsite: ${input.website || 'n/a'}\n` +
    `Country: ${input.country || 'n/a'}\nContact type: ${input.emailType || 'n/a'}\n\n` +
    'Score how well this brand fits the creator (1-10) and give a one-sentence ' +
    'reason. Reward brands in beauty/fashion/lifestyle that work with creators and ' +
    'sell to the creator’s audience/markets; penalize unrelated or mismatched brands.'

  let resp: Response
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        tools: [QUALIFIER_TOOL],
        tool_choice: { type: 'tool', name: 'record_brand_fit' }, // force the tool
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  } catch (err) {
    throw new QualifyError(`Could not reach Anthropic: ${err}`)
  }

  if (!resp.ok) {
    const body = await resp.text()
    throw new QualifyError(`Anthropic API error (HTTP ${resp.status}): ${body.slice(0, 200)}`)
  }

  const data = await resp.json()
  // With tool_choice forcing the tool, the response carries a tool_use block.
  for (const block of data.content ?? []) {
    if (block.type === 'tool_use') {
      const out = block.input ?? {}
      const reason = String(out.reason ?? '').trim() || 'No reason provided.'
      return { fitScore: coerceScore(out.fit_score), reason }
    }
  }
  throw new QualifyError('Anthropic response did not contain a tool_use result.')
}
