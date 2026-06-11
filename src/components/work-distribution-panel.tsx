// Created and developed by Jai Singh
/**
 * Work Distribution Panel
 * Panel for supervisors to push work to specific operators
 * Part of Phase 6: Work Management System Redesign
 */
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Loader2,
  Lock,
  RotateCcw,
  Send,
  User,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import type { CycleCountData } from '@/lib/supabase/cycle-count.service'
import {
  deriveZone,
  parseZoneLockError,
} from '@/lib/supabase/zone-rules.service'
import { cn } from '@/lib/utils'
import { workServiceClient } from '@/lib/work-service/client'
import type { PushMode } from '@/lib/work-service/types'
import { useActiveWorkers } from '@/hooks/use-active-workers'
import {
  QUEUE_STATS_QUERY_KEY,
  WORK_QUEUE_QUERY_KEY,
  useWorkQueue,
} from '@/hooks/use-work-queue'
import { useActiveZones, useZoneAssignments } from '@/hooks/use-zone-rules'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

interface WorkDistributionPanelProps {
  selectedCounts: CycleCountData[]
  onPushComplete: () => void
}

/**
 * Format the per-zone failure buckets for a bulk-push toast description.
 * Keeps the message bounded — at most 3 zones per bucket, with an "+N
 * more" tail so a 50-row bulk push doesn't spam the corner of the screen.
 */
