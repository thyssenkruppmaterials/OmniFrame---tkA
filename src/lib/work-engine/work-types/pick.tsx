// Created and developed by Jai Singh
/**
 * pickWorkType — registry entry for the Picking follow-on.
 *
 * Mission: an operator pulls items from source bins to fulfill a transfer
 * order. Each `pick` task represents ONE line item on a SAP transfer
 * order. On operator confirmation OmniAgent fires `LT12` to confirm the
 * transfer-order line server-side (see `builtin-pick-completed` trigger
 * branch in `omni_agent/agent.py`).
 *
 * Frontend wiring mirrors the Zoning follow-on: the generic
 * `useTaskWorkflowRuntime` drives the five registry step components
 * (`confirm` / `location_scan` / `quantity_entry` / `barcode_label_scan`
 * / `review`) against the discriminated-union `PickTask.payload`. Phase
 * 6 collapses this adapter into the unified runtime.
 */
import { lazy, Suspense } from 'react'
import { PackageCheck } from 'lucide-react'
import type {
  PickTask,
  WorkTask,
  WorkTypeId,
} from '@/lib/work-service/work-task-types'
import type { WorkTypeConfig, WorkflowStepConfig } from '../types'

const PickRunner = lazy(() => import('./pick-runner'))

const DEFAULT_PICK_STEPS: WorkflowStepConfig[] = [
  {
    id: 'confirm',
    type: 'confirm',
    label: 'Confirm Pick',
    required: true,
    order: 1,
    config: {},
  },
  {
    id: 'location',
    type: 'location_scan',
    label: 'Scan Source Location',
    required: true,
    order: 2,
    config: {},
  },
  {
    id: 'quantity',
    type: 'quantity_entry',
    label: 'Enter Pick Quantity',
    required: true,
    order: 3,
    config: {},
  },
  {
    id: 'barcode',
    type: 'barcode_label_scan',
    label: 'Scan Pick Label',
    required: true,
    order: 4,
    config: {},
  },
  {
    id: 'review',
    type: 'review',
    label: 'Review',
    required: true,
    order: 5,
    config: {},
  },
]

function PickRunnerAdapter({
  task,
  onExit,
}: {
  task: PickTask
  onExit: () => void
}) {
  return (
    <Suspense fallback={<div className='p-6'>Loading…</div>}>
      <PickRunner task={task} onExit={onExit} />
    </Suspense>
  )
}

interface PickFormState {
  countedQuantity?: number
  scannedLocation?: string
  notes?: string
}

export function buildPickResultPayload(
  task: PickTask,
  state: unknown
): Record<string, unknown> {
  const s = (state ?? {}) as PickFormState
  const pickedQty = s.countedQuantity ?? task.payload.pick_qty ?? 0
  return {
    picked_qty: pickedQty,
    destination_location_confirmed:
      s.scannedLocation ?? task.payload.destination_location,
    notes: s.notes,
  }
}

export const pickWorkType: WorkTypeConfig<WorkTask> = {
  id: 'pick' satisfies WorkTypeId,
  label: 'Pick',
  shortLabel: 'Pick',
  icon: PackageCheck,
  defaultSteps: DEFAULT_PICK_STEPS,
  RootComponent: PickRunnerAdapter as unknown as React.FC<{
    task: WorkTask
    onExit: () => void
  }>,
  buildResultPayload: (task, state) =>
    buildPickResultPayload(task as PickTask, state),
  capabilityRequired: 'pick',
  dockMenuLabel: 'Pick',
  enabled: true,
}

// Created and developed by Jai Singh
