// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { createProtectedRouteBeforeLoad } from '@/lib/auth/route-protection'
import { SupplyChainMappingPage } from '@/features/admin/supply-chain-mapping'

export const Route = createFileRoute(
  '/_authenticated/admin/supply-chain-mapping'
)({
  beforeLoad: createProtectedRouteBeforeLoad({
    routePath: '/admin/supply-chain-mapping',
    resourcePermission: { action: 'manage', resource: 'system' },
    forbiddenRedirect: '/403',
    enableDebug: false,
  }),
  component: SupplyChainMappingPage,
})

// Created and developed by Jai Singh
