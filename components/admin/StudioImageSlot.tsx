'use client'

import { useRef, useState } from 'react'
import { UploadCloud, Loader2 } from 'lucide-react'
import { adminUpload } from '@/lib/adminClient'

interface StudioImageSlotProps {
  value: string
  onChange: (url: string) => void
  folder?: string
  shape?: 'circle' | 'rounded' | 'rect'
  /** Extra sizing class, e.g. "slot-avatar" / "slot-cover" / "slot-og". */
  className?: string
  placeholder?: string
  /** Shown (as the current image) when `value` is empty — e.g. a generated default
   * the upload would override. Keeps the slot from ever looking empty. */
  fallbackSrc?: string
  ariaLabel: string
}

// Dark editorial image picker for the studio (the design's <image-slot>). Click to
// upload a file → /api/admin/upload → public URL. Reuses adminUpload (multipart-safe).
export function StudioImageSlot({
  value,
  onChange,
  folder = 'uploads',
  shape = 'rounded',
  className = '',
  placeholder = 'Drop photo',
  fallbackSrc = '',
  ariaLabel,
}: StudioImageSlotProps) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function handle(file: File) {
    setErr('')
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('folder', folder)
      const res = await adminUpload('/api/admin/upload', form)
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !body.url) {
        setErr(body.error || `Upload failed (${res.status}).`)
        return
      }
      onChange(body.url)
    } catch {
      setErr('Couldn’t reach the server. Try again.')
    } finally {
      setBusy(false)
      if (ref.current) ref.current.value = ''
    }
  }

  return (
    <div className={shape === 'rect' || className.includes('cover') || className.includes('og') ? 'w-full' : ''}>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        aria-label={ariaLabel}
        className={`slot ${shape} ${className}${busy ? ' busy' : ''}`}
      >
        {value && <img src={value} alt="" />}
        {!value && fallbackSrc && <img src={fallbackSrc} alt="" />}
        {!value && !fallbackSrc && <span>{placeholder}</span>}
        <span className="slot-scrim">
          {busy ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <UploadCloud size={18} aria-hidden="true" />}
        </span>
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handle(f)
        }}
      />
      {err && (
        <p className="mt-2 text-xs font-medium" style={{ color: 'var(--danger)' }}>
          {err}
        </p>
      )}
    </div>
  )
}
