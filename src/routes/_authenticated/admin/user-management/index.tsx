// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { createProtectedRouteBeforeLoad } from '@/lib/auth/route-protection'
import UserManagement from '@/features/user-management'

export const Route = createFileRoute('/_authenticated/admin/user-management/')({
  beforeLoad: createProtectedRouteBeforeLoad({
    routePath: '/admin/user-management',
    resourcePermission: { action: 'manage', resource: 'users' },
    forbiddenRedirect: '/403',
    enableDebug: false,
  }),
  component: UserManagement,
})

// Created and developed by Jai Singh
