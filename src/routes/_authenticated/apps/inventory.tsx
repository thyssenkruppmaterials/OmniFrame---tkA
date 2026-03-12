import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import InventoryManagement from '@/components/inventory-management'

export const Route = createFileRoute('/_authenticated/apps/inventory')({
  beforeLoad: createStandardProtectedRoute('INVENTORY'),
  component: InventoryManagement,
})
// Developer and Creator: Jai Singh
