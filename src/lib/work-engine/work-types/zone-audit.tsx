// Created and developed by Jai Singh
/**
 * zoneAuditWorkType — registry entry for the Zone Audit follow-on.
 *
 * Mission: an operator walks a zone (e.g. storage type 916 in PDC) and
 * verifies the bin-stock matches what SAP says it should be. Distinct from
 * cycle counts (which target one location at a time) — a zone audit is a
 * sweep that consumes one task per (location, material) pair derived from
 * an LT22 transfer-order pull.
 *
 * Frontend wiring is intentionally minimal for v1: the registry's existing
 * step components (`confirm` / `location_scan` / `quantity_entry` /
 * `review`) are driven directly from `useTaskWorkflowRuntime`, projecting
 * the discriminated-union `ZoneAuditTask.payload` onto the legacy
 * `taskData` shape that `StepProps` still expects. Phase 6 collapses both
 * adapters into a generic runtime.
 */
import { lazy, Suspense } from 'react'
import { Map } from 'lucide-react'
import type { WorkTask, WorkTypeId } from '@/lib/work-service/work-task-types'
import type { WorkTypeConfig, WorkflowStepConfig } from '../types'

// Extend the published `ZoneAuditTask` payload at the registry boundary so
// the LT22 dispatch path's metadata (the originating SAP transfer order)
// can flow through type-checked. The base interface in
// `work-task-types.ts` keeps `lt22_to_number` optional so older tasks
// (pre-LT22 dispatch) round-trip cleanly.
export interface ZoneAuditTaskPayload {
  zone_id: string
  expected_count: number
  lt22_to_number?: string | null
  counted_quantity?: number | null
}

export interface ZoneAuditTaskShape extends Omit<
  WorkTask,
  'task_type' | 'payload'
> {
  task_type: 'zone_audit'
  payload: ZoneAuditTaskPayload
}

const ZoneAuditRunner = lazy(() => import('./zone-audit-runner'))

const DEFAULT_ZONE_AUDIT_STEPS: WorkflowStepConfig[] = [
  {
    id: 'confirm',
    type: 'confirm',
    label: 'Confirm Zone',
    required: true,
    order: 1,
    config: {},
  },
  {
    id: 'location',
    type: 'location_scan',
    label: 'Scan Location',
    required: true,
    order: 2,
    config: {},
  },
  {
    id: 'quantity',
    type: 'quantity_entry',
    label: 'Enter Quantity',
    required: true,
    order: 3,
    config: {},
  },
  {
    id: 'review',
    type: 'review',
    label: 'Review',
    required: true,
    order: 4,
    config: {
      review_threshold_pct: 10,
      review_threshold_abs: 5,
    },
  },
]

function ZoneAuditRunnerAdapter({
  task,
  onExit,
}: {
  task: ZoneAuditTaskShape
  onExit: () => void
}) {
  return (
    <Suspense fallback={<div className='p-6'>Loading…</div>}>
      <ZoneAuditRunner task={task} onExit={onExit} />
    </Suspense>
  )
}

interface ZoneAuditFormState {
  countedQuantity?: number
  notes?: string
}

export function buildZoneAuditResultPayload(
  task: ZoneAuditTaskShape,
  state: unknown
): Record<string, unknown> {
  const s = (state ?? {}) as ZoneAuditFormState
  const counted = s.countedQuantity ?? task.payload.counted_quantity ?? 0
  const expected = task.payload.expected_count ?? 0
  return {
    counted_quantity: counted,
    notes: s.notes,
    variance_quantity: counted - expected,
  }
}

export const zoneAuditWorkType: WorkTypeConfig<WorkTask> = {
  id: 'zone_audit' satisfies WorkTypeId,
  label: 'Zone Audit',
  shortLabel: 'Audit',
  icon: Map,
  defaultSteps: DEFAULT_ZONE_AUDIT_STEPS,
  RootComponent: ZoneAuditRunnerAdapter as unknown as React.FC<{
    task: WorkTask
    onExit: () => void
  }>,
  buildResultPayload: (task, state) =>
    buildZoneAuditResultPayload(task as ZoneAuditTaskShape, state),
  capabilityRequired: 'zone_audit',
  dockMenuLabel: 'Zone Audit',
  enabled: true,
}

// Created and developed by Jai Singh