function formatPushFailureBuckets(
  reservedZones: Map<string, string[]>,
  assignedZones: Map<string, string[]>,
  otherFailures: string[]
): string | undefined {
  const parts: string[] = []
  const formatBucket = (label: string, m: Map<string, string[]>) => {
    if (m.size === 0) return null
    const entries = Array.from(m.entries())
    const head = entries.slice(0, 3).map(([z, cs]) => `${z} (${cs.length})`)
    const tail = entries.length > 3 ? `, +${entries.length - 3} more` : ''
    return `${label}: ${head.join(', ')}${tail}`
  }
  const a = formatBucket('zone reserved', reservedZones)
  const b = formatBucket('zone assigned to others', assignedZones)
  if (a) parts.push(a)
  if (b) parts.push(b)
  if (otherFailures.length > 0) {
    parts.push(`other: ${otherFailures.length}`)
  }
  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function WorkDistributionPanel({
  selectedCounts,
  onPushComplete,
}: WorkDistributionPanelProps) {
  const { workers, onlineCount } = useActiveWorkers()
  // `useWorkQueue` is still used for `isPushPending` so the disabled
  // state on the button mirrors a single-row supervisor push elsewhere
  // in the dashboard. The bulk push below bypasses the React Query
  // mutation and calls the work-service client directly so we get
  // per-row settle results without firing N success toasts.
  const { isPushPending } = useWorkQueue()
  const queryClient = useQueryClient()
  const { zones: activeZoneRows } = useActiveZones()
  const { assignments: zoneAssignments } = useZoneAssignments()
  const [pushMode, setPushMode] = useState<PushMode>('push')
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null)
  const [isPushing, setIsPushing] = useState(false)
  const [isReleasing, setIsReleasing] = useState(false)
  const [collisionOverride, setCollisionOverride] = useState(false)
  const [zoneOverride, setZoneOverride] = useState(false)
  const [returnConfirmOpen, setReturnConfirmOpen] = useState(false)

  const deriveAisleKey = (
    location: string | null | undefined
  ): string | null => {
    if (!location) return null
    const trimmed = location.trim()
    if (!trimmed) return null
    const segments = trimmed.split('-').filter(Boolean)
    if (segments.length >= 2) {
      return `${segments[0]}-${segments[1]}`.toUpperCase()
    }
    return trimmed.toUpperCase()
  }

  const releaseSelected = async () => {
    if (selectedCounts.length === 0) return
    setIsReleasing(true)
    try {
      for (const count of selectedCounts) {
        await workServiceClient.releaseTask(count.id)
      }
      toast.success(
        `Returned ${selectedCounts.length} count${selectedCounts.length !== 1 ? 's' : ''} to pull queue`,
        {
          description:
            'Assignment cleared — counts are now available to any operator.',
        }
      )
      onPushComplete()
    } catch {
      toast.error('Failed to return some counts to queue')
    } finally {
      setIsReleasing(false)
    }
  }

  const handleReturnToQueue = () => {
    if (selectedCounts.length === 0) return
    // Migration 252 review: explicit confirm with assignment-clear copy.
    setReturnConfirmOpen(true)
  }

  const handlePush = async () => {
    if (!selectedWorker || selectedCounts.length === 0) return
    if (zoneConflicts.length > 0 && !zoneOverride) {
      toast.error(
        'Zone reserved for another operator. Review the warning and confirm the override before pushing.'
      )
      return
    }
    if (hasCollisionRisk && !collisionOverride) {
      toast.warning(
        'Collision risk detected. Review the aisle warning and confirm override before pushing.'
      )
      return
    }

    setIsPushing(true)
    try {
      // Migration 253 review: aggregate per-row results via
      // `Promise.allSettled` and bucket failures by reason so the toast
      // tells supervisors WHICH counts failed and WHY. Previous loop
      // fire-and-forgot via `pushToUser({...})` (mutation.mutate is
      // synchronous from the caller's perspective), then immediately
      // ran `onPushComplete()` in `finally` — leaving zone-locked
      // failures completely silent at the panel level.
      const settled = await Promise.allSettled(
        selectedCounts.map((count) =>
          workServiceClient
            .pushToUser(count.id, selectedWorker)
            .then(() => ({ id: count.id, count_number: count.count_number }))
        )
      )

      const successes = settled.filter(
        (s) => s.status === 'fulfilled'
      ) as Array<PromiseFulfilledResult<{ id: string; count_number: string }>>
      const failures = settled.filter(
        (s) => s.status === 'rejected'
      ) as PromiseRejectedResult[]

      // Bucket failures by reason so the description is concise even
      // when many rows fail.
      const reservedZones = new Map<string, string[]>() // zone → count_numbers
      const assignedZones = new Map<string, string[]>()
      const otherFailures: string[] = []

      failures.forEach((rej, idx) => {
        const reason = rej.reason as unknown
        const parsed = parseZoneLockError(reason)
        const cn = selectedCounts[idx]?.count_number ?? '?'
        if (parsed.isZoneBlocked && parsed.zone) {
          const target =
            parsed.kind === 'assigned' ? assignedZones : reservedZones
          const arr = target.get(parsed.zone) ?? []
          arr.push(cn)
          target.set(parsed.zone, arr)
        } else {
          otherFailures.push(cn)
        }
      })

      // Always invalidate so the dashboard refreshes once for the
      // batch instead of N times per row.
      queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
      queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })

      if (failures.length === 0) {
        toast.success(
          `Pushed ${successes.length} count${successes.length === 1 ? '' : 's'} to operator.`
        )
      } else if (successes.length === 0) {
        const description = formatPushFailureBuckets(
          reservedZones,
          assignedZones,
          otherFailures
        )
        toast.error(
          `All ${failures.length} pushes failed.`,
          description ? { description } : undefined
        )
      } else {
        const description = formatPushFailureBuckets(
          reservedZones,
          assignedZones,
          otherFailures
        )
        toast.warning(
          `Pushed ${successes.length} count${successes.length === 1 ? '' : 's'}. ${failures.length} failed.`,
          description ? { description, duration: 8000 } : undefined
        )
      }

      onPushComplete()
    } finally {
      setIsPushing(false)
    }
  }

  // Filter to only online/idle/busy workers (not offline or on break)
  const onlineWorkers = workers.filter(
    (w) => w.status === 'online' || w.status === 'idle' || w.status === 'busy'
  )

  const selectedWorkerRecord = useMemo(
    () => workers.find((worker) => worker.user_id === selectedWorker) ?? null,
    [workers, selectedWorker]
  )

  const selectedCountAisles = useMemo(
    () =>
      selectedCounts
        .map(
          (count) =>
            ((count as Record<string, unknown>).resolved_aisle as
              | string
              | null) ?? deriveAisleKey(count.location)
        )
        .filter((value): value is string => Boolean(value)),
    [selectedCounts]
  )

  const workerActiveAisle = useMemo(
    () => deriveAisleKey(selectedWorkerRecord?.current_location ?? null),
    [selectedWorkerRecord]
  )

  const hasCollisionRisk = Boolean(
    selectedWorkerRecord?.status === 'busy' &&
    workerActiveAisle &&
    selectedCountAisles.includes(workerActiveAisle)
  )

  // Migration 252 review: zone preflight. For each selected count, derive
  // the count's zone and check whether another operator currently holds
  // that zone (active or reserved) OR an admin assigned the zone to a
  // different user. Surface the conflict before the push tries to write
  // and gets rejected by the trigger.
  const zoneConflicts = useMemo(() => {
    if (!selectedWorker || selectedCounts.length === 0) return []

    const conflictMap = new Map<
      string,
      {
        zone: string
        ownerName: string
        kind: 'reserved' | 'assigned'
        countNumbers: string[]
      }
    >()

    for (const count of selectedCounts) {
      const resolvedZone =
        ((count as Record<string, unknown>).resolved_zone as string | null) ??
        deriveZone(count.location)
      if (!resolvedZone) continue

      // (a) explicit zone-to-user assignment to someone else
      const assignment = zoneAssignments.find(
        (z) => z.zone.toUpperCase() === resolvedZone.toUpperCase()
      )
      if (assignment && assignment.user_id !== selectedWorker) {
        const key = `assigned:${resolvedZone}`
        const entry = conflictMap.get(key) ?? {
          zone: resolvedZone,
          ownerName:
            assignment.user_name || assignment.user_email || 'another operator',
          kind: 'assigned' as const,
          countNumbers: [],
        }
        entry.countNumbers.push(count.count_number)
        conflictMap.set(key, entry)
        continue
      }

      // (b) zone is currently held by another active/reserved counter
      const lockedRow = activeZoneRows.find(
        (z) =>
          z.zone.toUpperCase() === resolvedZone.toUpperCase() &&
          z.locked_by !== selectedWorker
      )
      if (lockedRow) {
        const key = `reserved:${resolvedZone}:${lockedRow.locked_by}`
        const entry = conflictMap.get(key) ?? {
          zone: resolvedZone,
          ownerName:
            lockedRow.locked_by_name ||
            lockedRow.locked_by_email ||
            'another operator',
          kind: 'reserved' as const,
          countNumbers: [],
        }
        entry.countNumbers.push(count.count_number)
        conflictMap.set(key, entry)
      }
    }

    return Array.from(conflictMap.values())
  }, [selectedCounts, selectedWorker, activeZoneRows, zoneAssignments])

  useEffect(() => {
    setCollisionOverride(false)
    setZoneOverride(false)
  }, [selectedWorker, selectedCounts])

  const isDisabled =
    !selectedWorker ||
    selectedCounts.length === 0 ||
    isPushPending ||
    isPushing ||
    pushMode === 'pull' ||
    (zoneConflicts.length > 0 && !zoneOverride)

  return (
    <Card className='border-primary/20 bg-primary/5'>
      <CardHeader className='pb-3'>
        <CardTitle className='flex items-center gap-2 text-lg'>
          <Send className='text-primary h-5 w-5' />
          Push Work to Operators
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
          {/* Left: Selected counts summary */}
          <div className='space-y-4'>
            <div>
              <Badge variant='secondary' className='px-3 py-1 text-base'>
                {selectedCounts.length} count
                {selectedCounts.length !== 1 ? 's' : ''} selected
              </Badge>
            </div>

            <RadioGroup
              value={pushMode}
              onValueChange={(v) => setPushMode(v as PushMode)}
              className='space-y-2'
            >
              <div className='flex items-center space-x-2'>
                <RadioGroupItem value='pull' id='pull' />
                <Label htmlFor='pull' className='cursor-pointer'>
                  IN (operators pull from queue)
                </Label>
              </div>
              <div className='flex items-center space-x-2'>
                <RadioGroupItem value='push' id='push' />
                <Label htmlFor='push' className='cursor-pointer'>
                  OUT (push to specific operator)
                </Label>
              </div>
            </RadioGroup>

            {/* Show selected counts preview (max 5) */}
            {selectedCounts.length > 0 && selectedCounts.length <= 5 && (
              <div className='text-muted-foreground mt-4 space-y-1.5 text-sm'>
                <Label className='text-muted-foreground text-xs'>
                  Selected Items:
                </Label>
                {selectedCounts.map((c) => (
                  <div key={c.id} className='flex items-center gap-2'>
                    <Badge
                      variant={
                        (c as Record<string, unknown>).priority === 'critical'
                          ? 'destructive'
                          : 'outline'
                      }
                      className='text-xs'
                    >
                      {((c as Record<string, unknown>).priority as string) ||
                        'normal'}
                    </Badge>
                    <span className='font-mono text-xs'>{c.count_number}</span>
                    <span className='max-w-[100px] truncate text-xs'>
                      {c.location}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {selectedCounts.length > 5 && (
              <p className='text-muted-foreground text-sm'>
                + {selectedCounts.length - 5} more count(s) selected
              </p>
            )}
          </div>

          {/* Right: Worker selection */}
          <div className='space-y-4'>
            <Label className='flex items-center gap-2 text-sm font-medium'>
              <Users className='h-4 w-4' />
              Available Operators ({onlineCount} online)
            </Label>

            <div className='bg-background max-h-48 space-y-2 overflow-auto rounded-md border p-2'>
              {onlineWorkers.length === 0 ? (
                <p className='text-muted-foreground py-4 text-center text-sm'>
                  No operators currently online
                </p>
              ) : (
                onlineWorkers.map((worker) => (
                  <div
                    key={worker.user_id}
                    className={cn(
                      'flex cursor-pointer items-center justify-between rounded-md p-2 transition-colors',
                      selectedWorker === worker.user_id
                        ? 'bg-primary/10 border-primary border'
                        : 'hover:bg-accent border border-transparent'
                    )}
                    onClick={() => setSelectedWorker(worker.user_id)}
                    role='button'
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setSelectedWorker(worker.user_id)
                      }
                    }}
                  >
                    <div className='flex items-center gap-2'>
                      <div
                        className={cn(
                          'h-2 w-2 rounded-full',
                          worker.status === 'busy'
                            ? 'bg-orange-500'
                            : 'bg-green-500'
                        )}
                      />
                      <User className='text-muted-foreground h-4 w-4' />
                      <span className='text-sm font-medium'>
                        {worker.full_name || 'Unknown'}
                      </span>
                    </div>
                    <div className='text-muted-foreground text-xs'>
                      {worker.status === 'busy' && worker.current_location
                        ? `@ ${worker.current_location}`
                        : worker.status === 'busy'
                          ? 'Busy'
                          : 'Available'}
                    </div>
                  </div>
                ))
              )}
            </div>

            {zoneConflicts.length > 0 && (
              <div className='rounded-md border border-rose-300 bg-rose-50 p-3 text-sm dark:border-rose-800 dark:bg-rose-950/30'>
                <div className='mb-2 flex items-start gap-2'>
                  <Lock className='mt-0.5 h-4 w-4 text-rose-600' />
                  <div className='flex-1 space-y-1.5'>
                    <p className='font-medium text-rose-800 dark:text-rose-200'>
                      Zone conflict — push may fail
                    </p>
                    {zoneConflicts.map((c) => (
                      <p
                        key={`${c.kind}-${c.zone}-${c.ownerName}`}
                        className='text-rose-700 dark:text-rose-300'
                      >
                        Zone{' '}
                        <span className='font-mono font-semibold'>
                          {c.zone}
                        </span>{' '}
                        is{' '}
                        {c.kind === 'assigned' ? 'assigned to' : 'reserved for'}{' '}
                        <span className='font-medium'>{c.ownerName}</span>.{' '}
                        {c.countNumbers.length > 1
                          ? `${c.countNumbers.length} of the selected counts will be blocked.`
                          : `Count ${c.countNumbers[0]} will be blocked.`}
                      </p>
                    ))}
                    <p className='text-xs text-rose-700/80 dark:text-rose-300/80'>
                      The DB trigger will reject this push unless you
                      force-assign.
                    </p>
                  </div>
                </div>
                <Button
                  type='button'
                  size='sm'
                  variant={zoneOverride ? 'secondary' : 'outline'}
                  onClick={() => setZoneOverride((prev) => !prev)}
                >
                  {zoneOverride
                    ? 'Override Confirmed (admin force)'
                    : 'Override and Push Anyway'}
                </Button>
              </div>
            )}

            {hasCollisionRisk && (
              <div className='rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30'>
                <div className='mb-2 flex items-start gap-2'>
                  <AlertTriangle className='mt-0.5 h-4 w-4 text-amber-600' />
                  <div>
                    <p className='font-medium text-amber-800 dark:text-amber-200'>
                      Aisle collision risk
                    </p>
                    <p className='text-amber-700 dark:text-amber-300'>
                      {selectedWorkerRecord?.full_name || 'Selected operator'}{' '}
                      is already active in aisle {workerActiveAisle}. Pushing
                      the selected count(s) may create a collision.
                    </p>
                  </div>
                </div>
                <Button
                  type='button'
                  size='sm'
                  variant={collisionOverride ? 'secondary' : 'outline'}
                  onClick={() => setCollisionOverride((prev) => !prev)}
                >
                  {collisionOverride
                    ? 'Override Confirmed'
                    : 'Override and Push Anyway'}
                </Button>
              </div>
            )}

            <Button
              onClick={handlePush}
              disabled={isDisabled}
              className='w-full'
              size='lg'
            >
              {isPushPending || isPushing ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Pushing...
                </>
              ) : (
                <>
                  <Send className='mr-2 h-4 w-4' />
                  Push {selectedCounts.length} Count
                  {selectedCounts.length !== 1 ? 's' : ''} to Operator
                </>
              )}
            </Button>

            {pushMode === 'pull' && (
              <Button
                onClick={handleReturnToQueue}
                disabled={selectedCounts.length === 0 || isReleasing}
                variant='outline'
                className='w-full'
                size='lg'
              >
                {isReleasing ? (
                  <>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    Releasing...
                  </>
                ) : (
                  <>
                    <RotateCcw className='mr-2 h-4 w-4' />
                    Return {selectedCounts.length} Count
                    {selectedCounts.length !== 1 ? 's' : ''} to Pull Queue
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
      <ConfirmDialog
        isOpen={returnConfirmOpen}
        onCancel={() => setReturnConfirmOpen(false)}
        title='Return to pull queue?'
        message={`Returning ${selectedCounts.length} count${selectedCounts.length !== 1 ? 's' : ''} to the pull queue clears their assignments. Any operator may then claim them on their next Pull Next.`}
        details={[
          'Assignment is cleared (assigned_to set to NULL).',
          'Any supervisor protection on these rows is lost.',
          'Counts return to the general pool for any operator.',
        ]}
        confirmText='Clear assignment & return'
        cancelText='Keep assigned'
        variant='warning'
        isProcessing={isReleasing}
        onConfirm={async () => {
          setReturnConfirmOpen(false)
          await releaseSelected()
        }}
      />
    </Card>
  )
}

// Created and developed by Jai Singh
