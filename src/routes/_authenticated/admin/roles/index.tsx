import { createFileRoute } from '@tanstack/react-router'
import { createProtectedRouteBeforeLoad } from '@/lib/auth/route-protection'
import RoleManagement from '@/features/admin/roles'

export const Route = createFileRoute('/_authenticated/admin/roles/')({
  beforeLoad: createProtectedRouteBeforeLoad({
    routePath: '/admin/roles',
    resourcePermission: { action: 'manage', resource: 'roles' },
    forbiddenRedirect: '/403',
    enableDebug: false,
  }),
  component: RoleManagement,
})
// Developer and Creator: Jai Singh
