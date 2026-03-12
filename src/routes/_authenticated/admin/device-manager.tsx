import { createFileRoute } from '@tanstack/react-router'
import { createProtectedRouteBeforeLoad } from '@/lib/auth/route-protection'
import { DeviceManagerPage } from '@/features/admin/device-manager'

export const Route = createFileRoute('/_authenticated/admin/device-manager')({
  beforeLoad: createProtectedRouteBeforeLoad({
    routePath: '/admin/device-manager',
    resourcePermission: { action: 'manage', resource: 'system' },
    forbiddenRedirect: '/403',
    enableDebug: false,
  }),
  component: DeviceManagerPage,
})
// Developer and Creator: Jai Singh
