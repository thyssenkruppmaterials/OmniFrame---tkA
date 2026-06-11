// Created and developed by Jai Singh
/**
 * ZoneAuditRunner — v1 thin wrapper that drives `useTaskWorkflowRuntime`
 * against `STEP_REGISTRY` for a `ZoneAuditTask`.
 *
 * Phase 6 collapses cycle-count's legacy `RFCycleCountUnified` and this
 * runner into a single generic runtime; until then this file is the
 * minimum viable shell:
 *
 * 1. Pulls the workflow steps from the task's `workflow_snapshot` (or
 *    falls back to the registry default).
 * 2. Projects `task.payload.{zone_id, expected_count}` onto the
 *    cycle-count-shaped `StepProps.taskData` so the existing step
 *    components render unchanged.
 * 3. Records each step's result into formState, advances on `onComplete`,
 *    and submits the registry's `buildResultPayload` on the final step.
 */
import { useCallback, useMemo } from 'react'
import { Map as MapIcon } from 'lucide-react'
import { useSupabaseAuth } from '@/stores/supabaseAuthStore'
import type { WorkflowStepConfig as StrictWorkflowStepConfig } from '@/lib/supabase/workflow-config.service'
import { logger } from '@/lib/utils/logger'
import { useTaskWorkflowRuntime } from '@/hooks/use-task-workflow-runtime'
import { Button } from '@/components/ui/button'
import { resolveStep } from '@/components/ui/rf-steps/registry'
import type { ZoneAuditTaskShape } from './zone-audit'
import { buildZoneAuditResultPayload } from './zone-audit'

interface ZoneAuditRunnerProps {
  task: ZoneAuditTaskShape
  onExit: () => void
}

export default function ZoneAuditRunner({
  task,
  onExit,
}: ZoneAuditRunnerProps) {
  const userId = useSupabaseAuth((s) => s.profile?.id ?? '')

  const runtime = useTaskWorkflowRuntime<ZoneAuditTaskShape>({
    task,
    userId,
  })

  const currentStep = runtime.workflow.steps[runtime.stepIndex]

  const taskData = useMemo(
    () => ({
      count_number: task.task_number ?? '',
      material_number: task.subject_material ?? task.payload.zone_id,
      material_description:
        task.subject_description ?? `Zone audit: ${task.payload.zone_id}`,
      location: task.primary_location,
      warehouse: task.warehouse,
      unit_of_measure: task.unit_of_measure ?? '',
      system_quantity: task.payload.expected_count ?? 0,
      counted_quantity:
        (runtime.formState.countedQuantity as number | null | undefined) ??
        task.payload.counted_quantity ??
        null,
      count_type: 'zone_audit',
      priority: task.priority,
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
      const resultPayload = buildZoneAuditResultPayload(task, merged)
      try {
        await runtime.completeTask(
          resultPayload,
          merged.notes as string | undefined
        )
        onExit()
      } catch (err) {
        logger.error('ZoneAuditRunner: completeTask failed', err)
      }
    },
    [runtime, task, onExit]
  )

  if (!currentStep) {
    return (
      <div className='p-6 text-center'>
        <MapIcon className='text-muted-foreground mx-auto mb-3 h-10 w-10' />
        <h3 className='mb-2 text-lg font-semibold'>No workflow steps</h3>
        <p className='text-muted-foreground mb-4 text-sm'>
          This zone-audit task has no configured steps.
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
              Zone Audit · Step {runtime.stepIndex + 1} of{' '}
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
