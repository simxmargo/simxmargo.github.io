'use client'

import { useId, useRef, useState } from 'react'
import { UploadCloud, ImageIcon, Loader2, AlertTriangle, X } from 'lucide-react'
import { supabaseBrowser } from '@/lib/supabase/browser'

interface ImageFieldProps {
  label: string
  value: string
  onChange: (url: string) => void
  /** Stored under media/<folder>/… in the bucket. */
  folder?: string
  hint?: string
  /** CSS aspect-ratio for the preview tile (default portrait 3/4). */
  aspect?: string
}

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

// Image picker for the admin: a live preview tile + an Upload button (file →
// Supabase Storage → public URL) that ALSO keeps the raw URL input, so a hosted
// link can still be pasted. Dark editorial "studio" styling (scoped in globals.css).

export function ImageField({ label, value, onChange, folder = 'uploads', hint, aspect = '3 / 4' }: ImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const urlId = useId()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function handleFile(file: File) {
    setError('')
    setUploading(true)
    try {
      if (!EXT[file.type]) {
        setError(`Unsupported type "${file.type || 'unknown'}". Use JPG, PNG, WebP, AVIF or GIF.`)
        return
      }
      if (file.size > MAX_BYTES) {
        setError(`Image is too large (max ${MAX_BYTES / 1024 / 1024}MB).`)
        return
      }
      if (!supabaseBrowser) throw new Error('Studio is not configured.')
      const path = `${slugify(folder)}/${Date.now()}-${slugify(file.name)}.${EXT[file.type]}`
      const { error: upErr } = await supabaseBrowser.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false })
      if (upErr) {
        setError(upErr.message)
        return
      }
      const { data } = supabaseBrowser.storage.from(BUCKET).getPublicUrl(path)
      onChange(data.publicUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t reach the server. Try again.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = '' // allow re-selecting same file
    }
  }

  return (
    <div className="field">
      <span className="flabel">{label}</span>

      <div className="flex items-start gap-3">
        {/* Preview / picker tile */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          aria-label={value ? `Replace ${label}` : `Upload ${label}`}
          className={`slot rounded w-24 shrink-0${uploading ? ' busy' : ''}`}
          style={{ aspectRatio: aspect }}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" />
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <ImageIcon size={22} aria-hidden="true" />
            </span>
          )}
          {/* Hover/upload scrim */}
          <span className="slot-scrim">
            {uploading ? (
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            ) : (
              <UploadCloud size={18} aria-hidden="true" />
            )}
          </span>
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="btn btn-ghost btn-sm"
            >
              {uploading ? (
                <>
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Uploading…
                </>
              ) : (
                <>
                  <UploadCloud size={14} aria-hidden="true" /> Upload
                </>
              )}
            </button>
            {value && !uploading && (
              <button type="button" onClick={() => onChange('')} className="btn btn-danger btn-sm">
                <X size={14} aria-hidden="true" /> Remove
              </button>
            )}
          </div>

          <input
            id={urlId}
            type="url"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="input"
            placeholder="…or paste an image URL"
          />

          {hint && !error && <p className="field-hint">{hint}</p>}
          {error && (
            <p
              className="inline-flex items-center gap-1.5 text-xs font-medium"
              style={{ color: 'var(--danger)' }}
              role="alert"
            >
              <AlertTriangle size={13} aria-hidden="true" /> {error}
            </p>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
        }}
      />
    </div>
  )
}
