'use client'

import { useId, useRef, useState } from 'react'
import { UploadCloud, ImageIcon, Loader2, AlertTriangle, X } from 'lucide-react'
import { adminUpload } from '@/lib/adminClient'

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

// Image picker for the admin: a live preview tile + an Upload button (file →
// /api/admin/upload → public URL) that ALSO keeps the raw URL input, so a hosted
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
      const form = new FormData()
      form.append('file', file)
      form.append('folder', folder)
      const res = await adminUpload('/api/admin/upload', form)
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !body.url) {
        setError(body.error || `Upload failed (${res.status}).`)
        return
      }
      onChange(body.url)
    } catch {
      setError('Couldn’t reach the server. Try again.')
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
