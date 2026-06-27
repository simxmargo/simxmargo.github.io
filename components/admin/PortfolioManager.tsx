'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Plus, Pencil, Trash2, Eye, EyeOff, GripVertical,
  Link2, AlertTriangle, Check, Loader2, LayoutGrid,
  RefreshCw, X, Video, Upload, Download,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, rectSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { adminFetch } from '@/lib/adminClient'
import { useAdminResource, adminKeys, AdminFetchError } from '@/lib/admin/queries'
import { ImageField } from '@/components/admin/ImageField'
import { PortfolioSkeleton } from '@/components/admin/Skeleton'
import { formatCount, parseCompact, type PortfolioBrand } from '@/lib/mediakit-types'
import { categoryKey, type CategoryKey } from '@/lib/mediakit/brandDetail'
import { useDialog } from '@/lib/admin/useDialog'
import { PullVideosModal } from '@/components/admin/PullVideosModal'

// The admin /api/admin/brands GET returns sort_order + is_visible on top of the
// public PortfolioBrand fields — this screen needs them to reorder + show/hide.
type AdminBrand = PortfolioBrand & { isVisible: boolean; sortOrder: number }

// Per-category dot colour for the brand cards (mirrors the public modal's category
// system via categoryKey). Purely decorative — never the only signal (label too).
const CAT_DOT: Record<CategoryKey, string> = {
  fashion: '#e0694b',
  beauty: '#c879d6',
  app: '#5b9df0',
  media: '#3fc58a',
}

// One "Top content" reel in the editor (strings for inputs; coerced server-side).
interface ContentDraft {
  url: string
  platform: 'tiktok' | 'instagram' | ''
  thumbUrl: string
  views: string
  likes: string
  caption: string
}

const EMPTY_CONTENT: ContentDraft = { url: '', platform: '', thumbUrl: '', views: '', likes: '', caption: '' }

// Mutable shape of the BrandEditor form (id present ⇒ editing an existing row).
interface BrandForm {
  id?: string
  brand: string
  website: string
  logoUrl: string
  blurb: string
  campaignTitle: string
  category: string
  featured: boolean
  rowIndex: '' | 1 | 2 // '' = auto-split
  media: ContentDraft[]
}

const EMPTY_FORM: BrandForm = {
  brand: '',
  website: '',
  logoUrl: '',
  blurb: '',
  campaignTitle: '',
  category: '',
  featured: false,
  rowIndex: '',
  media: [],
}

// PortfolioBrand.media (BrandMedia[], numbers) → editor drafts (strings).
function toDrafts(media: PortfolioBrand['media']): ContentDraft[] {
  return (Array.isArray(media) ? media : []).map((m) => ({
    url: m.url ?? '',
    platform: m.platform === 'instagram' ? 'instagram' : m.platform === 'tiktok' ? 'tiktok' : '',
    thumbUrl: m.thumbUrl ?? '',
    views: typeof m.views === 'number' ? String(m.views) : '',
    likes: typeof m.likes === 'number' ? String(m.likes) : '',
    caption: m.caption ?? '',
  }))
}

const editFormFromBrand = (b: AdminBrand): BrandForm => ({
  id: b.id,
  brand: b.brand,
  website: b.website,
  logoUrl: b.logoUrl,
  blurb: b.blurb,
  campaignTitle: b.campaignTitle,
  category: b.category,
  featured: b.featured,
  rowIndex: b.rowIndex === 1 || b.rowIndex === 2 ? b.rowIndex : '',
  media: toDrafts(b.media),
})

// Split the brands across the TWO carousel lanes EXACTLY like the public page
// (components/mediakit/PortfolioGrid.tsx) so this editor is WYSIWYG: an explicit
// rowIndex wins (1/null ⇒ top, 2 ⇒ bottom); with no explicit rows at all, split
// the list in half. Dragging "locks in" explicit rows (see handleDragEnd) so this
// stays stable afterwards.
function resolveLanes(brands: AdminBrand[]): { laneA: AdminBrand[]; laneB: AdminBrand[] } {
  const hasExplicit = brands.some((b) => b.rowIndex === 1 || b.rowIndex === 2)
  if (hasExplicit) {
    return { laneA: brands.filter((b) => b.rowIndex !== 2), laneB: brands.filter((b) => b.rowIndex === 2) }
  }
  const mid = Math.ceil(brands.length / 2)
  return { laneA: brands.slice(0, mid), laneB: brands.slice(mid) }
}

