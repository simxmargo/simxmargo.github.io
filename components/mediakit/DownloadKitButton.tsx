'use client'

import { Download } from 'lucide-react'

interface DownloadKitButtonProps {
  className?: string
}

export function DownloadKitButton({ className }: DownloadKitButtonProps) {
  // Dependency-free PDF: triggers the browser's print dialog (print-to-PDF).
  // TODO(mediakit): richer server-side PDF generation (branded, paginated)
  // is a later enhancement — e.g. an /api/mediakit/pdf route via Puppeteer.
  const handleDownload = () => {
    if (typeof window !== 'undefined') window.print()
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      aria-label="Download media kit as PDF"
      className={
        className ??
        'inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-ivory transition-colors hover:border-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-400'
      }
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      Download media kit
    </button>
  )
}
