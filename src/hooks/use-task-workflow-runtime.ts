// Created and developed by Jai Singh
/**
 * useTaskWorkflowRuntime<T> — generic workflow runtime (Phase 6.1).
 *
 * Generic over `T extends WorkTask`. Wraps:
 *   - draft persistence (debounced 3s, 1h TTL, scoped key per task type)
 *   - step navigation (advance/retreat/finish)
 *   - completion via the registry's `buildResultPayload` + the generic
 *     `workServiceClient.completeTask` (Phase 3.3)
 *
 * The cycle-count flow continues to use `useUnifiedCycleCount` for the
 * specifics of pull/push/heartbeat; this runtime is the *new* hook every
 * future WorkType adopts. Phase 6.6 collapses the two systems.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { logger } from '@/lib/utils/logger'
import { workTypeRegistry } from '@/lib/work-engine/registry'
import { workServiceClient } from '@/lib/work-service/client'
import type { WorkTask, WorkTypeId } from '@/lib/work-service/work-task-types'

const DRAFT_TTL_MS = 60 * 60 * 1000

interface DraftEnvelope {
  taskId: string
  formState: Record<string, unknown>
  stepIndex: number
  savedAt: number
}

function draftKey(taskType: WorkTypeId, userId: string, taskId: string) {
  return `work-draft-${taskType}-${userId}-${taskId}`
}

function readDraft(
  taskType: WorkTypeId,
  userId: string,
  taskId: string
): DraftEnvelope | null {
  try {
    const raw = localStorage.getItem(draftKey(taskType, userId, taskId))
    if (!raw) return null
    const env = JSON.parse(raw) as DraftEnvelope
    if (Date.now() - env.savedAt > DRAFT_TTL_MS) {
      localStorage.removeItem(draftKey(taskType, userId, taskId))
      return null
    }
    return env
  } catch {
    return null
  }
}

function writeDraft(
  taskType: WorkTypeId,
  userId: string,
  taskId: string,
  env: DraftEnvelope
) {
  try {
    localStorage.setItem(
      draftKey(taskType, userId, taskId),
      JSON.stringify(env)
    )
  } catch (e) {
    logger.error('useTaskWorkflowRuntime: draft write failed', e)
  }
}

function clearDraft(taskType: WorkTypeId, userId: string, taskId: string) {
  try {
    localStorage.removeItem(draftKey(taskType, userId, taskId))
  } catch {
    /* ignore */
  }
}

/**
 * Phase 5.6 — one-shot migration of legacy unscoped drafts.
 *
 * Reads `unified-cycle-count-draft-{userId}` and `cycle-count-draft-{taskId}`
 * from older versions; if either matches the current task it is copied to
 * the new scoped key and the legacy key is removed.
 */
export function migrateLegacyDraftIfPresent(
  taskType: WorkTypeId,
  userId: string,
  taskId: string
): void {
  const newKey = draftKey(taskType, userId, taskId)
  if (localStorage.getItem(newKey)) return // already on the new schema

  const legacyKeys = [
    `unified-cycle-count-draft-${userId}`,
    `cycle-count-draft-${taskId}`,
  ]
  for (const k of legacyKeys) {
    const raw = localStorage.getItem(k)
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as { taskId?: string }
      if (parsed.taskId === taskId) {
        localStorage.setItem(newKey, raw)
        localStorage.removeItem(k)
        return
      }
    } catch {
      /* skip malformed */
    }
  }
}

export interface UseTaskWorkflowRuntimeOptions<T extends WorkTask> {
  task: T | null
  userId: string
}

export interface UseTaskWorkflowRuntime<T extends WorkTask> {
  currentTask: T | null
  workflow: {
    steps: Array<{
      id: string
      type: string
      label: string
      order: number
      required: boolean
      config: Record<string, unknown>
    }>
  }
  formState: Record<string, unknown>
  stepIndex: number
  isFinished: boolean
  recordResult: (delta: Record<string, unknown>) => void
  advance: () => void
  retreat: () => void
  completeTask: (
    resultPayload: Record<string, unknown>,
    notes?: string
  ) => Promise<void>
  releaseTask: () => Promise<void>
}

export function useTaskWorkflowRuntime<T extends WorkTask>(
  opts: UseTaskWorkflowRuntimeOptions<T>
): UseTaskWorkflowRuntime<T> {
  const { task, userId } = opts
  const config = task ? workTypeRegistry[task.task_type] : null
  const steps = useMemo(
    () =>
      task?.workflow_snapshot &&
      Array.isArray((task.workflow_snapshot as { steps?: unknown[] }).steps)
        ? (
            task.workflow_snapshot as {
              steps: typeof config extends null
                ? never
                : NonNullable<typeof config>['defaultSteps']
            }
          ).steps
        : (config?.defaultSteps ?? []),
    [task, config]
  )

  const [formState, setFormState] = useState<Record<string, unknown>>({})
  const [stepIndex, setStepIndex] = useState(0)
  const [isFinished, setIsFinished] = useState(false)

  // One-shot draft restore on task change.
  useEffect(() => {
    if (!task || !userId) return
    migrateLegacyDraftIfPresent(task.task_type, userId, task.id)
    const env = readDraft(task.task_type, userId, task.id)
    if (env && env.taskId === task.id) {
      setFormState(env.formState ?? {})
      setStepIndex(env.stepIndex ?? 0)
    } else {
      setFormState({})
      setStepIndex(0)
    }
    setIsFinished(false)
  }, [task, userId])

  // Debounced 3s draft persistence.
  useEffect(() => {
    if (!task || !userId) return
    const t = setTimeout(() => {
      writeDraft(task.task_type, userId, task.id, {
        taskId: task.id,
        formState,
        stepIndex,
        savedAt: Date.now(),
      })
    }, 3_000)
    return () => clearTimeout(t)
  }, [task, userId, formState, stepIndex])

  const recordResult = useCallback((delta: Record<string, unknown>) => {
    setFormState((s) => ({ ...s, ...delta }))
  }, [])

  const advance = useCallback(() => {
    setStepIndex((i) => {
      if (i + 1 >= steps.length) {
        setIsFinished(true)
        return i
      }
      return i + 1
    })
  }, [steps.length])

  const retreat = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1))
  }, [])

  const completeTask = useCallback(
    async (resultPayload: Record<string, unknown>, notes?: string) => {
      if (!task) return
      // Phase 3.3 — generic completeTask accepts (id, { ...payload, notes }).
      await workServiceClient.completeTask(task.id, {
        counted_quantity:
          (resultPayload.counted_quantity as number | undefined) ?? 0,
        notes,
      })
      clearDraft(task.task_type, userId, task.id)
      setIsFinished(true)
    },
    [task, userId]
  )

  const releaseTask = useCallback(async () => {
    if (!task) return
    await workServiceClient.releaseTask(task.id)
    clearDraft(task.task_type, userId, task.id)
  }, [task, userId])

  return {
    currentTask: task,
    workflow: {
      steps: [...steps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    },
    formState,
    stepIndex,
    isFinished,
    recordResult,
    advance,
    retreat,
    completeTask,
    releaseTask,
  }
}

// Created and developed by Jai Singh
