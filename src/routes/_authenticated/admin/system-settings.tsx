import { createFileRoute } from '@tanstack/react-router'
import { createProtectedRouteBeforeLoad } from '@/lib/auth/route-protection'
import { SystemSettingsPage } from '@/features/admin/system-settings'

export const Route = createFileRoute('/_authenticated/admin/system-settings')({
  beforeLoad: createProtectedRouteBeforeLoad({
    routePath: '/admin/system-settings',
    resourcePermission: { action: 'manage', resource: 'settings' },
    forbiddenRedirect: '/403',
    enableDebug: false,
  }),
  component: SystemSettingsPage,
})
// Developer and Creator: Jai Singh
