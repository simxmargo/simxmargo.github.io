'use client'

import { useRef } from 'react'
import { AlertTriangle, X, Download } from 'lucide-react'
import { useDialog } from '@/lib/admin/useDialog'
import { type MatchBrand } from '@/lib/social/brandMatch'

// TEMPORARILY DISABLED (Supabase SPA migration).
//
// This was the bulk-supply tool: pull a creator's recent TikTok/IG posts by handle
// (via the ScrapeCreators managed API), auto-match them to brands by caption, and add
// to each brand's Top content in one pass. It called three scrape endpoints that are
// being removed: POST /api/admin/brands/pull-videos, POST /api/admin/brands/add-videos,
// and GET /api/admin/brands/cover-proxy.
//
// To keep the file compiling and call no scrape endpoint, the body is neutralized to a
// disabled state + note. The props are kept intact so the call site in PortfolioManager
// is unchanged (its trigger is also disabled). Re-enable by restoring the
// fetch/match/add/cover-proxy flow from git history once a browser-safe video source
// exists. For now, add a brand's Top content manually in the brand editor.
export function PullVideosModal({
  onClose,
}: {
  brands: MatchBrand[]
  defaultHandle?: string
  onClose: () => void
  onAdded: () => void
  on503: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useDialog(panelRef, onClose)

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pull-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="ico-badge"><Download size={18} aria-hidden="true" /></span>
          <h2 id="pull-title" className="modal-title">Pull videos from a profile</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="banner banner-warn">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>
              Pulling videos from a profile is temporarily off. Open a brand and add its Top content manually —
              paste the post link, upload a cover, and type the view &amp; like counts.
            </span>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
