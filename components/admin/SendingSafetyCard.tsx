'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { adminKeys, useAdminResource } from '@/lib/admin/queries'
import { saveSettings, type SettingsShape } from '@/lib/admin/resources/settings'
import { readFirstSendAt } from '@/lib/admin/resources/sendQueue'
import type { SendingSafety } from '@/lib/admin/resources/sendingAccount'
import { useStore } from '@/lib/store'

// Settings → Sending safety. The knobs behind the DAILY AUTOMATED sender
// (drain-queue): kill switch, auto-queue, weekday gating, and the morning send
// window. Every rule shown here is ENFORCED server-side — this card edits
// app_settings, it is not the guard.

// Display mirror of effectiveDailyCap() in supabase/functions/_shared/sendPitch.ts
// — that copy enforces; this one only explains. Keep the formula identical.
function effectiveCap(dailyCap: number, warmupStart: number, firstSendAt: string | null): number {
  const first = firstSendAt ? Date.parse(firstSendAt) : NaN
  if (!Number.isFinite(first)) return Math.min(dailyCap, warmupStart)
  const weeks = Math.max(0, Math.floor((Date.now() - first) / (7 * 24 * 60 * 60 * 1000)))
  return Math.min(dailyCap, Math.max(1, warmupStart) * (1 + weeks))
}

const fmtHour = (h: number): string => {
  const twelve = h % 12 === 0 ? 12 : h % 12
  return `${twelve} ${h < 12 ? 'AM' : 'PM'}`
}

const WINDOW_HOURS = Array.from({ length: 15 }, (_, i) => i + 6) // 6 AM … 8 PM PH

