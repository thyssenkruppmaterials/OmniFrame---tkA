// Created and developed by Jai Singh
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import {
  workflowConfigService,
  type WorkflowStepConfig,
  type WorkflowStepType,
} from '@/lib/supabase/workflow-config.service'
import { logger } from '@/lib/utils/logger'
import type { CycleCountTask } from '@/lib/work-service/types'

export interface TaskWorkflow {
  steps: WorkflowStepConfig[]
  reviewThresholdPct: number
  reviewThresholdAbs: number
  source: 'task' | 'snapshot' | 'live' | 'fallback'
  configId: string | null
  configVersion: number | null
}

/**
 * Fallback workflow used when no config + no snapshot is available. Mirrors
 * the legacy hardcoded flow so the RF UX keeps working even for orgs that
 * never configured workflows.
 */
const FALLBACK_WORKFLOW: TaskWorkflow = {
  steps: [
    {
      id: 'fallback-confirm',
      type: 'confirm',
      label: 'Confirm Item',
      required: true,
      order: 1,
      config: {},
    },
    {
      id: 'fallback-location',
      type: 'location_scan',
      label: 'Scan Location',
      required: true,
      order: 2,
      config: {},
    },
    {
      id: 'fallback-quantity',
      type: 'quantity_entry',
      label: 'Enter Quantity',
      required: true,
      order: 3,
      config: {},
    },
    {
      id: 'fallback-review',
      type: 'review',
      label: 'Variance Review',
      required: true,
      order: 4,
      config: { review_threshold_pct: 10, review_threshold_abs: 10 },
    },
  ],
  reviewThresholdPct: 10,
  reviewThresholdAbs: 10,
  source: 'fallback',
  configId: null,
  configVersion: null,
}

export const TASK_WORKFLOW_QUERY_KEY = 'task-workflow'

interface RawSnapshot {
  config_id?: string | null
  config_version?: number | null
  count_type?: string | null
  steps?: WorkflowStepConfig[] | null
}

interface RawTaskRow {
  workflow_config_id: string | null
  workflow_config_version: number | null
  workflow_snapshot: RawSnapshot | Record<string, never> | null
  review_threshold_pct: number | null
  review_threshold_abs: number | null
  count_type: string | null
}

function extractThresholds(
  steps: WorkflowStepConfig[],
  rowPct: number | null,
  rowAbs: number | null
): { pct: number; abs: number } {
  if (rowPct != null && rowAbs != null) {
    return { pct: Number(rowPct), abs: Number(rowAbs) }
  }
  const reviewStep = steps.find((s) => s.type === 'review')
  const cfg = (reviewStep?.config ?? {}) as Record<string, unknown>
  const pct =
    (cfg.review_threshold_pct as number | undefined) ??
    (cfg.variance_threshold_pct as number | undefined) ??
    (rowPct != null ? Number(rowPct) : 10)
  const abs =
    (cfg.review_threshold_abs as number | undefined) ??
    (cfg.variance_threshold_abs as number | undefined) ??
    (rowAbs != null ? Number(rowAbs) : 10)
  return { pct: Number(pct), abs: Number(abs) }
}

