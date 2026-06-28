import type { Metadata } from 'next'
import { AdminLogin } from '@/components/admin/AdminLogin'

// The studio is private. noindex/nofollow keeps it out of search; the AdminGate
// (single passphrase, server-verified) wraps everything under /admin.
export const metadata: Metadata = {
  title: { absolute: 'Studio · simxmargo' },
  robots: { index: false, follow: false },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminLogin>{children}</AdminLogin>
}