export function SendingSafetyCard() {
  const qc = useQueryClient()
  const q = useAdminResource<SettingsShape>('settings')
  const safetyQ = useAdminResource<SendingSafety>('sendingSafety')
  const settings = q.data
  const sentToday = useStore((s) => s.sentToday)

  const [firstSendAt, setFirstSendAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let alive = true
    readFirstSendAt()
      .then((v) => alive && setFirstSendAt(v))
      .catch(() => {}) // display-only — the ramp line simply shows the base cap
    return () => {
      alive = false
    }
  }, [])

  async function patch(p: Parameters<typeof saveSettings>[0]): Promise<void> {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await saveSettings(p)
      await qc.invalidateQueries({ queryKey: adminKeys.settings })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  if (q.isLoading || !settings) {
    return (
      <section className="card">
        <div className="card-head">
          <ShieldCheck size={18} aria-hidden="true" />
          <h2 className="card-title">Sending safety</h2>
        </div>
        <div className="card-body">
          <p className="field-hint">Loading…</p>
        </div>
      </section>
    )
  }

  const eff = effectiveCap(settings.dailyCap, settings.warmupStart, firstSendAt)
  const ramping = eff < settings.dailyCap
  const safety = safetyQ.data

  return (
    <section className="card">
      <div className="card-head">
        <ShieldCheck size={18} aria-hidden="true" />
        <h2 className="card-title">Sending safety</h2>
        <span className="tag">{settings.sendingPaused ? 'Paused' : 'Active'}</span>
      </div>
      <p className="card-sub indent">
        Pitches go out one at a time, on weekday mornings, capped per day. Everything here is enforced
        on the server — closing the studio changes nothing.
      </p>

      <div className="card-body">
        {settings.sendingPaused && (
          <div className="banner banner-warn" role="alert" style={{ marginBottom: 14 }}>
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{settings.pausedReason || 'Sending is paused.'}</span>
          </div>
        )}

        <div className="stack" style={{ gap: 10 }}>
          <div className="field-card">
            <div>
              <div className="fc-title">Pause all sending</div>
              <div className="fc-sub">
                The kill switch. Nothing sends while this is on — scheduled, manual, or auto-queued. It
                also flips itself on if bounces spike.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.sendingPaused}
              aria-label="Pause all outreach sending"
              onClick={() => void patch({ sendingPaused: !settings.sendingPaused })}
              className="switch"
              disabled={busy}
            >
              <span className="switch-knob" />
            </button>
          </div>

          <div className="field-card">
            <div>
              <div className="fc-title">Auto-queue new leads</div>
              <div className="fc-sub">
                Each morning, fills the day&rsquo;s budget from scraped contacts whose address scored at
                least{' '}
                <input
                  type="number"
                  min={0}
                  max={100}
                  // Saved on blur, not per keystroke — typing "60" must not fire a
                  // write for the intermediate "6". key remounts it if another
                  // session's save comes back through the query cache.
                  key={settings.autoQueueMinConfidence}
                  defaultValue={settings.autoQueueMinConfidence}
                  aria-label="Minimum address score for auto-queueing"
                  className="input"
                  style={{ width: 64, display: 'inline-block', padding: '2px 8px', margin: '0 2px' }}
                  onBlur={(e) => {
                    const v = Math.max(0, Math.min(100, Math.trunc(Number(e.target.value) || 0)))
                    if (v !== settings.autoQueueMinConfidence) void patch({ autoQueueMinConfidence: v })
                  }}
                  disabled={busy}
                />{' '}
                — after checking the address&rsquo;s shape and that its domain can receive mail.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoQueue}
              aria-label="Auto-queue validated high-confidence leads"
              onClick={() => void patch({ autoQueue: !settings.autoQueue })}
              className="switch"
              disabled={busy}
            >
              <span className="switch-knob" />
            </button>
          </div>

          <div className="field-card">
            <div>
              <div className="fc-title">Weekdays only</div>
              <div className="fc-sub">
                Brand inboxes are read Monday to Friday; weekend pitches sink and read as automated.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.sendWeekdaysOnly}
              aria-label="Send on weekdays only"
              onClick={() => void patch({ sendWeekdaysOnly: !settings.sendWeekdaysOnly })}
              className="switch"
              disabled={busy}
            >
              <span className="switch-knob" />
            </button>
          </div>

          <div className="field-card">
            <div>
              <div className="fc-title">Send window</div>
              <div className="fc-sub">
                Philippine time. Queued pitches — including &ldquo;Send now&rdquo; — wait for the next
                window.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={settings.sendWindowStart}
                aria-label="Send window start hour (PH time)"
                className="input"
                style={{ width: 92 }}
                disabled={busy}
                onChange={(e) => {
                  const start = Number(e.target.value)
                  void patch({
                    sendWindowStart: start,
                    // Keep the pair valid — the DB CHECK rejects start >= end.
                    ...(start >= settings.sendWindowEnd ? { sendWindowEnd: start + 1 } : {}),
                  })
                }}
              >
                {WINDOW_HOURS.map((h) => (
                  <option key={h} value={h}>
                    {fmtHour(h)}
                  </option>
                ))}
              </select>
              <span className="field-hint" style={{ margin: 0 }}>
                to
              </span>
              <select
                value={settings.sendWindowEnd}
                aria-label="Send window end hour (PH time)"
                className="input"
                style={{ width: 92 }}
                disabled={busy}
                onChange={(e) => {
                  const end = Number(e.target.value)
                  void patch({
                    sendWindowEnd: end,
                    ...(end <= settings.sendWindowStart ? { sendWindowStart: end - 1 } : {}),
                  })
                }}
              >
                {WINDOW_HOURS.map((h) => (
                  <option key={h + 1} value={h + 1}>
                    {fmtHour(h + 1)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* What today actually allows — the warm-up ramp made visible, so a cap that
            reads lower than the slider on the Outreach tab is explained, not a bug. */}
        <p className="field-hint" style={{ marginTop: 14 }}>
          Today&rsquo;s cap: <strong>{eff}</strong>
          {/* One template string, one text node — spaces at JSX expression boundaries
              are unreliable across renderers. */}
          {`${ramping ? ` of ${settings.dailyCap} — warm-up ramp, +${settings.warmupStart} each week` : ''} · ${sentToday} sent in the last 24 h`}
        </p>

        <p className="field-hint" style={{ marginTop: 4 }}>
          {safety?.canDetectBounces
            ? `Bounce detection is on${
                safety.lastBounceCheckAt
                  ? ` — last swept ${new Date(safety.lastBounceCheckAt).toLocaleDateString()}`
                  : ''
              }. Dead addresses are suppressed automatically.`
            : 'Bounce detection is off — use "Enable bounce detection" in the Sending account card above to grant read access, so bounced addresses get suppressed instead of hurting your sender reputation.'}
        </p>

        {saved && (
          <p className="save-ok" style={{ marginTop: 10 }}>
            <CheckCircle2 size={14} aria-hidden="true" /> Saved
          </p>
        )}

        {error && (
          <div className="banner banner-error" role="alert" style={{ marginTop: 10 }}>
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </section>
  )
}
