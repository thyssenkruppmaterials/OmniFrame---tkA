// Created and developed by Jai Singh
/**
 * PickRunner — v1 thin wrapper that drives `useTaskWorkflowRuntime`
 * against `STEP_REGISTRY` for a `PickTask`.
 *
 * Phase 6 collapses this file and `cycle-count.tsx`'s adapter into a
 * single generic runtime; until then this is the minimum viable shell:
 *
 * 1. Pulls the workflow steps from the task's `workflow_snapshot` (or
 *    falls back to the registry default).
 * 2. Projects `task.payload.{pick_qty, destination_location,
 *    transfer_order, movement_type}` onto the cycle-count-shaped
 *    `StepProps.taskData` so the existing step components render
 *    unchanged.
 * 3. Records each step's result into formState, advances on
 *    `onComplete`, and submits the registry's `buildResultPayload` on
 *    the final step. Completion flips the row to `status='completed'`
 *    which the OmniAgent `builtin-pick-completed` Realtime trigger
 *    observes and fires LT12 against.
 */
import { useCallback, useMemo } from 'react'
import { PackageCheck } from 'lucide-react'
import { useSupabaseAuth } from '@/stores/supabaseAuthStore'
import type { WorkflowStepConfig as StrictWorkflowStepConfig } from '@/lib/supabase/workflow-config.service'
import { logger } from '@/lib/utils/logger'
import type { PickTask } from '@/lib/work-service/work-task-types'
import { useTaskWorkflowRuntime } from '@/hooks/use-task-workflow-runtime'
import { Button } from '@/components/ui/button'
import { resolveStep } from '@/components/ui/rf-steps/registry'
import { buildPickResultPayload } from './pick'

interface PickRunnerProps {
  task: PickTask
  onExit: () => void
}

export default function PickRunner({ task, onExit }: PickRunnerProps) {
  const userId = useSupabaseAuth((s) => s.profile?.id ?? '')

  const runtime = useTaskWorkflowRuntime<PickTask>({
    task,
    userId,
  })

  const currentStep = runtime.workflow.steps[runtime.stepIndex]

  const taskData = useMemo(
    () => ({
      count_number: task.task_number ?? '',
      material_number:
        task.subject_material ?? task.payload.transfer_order ?? '',
      material_description:
        task.subject_description ??
        `Pick TO ${task.payload.transfer_order ?? ''}`,
      location: task.primary_location,
      warehouse: task.warehouse,
      unit_of_measure: task.unit_of_measure ?? '',
      // `system_quantity` is the cycle-count-shaped key the existing
      // step components read; for pick we project `pick_qty` onto it.
      system_quantity: task.payload.pick_qty ?? 0,
      counted_quantity:
        (runtime.formState.countedQuantity as number | null | undefined) ??
        null,
      count_type: 'pick',
      priority: task.priority,
      // Extra fields surfaced via taskData for step renderers that want
      // pick-specific context (e.g. the review step showing the TO +
      // destination bin). StepProps.taskData is typed loosely so this
      // is safe.
      transfer_order: task.payload.transfer_order,
      destination_location: task.payload.destination_location,
      movement_type: task.payload.movement_type,
    }),
    [task, runtime.formState]
  )

  const handleStepComplete = useCallback(
    async (delta: Record<string, unknown>) => {
      runtime.recordResult(delta)
      const isLast = runtime.stepIndex >= runtime.workflow.steps.length - 1
      if (!isLast) {
        runtime.advance()
        return
      }
      const merged = { ...runtime.formState, ...delta }
      const resultPayload = buildPickResultPayload(task, merged)
      try {
        await runtime.completeTask(
          resultPayload,
          merged.notes as string | undefined
        )
        onExit()
      } catch (err) {
        logger.error('PickRunner: completeTask failed', err)
      }
    },
    [runtime, task, onExit]
  )

  if (!currentStep) {
    return (
      <div className='p-6 text-center'>
        <PackageCheck className='text-muted-foreground mx-auto mb-3 h-10 w-10' />
        <h3 className='mb-2 text-lg font-semibold'>No workflow steps</h3>
        <p className='text-muted-foreground mb-4 text-sm'>
          This pick task has no configured steps.
        </p>
        <Button variant='outline' onClick={onExit}>
          Back to dock
        </Button>
      </div>
    )
  }

  const StepComponent = resolveStep(currentStep.type)

  return (
    <div className='flex h-full flex-col'>
      <div className='border-b p-4'>
        <div className='flex items-center justify-between'>
          <div>
            <div className='text-muted-foreground text-xs tracking-wide uppercase'>
              Pick · Step {runtime.stepIndex + 1} of{' '}
              {runtime.workflow.steps.length}
            </div>
            <div className='font-semibold'>{currentStep.label}</div>
          </div>
          <Button variant='ghost' size='sm' onClick={onExit}>
            Exit
          </Button>
        </div>
      </div>
      <div className='flex-1 overflow-auto p-4'>
        <StepComponent
          step={currentStep as unknown as StrictWorkflowStepConfig}
          taskData={taskData}
          stepResult={runtime.formState}
          onComplete={handleStepComplete}
          onBack={runtime.retreat}
        />
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
