import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import KittingManagement from '@/components/kitting-management'

export const Route = createFileRoute('/_authenticated/apps/kitting')({
  beforeLoad: createStandardProtectedRoute('KITTING'),
  component: KittingManagement,
})
// Developer and Creator: Jai Singh
