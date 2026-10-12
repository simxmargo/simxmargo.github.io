'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, RotateCcw, PieChart, Plus, Trash2, X } from 'lucide-react'
import { saveProfile } from '@/lib/admin/resources/profile'
import { useAdminResource, adminKeys, type AdminFetchError } from '@/lib/admin/queries'
import { FormSkeleton } from '@/components/admin/Skeleton'
import type { InsightChart, InsightPlatform, Insights, Platform, PublicProfile } from '@/lib/mediakit-types'
import {
  INSIGHT_PLATFORMS,
  INSIGHT_PLATFORM_LABEL,
  safeColor,
  sliceColors,
  formatPercent,
} from '@/lib/mediakit/insights'

// Studio "Insights" tab: audience-demographics pies per platform, shown on the public
// kit. Lives in public_profile.content.insights, written through saveProfile's merge.
// Mirrors ContentEditor's load/save/cache shape.

// Values stay strings while editing so a half-typed "12." isn't coerced away.
interface SliceRow {
  label: string
  value: string
  // Typed colour; blank = automatic.
  color: string
}
interface ChartRow {
  title: string
  slices: SliceRow[]
}
interface InsightsForm {
  enabled: boolean
  charts: Partial<Record<Platform, ChartRow[]>>
  // Saved platforms this editor doesn't offer — passed through untouched on save.
  extra: InsightPlatform[]
}
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const EMPTY_FORM: InsightsForm = { enabled: false, charts: {}, extra: [] }

const emptySlice = (): SliceRow => ({ label: '', value: '', color: '' })

// A colour the browser can actually paint (the stored shape check also lets "banana" through).
function validColor(v: string): string | undefined {
  const c = safeColor(v)
  return c && typeof CSS !== 'undefined' && CSS.supports('color', c) ? c : undefined
}

// Any CSS colour as #rrggbb, which is all the native colour picker accepts.
function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color
  if (typeof document === 'undefined') return '#000000'
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return '#000000'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}
const newChart = (title: string): ChartRow => ({ title, slices: [emptySlice(), emptySlice()] })

// Quick "add chart" presets; the blank one is rendered separately.
const CHART_PRESETS = ['Gender', 'Age', 'Top countries']

/* eslint-disable @typescript-eslint/no-explicit-any */
function toChartRows(raw: any): ChartRow[] {
  if (!Array.isArray(raw)) return []
  return raw.map((c) => ({
    title: String(c?.title ?? ''),
    slices: (Array.isArray(c?.slices) ? c.slices : []).map((s: any) => ({
      label: String(s?.label ?? ''),
      value: s?.value == null ? '' : String(s.value),
      color: typeof s?.color === 'string' ? s.color : '',
    })),
  }))
}

