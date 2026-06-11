// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import QualityManagement from '@/components/quality-management'

export const Route = createFileRoute('/_authenticated/apps/quality')({
  beforeLoad: createStandardProtectedRoute('QUALITY'),
  component: QualityManagement,
})

// Created and developed by Jai Singh
