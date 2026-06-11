// Created and developed by Jai Singh
/**
 * cycleCountWorkType — adapter that lets the existing
 * `RFCycleCountUnified` component plug into the registry without changing
 * its props (per plan §4.3 "CycleCountRunnerAdapter is mandatory before the
 * registry cutover").
 */
import { lazy, Suspense } from 'react'
import { Hash } from 'lucide-react'
import { workTaskToLegacyCycleCount } from '@/lib/work-service/adapters'
import type { CycleCountWorkTask } from '@/lib/work-service/work-task-types'
import type { WorkTypeConfig, WorkflowStepConfig } from '../types'

const RFCycleCountUnified = lazy(
  () => import('@/components/ui/rf-cycle-count-unified')
)

const DEFAULT_CYCLE_COUNT_STEPS: WorkflowStepConfig[] = [
  {
    id: 'confirm',
    type: 'confirm',
    label: 'Confirm',
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
    config: {},
  },
]

function CycleCountRunnerAdapter({
  task,
  onExit,
}: {
  task: CycleCountWorkTask
  onExit: () => void
}) {
  // Adapt the registry's `{task, onExit}` contract into the legacy
  // `{onBack, initialMode, onTaskChange}` props the existing
  // `RFCycleCountUnified` accepts. Phase 6 collapses these into the
  // generic runtime; until then this adapter is the seam.
  const legacy = workTaskToLegacyCycleCount(task)

  return (
    <Suspense fallback={<div className='p-6'>Loading…</div>}>
      <RFCycleCountUnified
        onBack={onExit}
        initialMode='pull'
        onTaskChange={() => {
          /* no-op — legacy component owns its own claim/push state for now */
        }}
        // Hint to the legacy component that a claimed task already exists.
        // The component currently ignores this prop; harmless to pass.
        // @ts-expect-error preseeded-task is a future-facing prop.
        preseededTask={legacy}
      />
    </Suspense>
  )
}

export const cycleCountWorkType: WorkTypeConfig<CycleCountWorkTask> = {
  id: 'cycle_count',
  label: 'Cycle Count',
  shortLabel: 'Count',
  icon: Hash,
  defaultSteps: DEFAULT_CYCLE_COUNT_STEPS,
  RootComponent: CycleCountRunnerAdapter,
  buildResultPayload: (task, state) => {
    const s = (state ?? {}) as { countedQuantity?: number; notes?: string }
    return {
      counted_quantity: s.countedQuantity ?? task.payload.counted_quantity,
      notes: s.notes,
      variance_quantity:
        (s.countedQuantity ?? task.payload.counted_quantity ?? 0) -
        (task.payload.system_quantity ?? 0),
    }
  },
  capabilityRequired: 'cycle_count',
  dockMenuLabel: 'Cycle Count',
  enabled: true,
}

// Created and developed by Jai Singh
