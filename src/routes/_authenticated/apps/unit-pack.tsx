// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import UnitPackManagement from '@/components/unit-pack-management'

export const Route = createFileRoute('/_authenticated/apps/unit-pack')({
  beforeLoad: createStandardProtectedRoute('UNIT_PACK'),
  component: UnitPackManagement,
})

// Created and developed by Jai Singh
