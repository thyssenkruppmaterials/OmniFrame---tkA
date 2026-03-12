import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import UnitPackManagement from '@/components/unit-pack-management'

export const Route = createFileRoute('/_authenticated/apps/unit-pack')({
  beforeLoad: createStandardProtectedRoute('UNIT_PACK'),
  component: UnitPackManagement,
})
// Developer and Creator: Jai Singh
