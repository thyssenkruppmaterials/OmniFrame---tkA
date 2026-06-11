// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import { createProtectedRouteBeforeLoad } from '@/lib/auth/route-protection'
import WorkQueueAdministration from '@/features/admin/work-queue'

export const Route = createFileRoute('/_authenticated/admin/work-queue/')({
  beforeLoad: createProtectedRouteBeforeLoad({
    routePath: '/admin/work-queue',
    resourcePermission: { action: 'manage', resource: 'work_queue' },
    forbiddenRedirect: '/403',
    enableDebug: false,
  }),
  component: WorkQueueAdministration,
})

// Created and developed by Jai Singh
