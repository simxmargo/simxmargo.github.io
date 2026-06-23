import { AdminShell } from '@/components/admin/AdminShell'

// /admin — the private studio (gated by AdminGate in app/admin/layout.tsx).
// Two nav groups: media-kit management + the existing outreach studio.
export default function AdminPage() {
  return <AdminShell />
}
