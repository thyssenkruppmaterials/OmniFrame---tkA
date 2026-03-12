import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import DataManager from '@/components/data-manager'

export const Route = createFileRoute('/_authenticated/apps/data-manager')({
  beforeLoad: createStandardProtectedRoute('DATA_MANAGER'),
  component: DataManager,
})
// Developer and Creator: Jai Singh
