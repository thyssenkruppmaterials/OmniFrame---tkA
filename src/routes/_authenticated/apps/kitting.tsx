// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import KittingManagement from '@/components/kitting-management'

export const Route = createFileRoute('/_authenticated/apps/kitting')({
  beforeLoad: createStandardProtectedRoute('KITTING'),
  component: KittingManagement,
})

// Created and developed by Jai Singh
