// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import GrsManagement from '@/components/grs-management'

export const Route = createFileRoute('/_authenticated/apps/grs')({
  beforeLoad: createStandardProtectedRoute('GRS'),
  component: GrsManagement,
})

// Created and developed by Jai Singh
