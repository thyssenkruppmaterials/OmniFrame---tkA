// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import OutboundManagement from '@/components/outbound-management'

export const Route = createFileRoute('/_authenticated/apps/outbound')({
  beforeLoad: createStandardProtectedRoute('OUTBOUND'),
  component: OutboundManagement,
})

// Created and developed by Jai Singh
