// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { createProtectedRouteBeforeLoad } from '@/lib/auth/route-protection'
import { PerformanceMonitorPage } from '@/features/admin/performance-monitor'

export const Route = createFileRoute(
  '/_authenticated/admin/performance-monitor'
)({
  beforeLoad: createProtectedRouteBeforeLoad({
    routePath: '/admin/performance-monitor',
    resourcePermission: { action: 'read', resource: 'system' },
    forbiddenRedirect: '/403',
    enableDebug: false,
  }),
  component: PerformanceMonitorPage,
})

// Created and developed by Jai Singh
