import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import GrsManagement from '@/components/grs-management'

export const Route = createFileRoute('/_authenticated/apps/grs')({
  beforeLoad: createStandardProtectedRoute('GRS'),
  component: GrsManagement,
})
// Developer and Creator: Jai Singh
