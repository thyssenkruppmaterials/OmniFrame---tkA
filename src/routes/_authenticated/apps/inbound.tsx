import { createFileRoute } from '@tanstack/react-router'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import InboundManagement from '@/components/inbound-management'

export const Route = createFileRoute('/_authenticated/apps/inbound')({
  beforeLoad: createStandardProtectedRoute('INBOUND'),
  component: InboundManagement,
})
// Developer and Creator: Jai Singh