function sortSteps(steps: WorkflowStepConfig[]): WorkflowStepConfig[] {
  return [...steps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

/**
 * Extracts a workflow from the Rust work-service task payload (populated by
 * the SELECTs updated for migration 218). Returns `null` if the task has no
 * usable snapshot yet, in which case callers fall back to `useTaskWorkflow`.
 */
function workflowFromTask(task: CycleCountTask): TaskWorkflow | null {
  const snap = task.workflow_snapshot as {
    config_id?: string | null
    config_version?: number | null
    steps?: WorkflowStepConfig[]
  } | null
  const steps = snap && Array.isArray(snap.steps) ? snap.steps : null
  if (!steps || steps.length === 0) return null

  const sorted = sortSteps(steps)
  const thresholds = extractThresholds(
    sorted,
    task.review_threshold_pct,
    task.review_threshold_abs
  )
  return {
    steps: sorted,
    reviewThresholdPct: thresholds.pct,
    reviewThresholdAbs: thresholds.abs,
    source: 'task',
    configId: task.workflow_config_id ?? snap?.config_id ?? null,
    configVersion: task.workflow_config_version ?? snap?.config_version ?? null,
  }
}

/**
 * Fetches the workflow that applies to a specific cycle count task.
 *
 * Priority:
 *   1. `workflow_snapshot` embedded in the task payload (Rust work-service
 *      returns it for every task — post-migration 218). Zero-round-trip.
 *   2. Direct Supabase lookup of the row (fallback for payloads that don't
 *      include the field for some reason).
 *   3. Live lookup via `workflowConfigService.getSnapshotForTask(count_type)`
 *      — used when the row pre-dates migration 218 and somehow still lacks a
 *      snapshot.
 *   4. `FALLBACK_WORKFLOW` — guarantees the RF UX always has something to
 *      render.
 *
 * Accepts either a full task object (preferred — synchronous) or just
 * `{ taskId, countType }` (falls back to async fetch).
 */
export function useTaskWorkflow(params: {
  task?: CycleCountTask | null | undefined
  taskId?: string | null | undefined
  countType?: string | null | undefined
}): {
  workflow: TaskWorkflow
  isLoading: boolean
  error: Error | null
} {
  const { task, taskId: rawTaskId, countType: rawCountType } = params

  const taskId = task?.id ?? rawTaskId ?? null
  const countType = task?.count_type ?? rawCountType ?? null

  // Synchronous fast path: task payload already has the snapshot.
  const fromTask = useMemo(() => (task ? workflowFromTask(task) : null), [task])

  const { data, isLoading, error } = useQuery<TaskWorkflow>({
    queryKey: [TASK_WORKFLOW_QUERY_KEY, taskId, countType],
    // Skip the async query entirely if we already got the snapshot from the
    // task payload.
    enabled: !!taskId && !fromTask,
    staleTime: 5 * 60 * 1000, // 5 min — snapshots are version-pinned, safe to cache
    queryFn: async (): Promise<TaskWorkflow> => {
      if (!taskId) return FALLBACK_WORKFLOW

      // 1. Try the stamped snapshot on the row
      const { data: row, error: rowErr } = await supabase
        .from('rr_cyclecount_data')
        .select(
          'workflow_config_id, workflow_config_version, workflow_snapshot, review_threshold_pct, review_threshold_abs, count_type'
        )
        .eq('id', taskId)
        .maybeSingle<RawTaskRow>()

      if (rowErr) {
        logger.error('useTaskWorkflow: row lookup failed', rowErr)
      }

      const snapshot = row?.workflow_snapshot as RawSnapshot | null
      const snapshotSteps =
        snapshot && Array.isArray(snapshot.steps) ? snapshot.steps : null

      if (snapshotSteps && snapshotSteps.length > 0) {
        const sorted = sortSteps(snapshotSteps)
        const thresholds = extractThresholds(
          sorted,
          row?.review_threshold_pct ?? null,
          row?.review_threshold_abs ?? null
        )
        return {
          steps: sorted,
          reviewThresholdPct: thresholds.pct,
          reviewThresholdAbs: thresholds.abs,
          source: 'snapshot',
          configId: row?.workflow_config_id ?? snapshot?.config_id ?? null,
          configVersion:
            row?.workflow_config_version ?? snapshot?.config_version ?? null,
        }
      }

      // 2. Live lookup by count_type
      const effectiveCountType = countType ?? row?.count_type ?? null
      if (effectiveCountType) {
        const live =
          await workflowConfigService.getSnapshotForTask(effectiveCountType)
        if (live.data) {
          const sorted = sortSteps(live.data.steps)
          const thresholds = extractThresholds(
            sorted,
            row?.review_threshold_pct ?? live.data.review_threshold_pct,
            row?.review_threshold_abs ?? live.data.review_threshold_abs
          )
          return {
            steps: sorted,
            reviewThresholdPct: thresholds.pct,
            reviewThresholdAbs: thresholds.abs,
            source: 'live',
            configId: live.data.config_id,
            configVersion: live.data.config_version,
          }
        }
      }

      // 3. Fallback
      return FALLBACK_WORKFLOW
    },
  })

  return {
    workflow: fromTask ?? data ?? FALLBACK_WORKFLOW,
    isLoading: fromTask ? false : isLoading,
    error: error as Error | null,
  }
}

/** Convenience: does the workflow include a given step type? */
export function hasStepType(
  workflow: TaskWorkflow,
  type: WorkflowStepType
): boolean {
  return workflow.steps.some((s) => s.type === type)
}

/** Returns the step config for a type (if present). */
export function getStep(
  workflow: TaskWorkflow,
  type: WorkflowStepType
): WorkflowStepConfig | undefined {
  return workflow.steps.find((s) => s.type === type)
}

// Created and developed by Jai Singh
