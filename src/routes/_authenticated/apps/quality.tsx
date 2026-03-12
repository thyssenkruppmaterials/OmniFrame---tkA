import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import QualityManagement from '@/components/quality-management'

export const Route = createFileRoute('/_authenticated/apps/quality')({
  beforeLoad: createStandardProtectedRoute('QUALITY'),
  component: QualityManagement,
})
// Developer and Creator: Jai Singh
