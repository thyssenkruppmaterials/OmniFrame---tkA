import { createFileRoute } from '@tanstack/react-router'
import { createProtectedRouteBeforeLoad } from '@/lib/auth/route-protection'
import PermissionManagement from '@/features/admin/permissions'

export const Route = createFileRoute('/_authenticated/admin/permissions/')({
  beforeLoad: createProtectedRouteBeforeLoad({
    routePath: '/admin/permissions',
    resourcePermission: { action: 'manage', resource: 'permissions' },
    forbiddenRedirect: '/403',
    enableDebug: false,
  }),
  component: PermissionManagement,
})
// Developer and Creator: Jai Singh