// jsonb is untyped at rest, so read defensively. Every offered platform gets an entry.
function toForm(insights: Insights | undefined): InsightsForm {
  const saved: any[] = Array.isArray(insights?.platforms) ? insights.platforms : []
  const charts: InsightsForm['charts'] = {}
  for (const p of INSIGHT_PLATFORMS) {
    charts[p] = toChartRows(saved.find((s) => s?.platform === p)?.charts)
  }
  return {
    enabled: insights?.enabled === true,
    charts,
    extra: saved.filter((s) => typeof s?.platform === 'string' && !INSIGHT_PLATFORMS.includes(s.platform)),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// A row survives the save only with a label and a positive number.
function isFilled(s: SliceRow): boolean {
  const v = Number(s.value)
  return s.label.trim() !== '' && s.value.trim() !== '' && Number.isFinite(v) && v > 0
}

// Strip empty rows, then charts with no slices; slice order is kept as entered.
function cleanCharts(rows: ChartRow[]): InsightChart[] {
  return rows
    .map((c) => ({
      title: c.title.trim(),
      slices: c.slices.filter(isFilled).map((s) => {
        const color = validColor(s.color)
        return { label: s.label.trim(), value: Number(s.value), ...(color ? { color } : {}) }
      }),
    }))
    .filter((c) => c.slices.length > 0)
}

export function InsightsEditor() {
  const qc = useQueryClient()
  const q = useAdminResource<Partial<PublicProfile>>('profile')

  const [form, setForm] = useState<InsightsForm>(EMPTY_FORM)
  const [save, setSave] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')

  // Seed from the shared cache; stable while cached so revisiting never clobbers edits.
  useEffect(() => {
    if (q.data !== undefined) setForm(toForm(q.data?.content?.insights))
  }, [q.data])

  function touch() {
    if (save !== 'idle') setSave('idle')
  }

  function setCharts(platform: Platform, fn: (charts: ChartRow[]) => ChartRow[]) {
    setForm((f) => ({ ...f, charts: { ...f.charts, [platform]: fn(f.charts[platform] ?? []) } }))
    touch()
  }

  function updateChart(platform: Platform, ci: number, fn: (chart: ChartRow) => ChartRow) {
    setCharts(platform, (charts) => charts.map((c, i) => (i === ci ? fn(c) : c)))
  }

  function updateSlice(platform: Platform, ci: number, si: number, patch: Partial<SliceRow>) {
    updateChart(platform, ci, (c) => ({
      ...c,
      slices: c.slices.map((s, i) => (i === si ? { ...s, ...patch } : s)),
    }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSave('saving')
    setSaveError('')
    // Drop platforms left with no charts; unoffered saved platforms ride along as-is.
    const platforms: InsightPlatform[] = [
      ...INSIGHT_PLATFORMS.map((platform) => ({ platform, charts: cleanCharts(form.charts[platform] ?? []) })).filter(
        (p) => p.charts.length > 0,
      ),
      ...form.extra,
    ]
    const insights: Insights = { enabled: form.enabled, platforms }
    try {
      await saveProfile({ content: { insights } })
      setSave('saved')
      void qc.invalidateQueries({ queryKey: adminKeys.profile })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Couldn’t reach the server. Try again.')
      setSave('error')
    }
  }

  if (q.isLoading) {
    return <FormSkeleton withHeader titleW={150} subW={430} cards={3} fields={2} />
  }

  if (q.isError) {
    const err = q.error as AdminFetchError | null
    return (
      <>
        <header className="main-head">
          <div>
            <h1 className="page-title display">Insights</h1>
            <p className="page-sub">Who your audience is, per platform.</p>
          </div>
        </header>
        <div className="stack">
          <div className="banner banner-error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <div>
              <p style={{ fontWeight: 600, margin: 0 }}>
                {err?.message ?? 'Couldn’t load insights.'}
                {err?.status ? ` (${err.status})` : ''}
              </p>
              <button type="button" onClick={() => void q.refetch()} className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>
                <RotateCcw size={14} aria-hidden="true" /> Retry
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <form onSubmit={onSubmit}>
      <header className="main-head">
        <div>
          <h1 className="page-title display">Insights</h1>
          <p className="page-sub">Audience demographics per platform — shown as pie charts on your public kit.</p>
        </div>
        <button type="submit" disabled={save === 'saving'} className="btn btn-primary">
          {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved ✓' : 'Save changes'}
        </button>
      </header>

      <div className="stack">
        {/* Visibility */}
        <section className="card">
          <div className="card-head" style={{ marginBottom: 0 }}>
            <span className="ico-badge"><PieChart size={18} aria-hidden="true" /></span>
            <div>
              <h2 className="card-title">Insights section</h2>
              <p className="card-sub">Copy the percentages from each platform&rsquo;s own analytics screen.</p>
            </div>
          </div>
          <div className="space-y-3" style={{ marginTop: 14 }}>
            <div className="field-card">
              <div>
                <div className="fc-title">Show Insights section</div>
                <div className="fc-sub">Off hides the whole section from your public page (your numbers stay saved).</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.enabled}
                aria-label="Show the Insights section on the public media kit"
                onClick={() => {
                  setForm((f) => ({ ...f, enabled: !f.enabled }))
                  touch()
                }}
                className="switch"
              >
                <span className="switch-knob" />
              </button>
            </div>
          </div>
        </section>

        {/* One card per offered platform, even when nothing is saved for it yet */}
        {INSIGHT_PLATFORMS.map((platform) => {
          const name = INSIGHT_PLATFORM_LABEL[platform] ?? platform
          const charts = form.charts[platform] ?? []
          return (
            <section key={platform} className="card">
              <div className="card-head" style={{ marginBottom: 0 }}>
                <div>
                  <h2 className="card-title">{name}</h2>
                  <p className="card-sub">
                    {charts.length === 0 ? 'No charts — this platform is left off the public page.' : `${charts.length} ${charts.length === 1 ? 'chart' : 'charts'}`}
                  </p>
                </div>
              </div>

              <div className="card-body">
                <div className="space-y-3">
                  {charts.map((chart, ci) => {
                    const chartName = chart.title.trim() || `chart ${ci + 1}`
                    // Colour only the rows that will be saved, so swatches match the public pie.
                    const kept = chart.slices.filter(isFilled)
                    const colors = sliceColors(
                      kept.map((s) => ({ label: s.label, value: Number(s.value), color: validColor(s.color) })),
                      q.data?.theme?.accent,
                    )
                    const hasCustom = chart.slices.some((s) => s.color.trim() !== '')
                    const total = kept.reduce((sum, s) => sum + Number(s.value), 0)
                    const offTotal = kept.length > 0 && Math.abs(total - 100) > 0.5
                    let keptIdx = 0
                    return (
                      <div
                        key={ci}
                        style={{ background: 'var(--field)', border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}
                      >
                        <div className="flex items-end gap-3">
                          <div className="field" style={{ flex: 1 }}>
                            <label htmlFor={`in-${platform}-${ci}-title`} className="flabel">Chart title</label>
                            <input
                              id={`in-${platform}-${ci}-title`}
                              type="text"
                              value={chart.title}
                              onChange={(e) => updateChart(platform, ci, (c) => ({ ...c, title: e.target.value }))}
                              className="input"
                              placeholder="Gender"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => setCharts(platform, (cs) => cs.filter((_, i) => i !== ci))}
                            aria-label={`Remove ${name} ${chartName}`}
                            className="btn btn-danger btn-sm"
                            style={{ height: 44, width: 44, padding: 0, justifyContent: 'center' }}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </div>

                        <div className="space-y-3" style={{ marginTop: 12 }}>
                          {chart.slices.map((slice, si) => {
                            const color = isFilled(slice) ? colors[keptIdx++] : undefined
                            const rowName = `${name} ${chartName} slice ${si + 1}`
                            const colorBad = slice.color.trim() !== '' && !validColor(slice.color)
                            return (
                              <div key={si} className="grid items-center gap-3 grid-cols-[auto_1fr_6.5rem_auto] sm:grid-cols-[auto_1fr_9.5rem_6.5rem_auto]">
                                {/* Swatch = the colour this slice gets (hollow until the row is filled in).
                                    Clicking it opens the browser's colour picker. */}
                                <label
                                  className="swatch-pick"
                                  title="Pick a colour"
                                  style={{
                                    position: 'relative',
                                    width: 26,
                                    height: 26,
                                    borderRadius: 6,
                                    cursor: 'pointer',
                                    background: color ?? 'transparent',
                                    border: color ? '1px solid var(--line)' : '1px dashed var(--line)',
                                  }}
                                >
                                  <input
                                    type="color"
                                    value={toHex(color ?? validColor(slice.color) ?? '#888888')}
                                    onChange={(e) => updateSlice(platform, ci, si, { color: e.target.value })}
                                    aria-label={`${rowName} colour picker`}
                                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                                  />
                                </label>
                                <input
                                  type="text"
                                  value={slice.label}
                                  onChange={(e) => updateSlice(platform, ci, si, { label: e.target.value })}
                                  aria-label={`${rowName} label`}
                                  className="input"
                                  placeholder="Label"
                                />
                                {/* Any CSS colour: #hex, rgb(), hsl(), a name. Blank = automatic. */}
                                <input
                                  type="text"
                                  value={slice.color}
                                  onChange={(e) => updateSlice(platform, ci, si, { color: e.target.value })}
                                  aria-label={`${rowName} colour`}
                                  aria-invalid={colorBad}
                                  title={colorBad ? 'Not a colour the browser recognises; the automatic colour is used.' : undefined}
                                  className="input order-last col-span-full sm:order-none sm:col-span-1"
                                  style={colorBad ? { borderColor: 'var(--danger, #e66767)' } : undefined}
                                  placeholder="Theme colour"
                                  spellCheck={false}
                                  autoCapitalize="off"
                                />
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step="any"
                                  min={0}
                                  value={slice.value}
                                  onChange={(e) => updateSlice(platform, ci, si, { value: e.target.value })}
                                  aria-label={`${rowName} percent`}
                                  className="input"
                                  placeholder="%"
                                />
                                <button
                                  type="button"
                                  onClick={() => updateChart(platform, ci, (c) => ({ ...c, slices: c.slices.filter((_, i) => i !== si) }))}
                                  aria-label={`Remove ${rowName}`}
                                  className="btn btn-danger btn-sm"
                                  style={{ height: 44, width: 44, padding: 0, justifyContent: 'center' }}
                                >
                                  <X size={16} aria-hidden="true" />
                                </button>
                              </div>
                            )
                          })}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3" style={{ marginTop: 12 }}>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => updateChart(platform, ci, (c) => ({ ...c, slices: [...c.slices, emptySlice()] }))}
                              aria-label={`Add a slice to ${name} ${chartName}`}
                              className="btn btn-ghost btn-sm"
                            >
                              <Plus size={14} aria-hidden="true" /> Add slice
                            </button>
                            {/* Back to the theme colours for this chart. */}
                            {hasCustom && (
                              <button
                                type="button"
                                onClick={() => updateChart(platform, ci, (c) => ({ ...c, slices: c.slices.map((s) => ({ ...s, color: '' })) }))}
                                aria-label={`Reset ${name} ${chartName} colours to the theme defaults`}
                                className="btn btn-ghost btn-sm"
                              >
                                <RotateCcw size={14} aria-hidden="true" /> Reset colours
                              </button>
                            )}
                          </div>
                          {/* Running total — a nudge, not an error: the public pie normalises. */}
                          <span className={`field-hint${offTotal ? ' hint-warn' : ''}`} role="status">
                            Total {formatPercent(Math.round(total * 10) / 10)}
                            {offTotal && ' — doesn’t add up to 100%. That’s fine, the chart scales to fit.'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2" style={{ marginTop: charts.length > 0 ? 14 : 0 }}>
                  <span className="flabel">Add chart</span>
                  {CHART_PRESETS.map((title) => (
                    <button
                      key={title}
                      type="button"
                      onClick={() => setCharts(platform, (cs) => [...cs, newChart(title)])}
                      aria-label={`Add a ${title} chart to ${name}`}
                      className="btn btn-ghost btn-sm"
                    >
                      <Plus size={14} aria-hidden="true" /> {title}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCharts(platform, (cs) => [...cs, newChart('')])}
                    aria-label={`Add a blank chart to ${name}`}
                    className="btn btn-ghost btn-sm"
                  >
                    <Plus size={14} aria-hidden="true" /> Blank
                  </button>
                </div>
              </div>
            </section>
          )
        })}

        {/* Save bar */}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={save === 'saving'} className="btn btn-primary">
            {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Save again' : 'Save'}
          </button>
          {save === 'saved' && (
            <span className="save-ok" role="status">
              <CheckCircle2 size={16} aria-hidden="true" /> Saved
            </span>
          )}
          {save === 'error' && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--danger)' }} role="alert">
              <AlertTriangle size={16} aria-hidden="true" /> {saveError}
            </span>
          )}
        </div>
      </div>
    </form>
  )
}
