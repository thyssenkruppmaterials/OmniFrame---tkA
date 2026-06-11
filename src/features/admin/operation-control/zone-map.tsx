// Created and developed by Jai Singh
/**
 * Zone Map — primary surface. Each zone is a drop target. An operator card
 * dragged onto a zone fires `operationControlClient.reassignZone(...)`.
 *
 * Visual layer rebuilt to match the OmniFrame design system: shadcn Card
 * primitives + theme tokens, with severity expressed via color-graded
 * borders. The reassignment confirmation uses the project's Dialog
 * primitive for proper modal semantics + a11y.
 */
import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { operationControlClient } from '@/lib/work-service/operation-control.client'
import type {
  ZoneStateView,
  OperatorStateView,
} from '@/hooks/use-work-engine-live'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  zones: ZoneStateView[]
  operators: OperatorStateView[]
}

type Severity = ZoneStateView['severity']

const SEVERITY_BORDER: Record<Severity, string> = {
  breach: 'border-destructive/60 motion-safe:animate-pulse',
  stressed: 'border-amber-500/50 dark:border-amber-400/50',
  healthy: 'border-sky-500/40 dark:border-sky-400/40',
  idle: 'border-emerald-500/40 dark:border-emerald-400/40',
}

const SEVERITY_LABEL: Record<Severity, string> = {
  breach: 'text-destructive',
  stressed: 'text-amber-600 dark:text-amber-400',
  healthy: 'text-sky-600 dark:text-sky-400',
  idle: 'text-emerald-600 dark:text-emerald-400',
}

export function ZoneMap({ zones, operators }: Props) {
  const [busyZone, setBusyZone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hoverZone, setHoverZone] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{
    zone: string
    from: string | null
    to: string
  } | null>(null)

  function onDragOver(zone: string, e: React.DragEvent) {
    if (e.dataTransfer.types.includes('application/x-omni-operator')) {
      e.preventDefault()
      setHoverZone(zone)
    }
  }

  function onDragLeave(zone: string) {
    setHoverZone((cur) => (cur === zone ? null : cur))
  }

  function onDrop(zone: ZoneStateView, e: React.DragEvent) {
    setHoverZone(null)
    const userId = e.dataTransfer.getData('application/x-omni-operator')
    if (!userId) return
    e.preventDefault()
    if (zone.owner_user_id && zone.owner_user_id !== userId) {
      setConfirm({ zone: zone.zone, from: zone.owner_user_id, to: userId })
      return
    }
    void runReassign(zone.zone, zone.owner_user_id, userId, 'soft')
  }

  async function runReassign(
    zone: string,
    from: string | null,
    to: string,
    mode: 'soft' | 'hard'
  ) {
    if (!from) return
    setBusyZone(zone)
    setError(null)
    try {
      await operationControlClient.reassignZone({
        zone,
        from_user_id: from,
        to_user_id: to,
        mode,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyZone(null)
      setConfirm(null)
    }
  }

  if (zones.length === 0) {
    return (
      <div className='text-muted-foreground flex flex-col items-center justify-center gap-2 py-10 text-center text-sm'>
        <MapPin className='h-5 w-5 opacity-50' />
        <p>
          No work yet — pull data from CSV import or run an LT22 import via SAP
          Testing.
        </p>
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      {error && <div className='text-destructive text-xs'>{error}</div>}
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4'>
        {zones.map((z) => {
          const owner = z.owner_user_id
            ? operators.find((o) => o.user_id === z.owner_user_id)
            : null
          const ageMin = Math.round(z.oldest_reservation_age_s / 60)
          return (
            <Card
              key={z.zone}
              onDragOver={(e) => onDragOver(z.zone, e)}
              onDragLeave={() => onDragLeave(z.zone)}
              onDrop={(e) => onDrop(z, e)}
              className={cn(
                'gap-1 border-2 py-3 transition-shadow',
                SEVERITY_BORDER[z.severity],
                hoverZone === z.zone && 'ring-primary ring-2',
                busyZone === z.zone && 'opacity-50'
              )}
            >
              <CardContent className='space-y-1.5 px-3 text-xs'>
                <div className='flex items-center justify-between'>
                  <span className='font-mono text-sm font-semibold'>
                    {z.zone}
                  </span>
                  <span
                    className={cn(
                      'text-[10px] font-medium tracking-wide uppercase',
                      SEVERITY_LABEL[z.severity]
                    )}
                  >
                    {z.severity}
                  </span>
                </div>
                <div className='text-muted-foreground truncate'>
                  Owner: {owner?.full_name ?? z.owner_name ?? '—'}
                </div>
                <div className='tabular-nums'>
                  Active: {z.active_count} · Pending: {z.pending_count}
                </div>
                <div className='text-muted-foreground tabular-nums'>
                  Reservation age: {ageMin}m
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign zone {confirm?.zone}?</DialogTitle>
            <DialogDescription>
              Soft = wait for the current task to finish. Hard = release the
              current task immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant='secondary'
              onClick={() =>
                confirm &&
                runReassign(confirm.zone, confirm.from, confirm.to, 'soft')
              }
            >
              Soft reassign
            </Button>
            <Button
              variant='destructive'
              onClick={() =>
                confirm &&
                runReassign(confirm.zone, confirm.from, confirm.to, 'hard')
              }
            >
              Hard reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Created and developed by Jai Singh
