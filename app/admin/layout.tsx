import type { Metadata } from 'next'
import { AdminGate } from '@/components/admin/AdminGate'

// The studio is private. noindex/nofollow keeps it out of search; the AdminGate
// (single passphrase, server-verified) wraps everything under /admin.
export const metadata: Metadata = {
  title: 'Studio · sim x margo',
  robots: { index: false, follow: false },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate>{children}</AdminGate>
}
