// Created and developed by Jai Singh
/**
 * ClaimBlockedRibbon — admin-only persistent banner for the work-distribution
 * "queue not empty but claim returned None" cascade.
 *
 * T-3 (2026-05-18) from
 * `Decisions/ADR-Work-Distribution-Pipeline-Architecture-Review-2026-05-18.md`.
 * Subscribes to `WsEvent::ClaimBlockedByZone` on `workServiceWs`. When an
 * event fires, renders a sticky amber ribbon at the top of the admin shell
 * with the unassigned + stuck counts and a link to the Inventory →
 * Count Settings → Zone Rules → Stuck Assignments card. The ribbon
 * auto-clears when:
 *   - a `TaskAssigned` event arrives (someone got a row, cascade unblocked), OR
 *   - 5 minutes elapsed since the last `ClaimBlockedByZone` event, OR
 *   - the admin manually dismisses.
 *
 * Gated by `<CanAccess action="view" resource="inventory_apps">` so the
 * banner only renders for users who can act on the alert. Non-admins see
 * nothing.
 *
 * Render site: `<AuthenticatedLayout>`. Not part of the RF terminal flow
 * (RF lives outside `_authenticated`, so this component never mounts
 * there — operators don't get adminy banners they can't act on).
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, X } from 'lucide-react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { cn } from '@/lib/utils'
import { workServiceWs, type WsEvent } from '@/lib/work-service'
import { CanAccess } from '@/hooks/use-rbac'
import { Button } from '@/components/ui/button'

interface AlertState {
  unassignedPending: number
  stuckPendingAssigned: number
  taskType: string
  lastEventAt: number
}

/** TTL after the last `ClaimBlockedByZone` event before the ribbon hides. */
const RIBBON_TTL_MS = 5 * 60_000

function ClaimBlockedRibbonInner() {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id
  const [alert, setAlert] = useState<AlertState | null>(null)

  const handleEvent = useCallback((event: WsEvent) => {
    if (event.type === 'ClaimBlockedByZone') {
      setAlert({
        unassignedPending: event.unassigned_pending ?? 0,
        stuckPendingAssigned: event.stuck_pending_assigned ?? 0,
        taskType: event.task_type ?? 'cycle_count',
        lastEventAt: Date.now(),
      })
      return
    }
    if (event.type === 'TaskAssigned') {
      // Someone successfully claimed a task — cascade is unblocked
      // (at least partially). Clear the ribbon; if it re-fires we'll
      // hear from the next ClaimBlockedByZone event.
      setAlert(null)
    }
  }, [])

  useEffect(() => {
    if (!organizationId) return
    workServiceWs.connect(organizationId, handleEvent)
    return () => {
      workServiceWs.removeHandler(handleEvent)
    }
  }, [organizationId, handleEvent])

  useEffect(() => {
    if (!alert) return
    const elapsed = Date.now() - alert.lastEventAt
    const remaining = RIBBON_TTL_MS - elapsed
    if (remaining <= 0) {
      setAlert(null)
      return
    }
    const timer = setTimeout(() => setAlert(null), remaining)
    return () => clearTimeout(timer)
  }, [alert])

  if (!alert) return null

  return (
    <div
      role='status'
      aria-live='polite'
      className={cn(
        'border-b border-amber-500/40 bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950/30',
        'flex items-center justify-between gap-3'
      )}
    >
      <div className='flex items-center gap-2 text-amber-900 dark:text-amber-200'>
        <AlertTriangle className='size-4 text-amber-600' aria-hidden />
        <span>
          <strong>{alert.taskType}</strong> queue blocked:{' '}
          <strong>{alert.unassignedPending}</strong>{' '}
          {alert.unassignedPending === 1 ? 'count' : 'counts'} ready,{' '}
          <strong>{alert.stuckPendingAssigned}</strong> stale soft-reservation
          {alert.stuckPendingAssigned === 1 ? '' : 's'} occupying zones.
        </span>
      </div>
      <div className='flex items-center gap-2'>
        <Link
          to='/apps/inventory'
          className='font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300'
        >
          View Stuck Assignments
        </Link>
        <Button
          variant='ghost'
          size='icon'
          aria-label='Dismiss'
          className='size-7'
          onClick={() => setAlert(null)}
        >
          <X className='size-3.5' />
        </Button>
      </div>
    </div>
  )
}

/**
 * Public wrapper: gates the inner ribbon by the `inventory_apps:view`
 * permission so only users who can actually navigate to the Inventory admin
 * (the surface that hosts the stuck-assignments mitigation UI) see the
 * banner. Same gate the route guard at
 * `src/routes/_authenticated/apps/inventory.tsx` uses.
 */
export function ClaimBlockedRibbon() {
  return (
    <CanAccess action='view' resource='inventory_apps'>
      <ClaimBlockedRibbonInner />
    </CanAccess>
  )
}

// Created and developed by Jai Singh
