// Created and developed by Jai Singh
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { WorkflowStepConfig } from '@/lib/supabase/workflow-config.service'
import { logger } from '@/lib/utils/logger'
import type { TaskWorkflow } from './use-task-workflow'

/**
 * Step types that appear as "extra" screens in the RF flow between the core
 * confirm → location → quantity → review → supervisor skeleton. These are
 * rendered using the reusable `src/components/ui/rf-steps/*` components.
 */
export type ExtraStepType =
  | 'barcode_label_scan'
  | 'part_number_verification'
  | 'found_part_transfer'
  | 'serial_number'
  | 'condition_assessment'
  | 'notes'
  | 'photo_capture'

export interface ExtraStepSlot {
  /**
   * Where in the skeleton this step sits.
   *   - `pre_count`  : after location verification, before quantity keypad.
   *   - `post_count` : after quantity submit, before review/supervisor.
   */
  placement: 'pre_count' | 'post_count'
  stepConfig: WorkflowStepConfig
}

const PRE_COUNT_TYPES: ExtraStepType[] = [
  'barcode_label_scan',
  'part_number_verification',
  'found_part_transfer',
]
const POST_COUNT_TYPES: ExtraStepType[] = [
  'serial_number',
  'condition_assessment',
  'notes',
  'photo_capture',
]

function bucketStep(step: WorkflowStepConfig): ExtraStepSlot | null {
  if (PRE_COUNT_TYPES.includes(step.type as ExtraStepType)) {
    return { placement: 'pre_count', stepConfig: step }
  }
  if (POST_COUNT_TYPES.includes(step.type as ExtraStepType)) {
    return { placement: 'post_count', stepConfig: step }
  }
  return null
}

function sortByOrder<T extends { stepConfig: WorkflowStepConfig }>(
  arr: T[]
): T[] {
  return [...arr].sort(
    (a, b) => (a.stepConfig.order ?? 0) - (b.stepConfig.order ?? 0)
  )
}

/**
 * Persists a single extra-step result onto `rr_cyclecount_data.workflow_result`
 * (a JSONB object keyed by step id).
 *
 * Best-effort: failures are logged but not thrown, so a transient Supabase
 * hiccup won't block the operator from finishing the count.
 */
export async function persistWorkflowResult(params: {
  taskId: string
  stepId: string
  result: unknown
}): Promise<void> {
  const { taskId, stepId, result } = params
  try {
    const { data: row, error: readErr } = await supabase
      .from('rr_cyclecount_data')
      .select('workflow_result')
      .eq('id', taskId)
      .maybeSingle()

    if (readErr) {
      logger.error('persistWorkflowResult: read failed', readErr)
    }

    const current = (row?.workflow_result ?? {}) as Record<string, unknown>
    const next = { ...current, [stepId]: result }

    const { error: updateErr } = await supabase
      .from('rr_cyclecount_data')
      .update({ workflow_result: next } as never)
      .eq('id', taskId)

    if (updateErr) {
      logger.error('persistWorkflowResult: update failed', updateErr)
    }
  } catch (err) {
    logger.error('persistWorkflowResult errored', err)
  }
}

/**
 * Drives the ordered list of extra steps during an RF cycle count, tracks
 * their captured results, and persists each result to `workflow_result` as
 * the operator progresses.
 *
 * `initialResults` seeds the in-memory results (and skips already-completed
 * extras) when an operator resumes an abandoned count. Typically passed the
 * task's `workflow_result` JSONB — any step id that already has a result
 * won't be shown again.
 */
export function useExtraWorkflowSteps(
  workflow: TaskWorkflow,
  initialResults?: Record<string, unknown>
) {
  const [preCountIndex, setPreCountIndex] = useState(0)
  const [postCountIndex, setPostCountIndex] = useState(0)
  const [results, setResults] = useState<Record<string, unknown>>(
    initialResults ?? {}
  )

  const { preCount, postCount } = useMemo(() => {
    const pre: ExtraStepSlot[] = []
    const post: ExtraStepSlot[] = []
    for (const step of workflow.steps) {
      const slot = bucketStep(step)
      if (!slot) continue
      if (slot.placement === 'pre_count') pre.push(slot)
      else post.push(slot)
    }
    return { preCount: sortByOrder(pre), postCount: sortByOrder(post) }
  }, [workflow.steps])

  // Re-hydrate indices + results when a task with existing workflow_result
  // loads. We advance past any extras whose id is already in
  // `workflow_result`, so returning operators don't re-do captured steps.
  const hydratedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!initialResults) return
    // Signature: which step ids + workflow steps are we hydrating against.
    const key =
      Object.keys(initialResults).sort().join('|') +
      '::' +
      workflow.steps.map((s) => s.id).join(',')
    if (hydratedKeyRef.current === key) return
    hydratedKeyRef.current = key

    setResults(initialResults)
    const firstUnfinished = (steps: ExtraStepSlot[]) => {
      for (let i = 0; i < steps.length; i++) {
        const id = steps[i].stepConfig.id
        if (!(id in initialResults)) return i
      }
      return steps.length
    }
    setPreCountIndex(firstUnfinished(preCount))
    setPostCountIndex(firstUnfinished(postCount))
  }, [initialResults, preCount, postCount, workflow.steps])

  const resetExtraSteps = useCallback(() => {
    setPreCountIndex(0)
    setPostCountIndex(0)
    setResults({})
  }, [])

  const recordResult = useCallback(
    (stepId: string, result: unknown, taskId: string | null) => {
      setResults((prev) => ({ ...prev, [stepId]: result }))
      if (taskId) {
        // Fire-and-forget; errors surface via logger, not the UI.
        void persistWorkflowResult({ taskId, stepId, result })
      }
    },
    []
  )

  const currentPreStep: ExtraStepSlot | null =
    preCountIndex < preCount.length ? preCount[preCountIndex] : null
  const currentPostStep: ExtraStepSlot | null =
    postCountIndex < postCount.length ? postCount[postCountIndex] : null

  return {
    preCountSteps: preCount,
    postCountSteps: postCount,
    preCountIndex,
    postCountIndex,
    currentPreStep,
    currentPostStep,
    results,
    setResults,
    resetExtraSteps,
    recordResult,
    advancePreStep: useCallback(() => setPreCountIndex((i) => i + 1), []),
    advancePostStep: useCallback(() => setPostCountIndex((i) => i + 1), []),
    retreatPreStep: useCallback(
      () => setPreCountIndex((i) => Math.max(0, i - 1)),
      []
    ),
    retreatPostStep: useCallback(
      () => setPostCountIndex((i) => Math.max(0, i - 1)),
      []
    ),
    hasPreSteps: preCount.length > 0,
    hasPostSteps: postCount.length > 0,
    allPreDone: preCountIndex >= preCount.length,
    allPostDone: postCountIndex >= postCount.length,
  }
}

// Created and developed by Jai Singh
