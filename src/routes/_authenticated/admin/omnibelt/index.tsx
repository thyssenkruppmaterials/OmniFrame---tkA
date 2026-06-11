// Created and developed by Jai Singh
/**
 * OmniBelt Admin Dashboard — route entry.
 *
 * P8 of the OmniBelt rollout (2026-05-24). Lives under
 * `/admin/omnibelt` with five sections selected via the `?section=`
 * search param: `overview | tools | roles | analytics | audit`.
 *
 * Protection is the standard admin pattern (`createProtectedRouteBeforeLoad`):
 *   1. Authentication required.
 *   2. Navigation permission on `/admin/omnibelt` from `navigation_items`
 *      (seeded by migration 328).
 *   3. `omnibelt.manage` resource permission (seeded by migration 327;
 *      granted to admin + superadmin).
 *
 * The route file ships only the route shell — every actual dashboard
 * surface lives under `src/features/admin/omnibelt-dashboard/` so
 * TanStack Router auto-code-splits the chunk and the always-resident
 * `feature-omnibelt` (launcher) chunk stays untouched.
 *
 * Section state is intentionally managed by the dashboard itself via
 * `useLocation` + `window.history.replaceState` rather than a typed
 * `validateSearch`. None of the surrounding routes use `validateSearch`,
 * so locking the shape here would tighten TanStack's inferred global
 * SEARCH union and break callers in `ProtectedRoute` / `rbac` middleware
 * that pass loose objects (`{ redirect }`, `{ reason }`). The runtime
 * narrowing happens inside `OmniBeltDashboard`.
 */
import { createFileRoute } from '@tanstack/react-router'
import { createProtectedRouteBeforeLoad } from '@/lib/auth/route-protection'
import { OmniBeltDashboard } from '@/features/admin/omnibelt-dashboard/OmniBeltDashboard'

export const Route = createFileRoute('/_authenticated/admin/omnibelt/')({
  beforeLoad: createProtectedRouteBeforeLoad({
    routePath: '/admin/omnibelt',
    resourcePermission: { action: 'manage', resource: 'omnibelt' },
    forbiddenRedirect: '/403',
    enableDebug: false,
  }),
  component: OmniBeltDashboard,
})

// Created and developed by Jai Singh
