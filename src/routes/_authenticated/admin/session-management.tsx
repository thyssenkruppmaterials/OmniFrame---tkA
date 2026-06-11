// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { createProtectedRouteBeforeLoad } from '@/lib/auth/route-protection'
import SessionManagement from '@/features/session-management'

export const Route = createFileRoute(
  '/_authenticated/admin/session-management'
)({
  beforeLoad: createProtectedRouteBeforeLoad({
    routePath: '/admin/session-management',
    resourcePermission: { action: 'manage', resource: 'sessions' },
    forbiddenRedirect: '/403',
    enableDebug: false,
  }),
  component: SessionManagement,
})

// Created and developed by Jai Singh
