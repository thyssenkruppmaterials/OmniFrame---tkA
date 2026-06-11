// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { createProtectedRouteBeforeLoad } from '@/lib/auth/route-protection'
import { WorkEngineSettingsPage } from '@/features/admin/work-engine/work-engine-settings-page'

export const Route = createFileRoute('/_authenticated/admin/work-engine/')({
  beforeLoad: createProtectedRouteBeforeLoad({
    routePath: '/admin/work-engine',
    resourcePermission: { action: 'manage', resource: 'work_queue' },
    forbiddenRedirect: '/403',
    enableDebug: false,
  }),
  component: WorkEngineSettingsPage,
})

// Created and developed by Jai Singh
