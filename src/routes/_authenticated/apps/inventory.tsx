// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import InventoryManagement from '@/components/inventory-management'

export const Route = createFileRoute('/_authenticated/apps/inventory')({
  beforeLoad: createStandardProtectedRoute('INVENTORY'),
  component: InventoryManagement,
})

// Created and developed by Jai Singh
