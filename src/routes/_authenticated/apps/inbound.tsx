// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import InboundManagement from '@/components/inbound-management'

export const Route = createFileRoute('/_authenticated/apps/inbound')({
  beforeLoad: createStandardProtectedRoute('INBOUND'),
  component: InboundManagement,
})

// Created and developed by Jai Singh
