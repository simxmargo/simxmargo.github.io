'use client'

import { useRef, useState } from 'react'
import { UploadCloud, Loader2 } from 'lucide-react'
import { supabaseBrowser } from '@/lib/supabase/browser'

// Upload rules mirror app/api/admin/upload/route.ts (keep in sync): bucket "media",
// 8 MB cap, image MIME allowlist, "<folder>/<ts>-<slug>.<ext>" path.
const BUCKET = 'media'
const MAX_BYTES = 8 * 1024 * 1024 // 8 MB
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
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
// upload a file → Supabase Storage → public URL (RLS-gated by the admin session).
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
      if (!EXT[file.type]) {
        setErr(`Unsupported type "${file.type || 'unknown'}". Use JPG, PNG, WebP, AVIF or GIF.`)
        return
      }
      if (file.size > MAX_BYTES) {
        setErr(`Image is too large (max ${MAX_BYTES / 1024 / 1024}MB).`)
        return
      }
      if (!supabaseBrowser) throw new Error('Studio is not configured.')
      const path = `${slugify(folder)}/${Date.now()}-${slugify(file.name)}.${EXT[file.type]}`
      const { error: upErr } = await supabaseBrowser.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false })
      if (upErr) {
        setErr(upErr.message)
        return
      }
      const { data } = supabaseBrowser.storage.from(BUCKET).getPublicUrl(path)
      onChange(data.publicUrl)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Couldn’t reach the server. Try again.')
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