export function PortfolioManager() {
  const qc = useQueryClient()
  // Shared TanStack Query cache for the brands list — survives tab unmount/remount.
  const q = useAdminResource<AdminBrand[]>('brands')
  const [brands, setBrands] = useState<AdminBrand[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<BrandForm | null>(null)
  const [editorNonce, setEditorNonce] = useState(0)
  const [serviceKeyMissing, setServiceKeyMissing] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; brand: string } | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [pulling, setPulling] = useState(false)

  // Seed the local optimistic list from cached query data (stable ref while cached).
  useEffect(() => {
    if (!q.data) return
    setBrands(q.data)
  }, [q.data])

  // Open the editor seeded with `form`, bumping editorNonce so it remounts (its key),
  // discarding any stale form state from a previously-open editor.
  const openEditor = useCallback((form: BrandForm) => {
    setEditing(form)
    setEditorNonce((n) => n + 1)
  }, [])

  const invalidateBrands = useCallback(
    () => qc.invalidateQueries({ queryKey: adminKeys.brands }),
    [qc],
  )

  const handleSaved = useCallback(async () => {
    setServiceKeyMissing(false)
    setEditing(null)
    setSavedAt(Date.now())
    await invalidateBrands()
  }, [invalidateBrands])

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    setServiceKeyMissing(false)
    try {
      const res = await adminFetch(`/api/admin/brands?id=${encodeURIComponent(deleting.id)}`, { method: 'DELETE' })
      if (res.status === 503) {
        setServiceKeyMissing(true)
        return
      }
      if (!res.ok) throw new Error(`Delete failed (${res.status})`)
      setSavedAt(Date.now())
      setEditing(null) // close the editor too if the delete came from it
      await invalidateBrands()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setDeleteBusy(false)
      setDeleting(null)
    }
  }

  // Persist a drag result. Optimistic: write the new lane assignment + order to BOTH
  // local state and the query cache (setQueryData, NOT invalidate — no refetch, so the
  // drop animation isn't interrupted), then send ONE bulk PUT { order: [{id,rowIndex}] }
  // that re-sequences sort_order AND writes the explicit lane for every brand. Revert
  // on error. Writing rowIndex for ALL brands "locks in" the split (see handleDragEnd).
  async function persistLanes(order: { id: string; rowIndex: 1 | 2 }[]) {
    const byId = new Map(brands.map((b) => [b.id, b]))
    const next: AdminBrand[] = []
    order.forEach((o, i) => {
      const b = byId.get(o.id)
      if (b) next.push({ ...b, rowIndex: o.rowIndex, sortOrder: i })
    })
    setBrands(next)
    qc.setQueryData(adminKeys.brands, next)
    setServiceKeyMissing(false)
    try {
      const res = await adminFetch('/api/admin/brands', { method: 'PUT', body: JSON.stringify({ order }) })
      if (res.status === 503) {
        setServiceKeyMissing(true)
        await invalidateBrands()
        return
      }
      if (!res.ok) throw new Error(`Reorder failed (${res.status})`)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Reorder failed.')
      await invalidateBrands()
    }
  }

  // Drag within a lane = reorder; drag onto the other lane (a card or empty space) =
  // move + reassign. We rebuild BOTH lanes as id arrays, then emit one explicit
  // {id,rowIndex} order — every brand gets a concrete lane, so the public split never
  // "flips" the remaining Auto brands into the top row.
  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return

    const { laneA, laneB } = resolveLanes(brands)
    let idsA = laneA.map((b) => b.id)
    let idsB = laneB.map((b) => b.id)
    const fromLane = idsA.includes(activeId) ? 1 : idsB.includes(activeId) ? 2 : null
    if (!fromLane) return

    const toLane: 1 | 2 =
      overId === 'lane-1' ? 1 : overId === 'lane-2' ? 2 : idsA.includes(overId) ? 1 : idsB.includes(overId) ? 2 : fromLane

    if (fromLane === toLane) {
      const arr = toLane === 1 ? idsA : idsB
      const oldIndex = arr.indexOf(activeId)
      const newIndex = overId.startsWith('lane-') ? arr.length - 1 : arr.indexOf(overId)
      if (oldIndex < 0 || newIndex < 0) return
      const moved = arrayMove(arr, oldIndex, newIndex)
      if (toLane === 1) idsA = moved
      else idsB = moved
    } else {
      if (fromLane === 1) idsA = idsA.filter((id) => id !== activeId)
      else idsB = idsB.filter((id) => id !== activeId)
      const tgt = toLane === 1 ? idsA : idsB
      const at = overId === `lane-${toLane}` ? tgt.length : tgt.indexOf(overId) < 0 ? tgt.length : tgt.indexOf(overId)
      tgt.splice(at, 0, activeId)
    }

    const order = [
      ...idsA.map((id) => ({ id, rowIndex: 1 as const })),
      ...idsB.map((id) => ({ id, rowIndex: 2 as const })),
    ]
    void persistLanes(order)
  }

  // Show/hide a brand on the public page (is_visible). Hidden brands stay in the lane
  // (dimmed, with a HIDDEN chip) so you can bring them back.
  async function toggleVisible(b: AdminBrand) {
    setServiceKeyMissing(false)
    try {
      const res = await adminFetch('/api/admin/brands', {
        method: 'PUT',
        body: JSON.stringify({ id: b.id, isVisible: !b.isVisible }),
      })
      if (res.status === 503) {
        setServiceKeyMissing(true)
        return
      }
      if (!res.ok) throw new Error(`Update failed (${res.status})`)
      setSavedAt(Date.now())
      await invalidateBrands()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Update failed.')
    }
  }

  const queryError = q.isError
    ? (q.error as AdminFetchError | null)?.status === 503
      ? 'Saving needs SUPABASE_SERVICE_ROLE_KEY set on the server.'
      : q.error?.message ?? 'Could not load brands.'
    : null

  // dnd-kit sensors: pointer (small activation distance so a click on a card button
  // doesn't start a drag) + keyboard (space to lift, arrows to move) for a11y.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const { laneA, laneB } = resolveLanes(brands)

  return (
    <>
      <header className="main-head">
        <div>
          <h1 className="page-title display">Brand partners</h1>
          <p className="page-sub">
            These are the two carousel rows on your live media kit. Drag a brand to reorder it inside a row —
            or drop it into the other row. The order here is the order brands appear.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPulling(true)} className="btn btn-ghost">
            <Download size={16} aria-hidden="true" /> Pull videos
          </button>
          <button type="button" onClick={() => openEditor({ ...EMPTY_FORM })} className="btn btn-primary">
            <Plus size={16} aria-hidden="true" /> Add brand
          </button>
        </div>
      </header>

      <div className="stack stack-wide">
        {serviceKeyMissing && (
          <div className="banner banner-warn">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>Saving needs SUPABASE_SERVICE_ROLE_KEY set on the server.</span>
          </div>
        )}
        {savedAt && (
          <div className="save-ok">
            <Check size={16} aria-hidden="true" /> Saved
          </div>
        )}
        {(queryError || loadError) && (
          <div className="banner banner-error">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{queryError ?? loadError}</span>
            {q.isError && (
              <button type="button" onClick={() => void q.refetch()} className="btn btn-ghost btn-sm">
                Retry
              </button>
            )}
          </div>
        )}

        <AddBrandByUrl onDraft={openEditor} />

        {q.isLoading ? (
          <PortfolioSkeleton />
        ) : brands.length === 0 ? (
          <div className="empty">No brands yet. Add your first partner above.</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <div className="lanes">
              <BrandLane
                laneId={1}
                title="Row 1"
                sublabel="Top lane"
                brands={laneA}
                onEdit={(b) => openEditor(editFormFromBrand(b))}
                onToggleVisible={(b) => void toggleVisible(b)}
                onDelete={(b) => setDeleting({ id: b.id, brand: b.brand })}
              />
              <BrandLane
                laneId={2}
                title="Row 2"
                sublabel="Bottom lane"
                brands={laneB}
                onEdit={(b) => openEditor(editFormFromBrand(b))}
                onToggleVisible={(b) => void toggleVisible(b)}
                onDelete={(b) => setDeleting({ id: b.id, brand: b.brand })}
              />
            </div>
          </DndContext>
        )}
      </div>

      {editing && (
        <BrandEditorModal
          key={editorNonce}
          initial={editing}
          onCancel={() => setEditing(null)}
          on503={() => setServiceKeyMissing(true)}
          onSaved={handleSaved}
          onRequestDelete={(d) => setDeleting(d)}
        />
      )}
      {deleting && (
        <DeleteConfirmModal
          brand={deleting.brand}
          busy={deleteBusy}
          onCancel={() => !deleteBusy && setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
      {pulling && (
        <PullVideosModal
          brands={brands}
          defaultHandle="simxmargo"
          onClose={() => setPulling(false)}
          onAdded={() => {
            setSavedAt(Date.now())
            void invalidateBrands()
          }}
          on503={() => setServiceKeyMissing(true)}
        />
      )}
    </>
  )
}

// One carousel lane: a labelled panel + a droppable grid of brand cards. The grid is
// a dnd-kit droppable (id "lane-N") so a card can be dropped into an EMPTY lane or the
// gaps, not just onto another card.
function BrandLane({
  laneId,
  title,
  sublabel,
  brands,
  onEdit,
  onToggleVisible,
  onDelete,
}: {
  laneId: 1 | 2
  title: string
  sublabel: string
  brands: AdminBrand[]
  onEdit: (b: AdminBrand) => void
  onToggleVisible: (b: AdminBrand) => void
  onDelete: (b: AdminBrand) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `lane-${laneId}` })
  const visible = brands.filter((b) => b.isVisible).length
  return (
    <section className="lane">
      <div className="lane-head">
        <span className="lane-dot" aria-hidden="true" />
        <span className="lane-title">{title}</span>
        <span className="lane-meta">
          {sublabel} · {brands.length} {brands.length === 1 ? 'brand' : 'brands'} · {visible} visible
        </span>
      </div>
      <SortableContext items={brands.map((b) => b.id)} strategy={rectSortingStrategy}>
        <div ref={setNodeRef} className={`brand-grid${isOver ? ' is-over' : ''}`}>
          {brands.length === 0 ? (
            <div className="lane-empty">Drop a brand here</div>
          ) : (
            brands.map((b) => (
              <SortableBrandCard
                key={b.id}
                b={b}
                onEdit={() => onEdit(b)}
                onToggleVisible={() => onToggleVisible(b)}
                onDelete={() => onDelete(b)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </section>
  )
}

// One draggable brand card. The DRAG chip carries the dnd-kit listeners (not the whole
// card) so the edit/visibility/delete icon buttons stay clickable. Keyboard sensor
// makes the chip a full a11y reorder control (space to lift, arrows to move).
function SortableBrandCard({
  b,
  onEdit,
  onToggleVisible,
  onDelete,
}: {
  b: AdminBrand
  onEdit: () => void
  onToggleVisible: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: b.id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 30 : undefined,
  }
  const cat = categoryKey(b.category)
  return (
    <div ref={setNodeRef} style={style} className={`bcard${b.isVisible ? '' : ' is-hidden'}`}>
      <div className="bcard-thumb">
        {b.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.logoUrl} alt="" />
        ) : (
          <span className="bcard-mono">{(b.brand[0] ?? '?').toUpperCase()}</span>
        )}
        <button
          type="button"
          className="bcard-drag"
          aria-label={`Drag ${b.brand} to reorder`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={11} aria-hidden="true" /> DRAG
        </button>
        {!b.isVisible && <span className="bcard-chip">HIDDEN</span>}
      </div>
      <div className="bcard-name" title={b.brand}>{b.brand}</div>
      <div className="bcard-cat">
        <span className="cat-dot" style={{ background: CAT_DOT[cat] }} aria-hidden="true" />
        {b.category || cat}
      </div>
      <div className="bcard-actions">
        <button type="button" className="icon-btn" onClick={onEdit} aria-label={`Edit ${b.brand}`}>
          <Pencil size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleVisible}
          aria-label={b.isVisible ? `Hide ${b.brand} from the media kit` : `Show ${b.brand} on the media kit`}
        >
          {b.isVisible ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}
        </button>
        <button type="button" className="icon-btn danger" onClick={onDelete} aria-label={`Remove ${b.brand}`}>
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

// Confirm before a destructive delete (matches the design's "Remove {brand}?" dialog).
function DeleteConfirmModal({
  brand,
  busy,
  onCancel,
  onConfirm,
}: {
  brand: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useDialog(panelRef, onCancel)

  return (
    <div className="modal-backdrop" onClick={onCancel} role="presentation">
      <div
        ref={panelRef}
        className="modal-panel sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-body">
          <span className="ico-badge danger"><Trash2 size={18} aria-hidden="true" /></span>
          <h2 id="delete-modal-title" className="modal-title" style={{ marginTop: 14 }}>Remove {brand}?</h2>
          <p className="modal-sub">
            This takes the brand off both carousel rows on your live media kit. You can&rsquo;t undo this.
          </p>
          <div className="modal-foot end" style={{ padding: 0, marginTop: 20, border: 'none' }}>
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />} Remove brand
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function BrandEditorModal({
  initial,
  onCancel,
  onSaved,
  on503,
  onRequestDelete,
}: {
  initial: BrandForm
  onCancel: () => void
  onSaved: () => void | Promise<void>
  on503: () => void
  onRequestDelete: (d: { id: string; brand: string }) => void
}) {
  const [form, setForm] = useState<BrandForm>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof BrandForm>(k: K, v: BrandForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const addContent = () => setForm((f) => ({ ...f, media: [...f.media, { ...EMPTY_CONTENT }] }))
  const removeContent = (i: number) => setForm((f) => ({ ...f, media: f.media.filter((_, idx) => idx !== i) }))
  const updateContent = (i: number, patch: Partial<ContentDraft>) =>
    setForm((f) => ({ ...f, media: f.media.map((m, idx) => (idx === i ? { ...m, ...patch } : m)) }))
  const panelRef = useRef<HTMLFormElement>(null)
  useDialog(panelRef, onCancel)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form.brand.trim()) {
      setError('Brand name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await adminFetch('/api/admin/brands', { method: form.id ? 'PUT' : 'POST', body: JSON.stringify(form) })
      if (res.status === 503) {
        on503()
        return
      }
      if (!res.ok) throw new Error(`Save failed (${res.status})`)
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel} role="presentation">
      <form
        ref={panelRef}
        onSubmit={save}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="brand-editor-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="ico-badge"><LayoutGrid size={18} aria-hidden="true" /></span>
          <h2 id="brand-editor-title" className="modal-title">{form.id ? 'Edit brand' : 'Add brand'}</h2>
          <button type="button" className="modal-x" onClick={onCancel} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {error && (
            <div className="banner banner-error">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          <div className="grid2">
            <div className="field">
              <label className="flabel" htmlFor="brand-name">Brand *</label>
              <input id="brand-name" className="input" value={form.brand} onChange={(e) => set('brand', e.target.value)} required />
            </div>
            <div className="field">
              <label className="flabel" htmlFor="brand-website">Website</label>
              <input id="brand-website" type="url" placeholder="https://brand.com" className="input" value={form.website} onChange={(e) => set('website', e.target.value)} />
            </div>
          </div>

          <ImageField
            label="Logo"
            value={form.logoUrl}
            onChange={(url) => set('logoUrl', url)}
            folder="logos"
            aspect="1 / 1"
            hint="Upload a square logo, or paste a URL. Auto-filled from the site when you add by URL."
          />

          <div className="grid2">
            <div className="field">
              <label className="flabel" htmlFor="brand-category">Category</label>
              <input id="brand-category" className="input" value={form.category} onChange={(e) => set('category', e.target.value)} />
            </div>
            <div className="field">
              <label className="flabel" htmlFor="brand-row">Carousel row</label>
              <select
                id="brand-row"
                className="input"
                value={form.rowIndex}
                onChange={(e) => set('rowIndex', e.target.value === '' ? '' : (Number(e.target.value) as 1 | 2))}
              >
                <option value="">Auto — split evenly</option>
                <option value="1">Row 1 — top lane</option>
                <option value="2">Row 2 — bottom lane</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label className="flabel" htmlFor="brand-campaign">Campaign title</label>
            <input id="brand-campaign" className="input" placeholder="e.g. Holiday 2025 partnership" value={form.campaignTitle} onChange={(e) => set('campaignTitle', e.target.value)} />
          </div>

          <div className="field-card">
            <div>
              <div className="fc-title">Featured on the media kit</div>
              <div className="fc-sub">Visible in your live carousel.</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.featured}
              aria-label="Featured on the media kit"
              onClick={() => set('featured', !form.featured)}
              className="switch"
            >
              <span className="switch-knob" />
            </button>
          </div>

          {/* Top content — the reels shown in this brand's modal. */}
          <div className="content-sec">
            <div className="content-sec-head">
              <span className="ico-badge"><Video size={16} aria-hidden="true" /></span>
              <div>
                <h3 className="card-title" style={{ fontSize: 16 }}>Top content</h3>
                <p className="field-hint" style={{ marginTop: 2 }}>
                  Reels shown in this brand&rsquo;s modal. Paste a link, then enter the view &amp; like counts.
                </p>
              </div>
            </div>
            {form.media.map((c, i) => (
              <ContentRow
                key={i}
                draft={c}
                onChange={(patch) => updateContent(i, patch)}
                onRemove={() => removeContent(i)}
                on503={on503}
              />
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={addContent} style={{ alignSelf: 'flex-start' }}>
              <Plus size={14} aria-hidden="true" /> Add content
            </button>
          </div>
        </div>

        <div className="modal-foot">
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />} {saving ? 'Saving…' : 'Save brand'}
          </button>
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            Cancel
          </button>
          {form.id && (
            <button
              type="button"
              className="btn-text-danger"
              style={{ marginLeft: 'auto' }}
              onClick={() => onRequestDelete({ id: form.id as string, brand: form.brand })}
            >
              <Trash2 size={15} aria-hidden="true" /> Delete brand
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

// Paste a brand's site → POST /api/admin/scrape-meta → prefill the BrandEditor with
// the derived draft (name, logo, blurb) for the admin to review + save. Returns a
// DRAFT only; nothing is written until the admin saves.
function AddBrandByUrl({ onDraft }: { onDraft: (form: BrandForm) => void }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchMeta(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    try {
      const res = await adminFetch('/api/admin/scrape-meta', {
        method: 'POST',
        body: JSON.stringify({ url: trimmed }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Lookup failed (${res.status})`)
      onDraft({
        brand: json.brand ?? '',
        website: json.website ?? trimmed,
        logoUrl: json.logoUrl ?? '',
        blurb: json.blurb ?? '',
        campaignTitle: json.campaignTitle ?? '',
        category: '',
        featured: false,
        rowIndex: '',
        media: [],
      })
      setUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={fetchMeta} className="card">
      <div className="card-head">
        <span className="ico-badge"><Link2 size={18} aria-hidden="true" /></span>
        <h2 className="card-title">Add from URL</h2>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="flex items-center gap-2">
          <input
            id="brand-from-url"
            type="url"
            placeholder="https://brand.com"
            className="input flex-1"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
          />
          <button type="submit" disabled={loading || !url.trim()} className="btn btn-primary">
            {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
            {loading ? 'Fetching…' : 'Fetch'}
          </button>
        </div>
        {error ? (
          <p className="flex items-center gap-1" style={{ fontSize: 12, color: 'var(--danger)' }}>
            <AlertTriangle size={12} aria-hidden="true" /> {error}
          </p>
        ) : (
          <p className="field-hint">
            Paste a brand&rsquo;s site — it opens the form prefilled with the name &amp; link for you to review
            and finish.
          </p>
        )}
      </div>
    </form>
  )
}

// One "Top content" reel row: a 9:16 cover (click to upload), the post URL with a
// TikTok auto-fetch, caption, and manual view/like counts (counts aren't fetchable).
function ContentRow({
  draft,
  onChange,
  onRemove,
  on503,
}: {
  draft: ContentDraft
  onChange: (patch: Partial<ContentDraft>) => void
  onRemove: () => void
  on503: () => void
}) {
  const [fetching, setFetching] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [note, setNote] = useState('')

  async function fetchPost() {
    const u = draft.url.trim()
    if (!u) return
    setFetching(true)
    setNote('')
    try {
      const res = await adminFetch('/api/admin/brands/fetch-post', { method: 'POST', body: JSON.stringify({ url: u }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNote(j?.error || `Fetch failed (${res.status})`)
        return
      }
      const patch: Partial<ContentDraft> = {}
      if (j.platform === 'tiktok' || j.platform === 'instagram') patch.platform = j.platform
      if (j.thumbUrl) patch.thumbUrl = j.thumbUrl
      if (j.caption) patch.caption = j.caption
      onChange(patch)
      setNote(j.note || (j.thumbUrl ? 'Cover + caption pulled — add the view/like counts.' : 'Detected — fill in the details.'))
    } catch {
      setNote('Request failed — try again.')
    } finally {
      setFetching(false)
    }
  }

  async function uploadThumb(file: File) {
    setUploading(true)
    setNote('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'content')
      const res = await adminFetch('/api/admin/upload', { method: 'POST', body: fd })
      if (res.status === 503) {
        on503()
        return
      }
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNote(j?.error || 'Upload failed.')
        return
      }
      onChange({ thumbUrl: j.url })
    } catch {
      setNote('Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  // Live echo of the typed counts in the compact form the cards render ("1.8M"),
  // so the influencer can sanity-check the formatting as they type.
  const preview = (raw: string): string => {
    const n = parseCompact(raw)
    return n != null ? formatCount(n) : ''
  }
  const viewsPreview = preview(draft.views)
  const likesPreview = preview(draft.likes)

  return (
    <div className="content-row">
      <label className="content-thumb" title="Upload a cover image">
        {draft.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={draft.thumbUrl} alt="" />
        ) : (
          <span className="content-thumb-empty">{uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}</span>
        )}
        <input
          type="file"
          accept="image/*"
          aria-label="Upload cover image"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void uploadThumb(f)
            e.target.value = ''
          }}
        />
      </label>
      <div className="content-fields">
        <div className="content-url">
          <input
            className="input"
            placeholder="https://www.tiktok.com/@… or instagram.com/reel/…"
            value={draft.url}
            onChange={(e) => onChange({ url: e.target.value })}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void fetchPost()} disabled={fetching || !draft.url.trim()}>
            {fetching ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />} Fetch
          </button>
        </div>
        <input className="input" placeholder="Caption" value={draft.caption} onChange={(e) => onChange({ caption: e.target.value })} />
        <div className="content-stats">
          <input className="input" type="text" placeholder="Views (e.g. 1.8M)" value={draft.views} onChange={(e) => onChange({ views: e.target.value })} />
          <input className="input" type="text" placeholder="Likes (e.g. 198K)" value={draft.likes} onChange={(e) => onChange({ likes: e.target.value })} />
          {draft.platform && <span className="pill pill-muted">{draft.platform}</span>}
        </div>
        {(viewsPreview || likesPreview) && (
          <span className="field-hint">
            {viewsPreview && `${viewsPreview} views`}
            {viewsPreview && likesPreview ? ' · ' : ''}
            {likesPreview && `${likesPreview} likes`}
          </span>
        )}
        {note && <span className="field-hint">{note}</span>}
      </div>
      <button type="button" className="content-x" aria-label="Remove this content" onClick={onRemove}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
