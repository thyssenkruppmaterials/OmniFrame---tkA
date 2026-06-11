// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { createProtectedRouteBeforeLoad } from '@/lib/auth/route-protection'
import { SAPTestingPage } from '@/features/admin/sap-testing'

export const Route = createFileRoute('/_authenticated/admin/sap-testing')({
  beforeLoad: createProtectedRouteBeforeLoad({
    routePath: '/admin/sap-testing',
    resourcePermission: { action: 'manage', resource: 'sap' },
    forbiddenRedirect: '/403',
    enableDebug: false,
  }),
  component: SAPTestingPage,
})

// Created and developed by Jai Singh
