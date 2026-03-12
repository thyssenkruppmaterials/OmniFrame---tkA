import { createFileRoute } from '@tanstack/react-router'
import { Outlet } from '@tanstack/react-router'
import { createProtectedRouteBeforeLoad } from '@/lib/auth/route-protection'

export const Route = createFileRoute('/_authenticated/admin')({
  beforeLoad: createProtectedRouteBeforeLoad({
    routePath: '/admin',
    resourcePermission: { action: 'read', resource: 'admin' },
    forbiddenRedirect: '/403',
    enableDebug: false,
  }),
  component: AdminLayout,
})

function AdminLayout() {
  return <Outlet />
}
// Developer and Creator: Jai Singh
