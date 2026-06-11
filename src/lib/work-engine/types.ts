// Created and developed by Jai Singh
/**
 * WorkTypeConfig contract (Phase 4.1).
 *
 * Every WorkType implements this interface to plug into the registry. The
 * registry is consumed by:
 *   - the RF shell (dock items, RootComponent renderer);
 *   - the supervisor desktop (queue card layouts);
 *   - the generic `useTaskWorkflow<T>` runtime;
 *   - the WorkflowErrorBoundary (workTypeId tag).
 */
import type { LucideIcon } from 'lucide-react'
import type { WorkTask, WorkTypeId } from '@/lib/work-service/work-task-types'

export interface WorkflowStepConfig {
  id: string
  type: string
  label: string
  required: boolean
  order: number
  config: Record<string, unknown>
}

export interface WorkTypeConfig<T extends WorkTask = WorkTask> {
  id: WorkTypeId
  label: string
  shortLabel: string
  icon: LucideIcon
  defaultSteps: WorkflowStepConfig[]
  RootComponent: React.FC<{ task: T; onExit: () => void }>
  TaskCard?: React.FC<{ task: T }>
  validateComplete?: (task: T, formState: unknown) => string | null
  buildResultPayload: (task: T, formState: unknown) => Record<string, unknown>
  /** When falsy/undefined the work type stays hidden from the dock. */
  dockMenuLabel?: string | null
  /** Worker must hold this in `worker_capabilities.work_types` to claim. */
  capabilityRequired?: string
  /** Marks a stub/disabled type. RootComponent throws when instantiated. */
  enabled: boolean
}

/**
 * Registry self-validation: every WorkTypeConfig must populate id, label,
 * defaultSteps (possibly empty), RootComponent, and buildResultPayload. A
 * disabled stub still satisfies the contract — its RootComponent throws on
 * mount.
 */
export function assertWorkTypeConfigComplete(c: WorkTypeConfig): void {
  const missing: string[] = []
  if (!c.id) missing.push('id')
  if (!c.label) missing.push('label')
  if (!c.shortLabel) missing.push('shortLabel')
  if (typeof c.enabled !== 'boolean') missing.push('enabled')
  if (!Array.isArray(c.defaultSteps)) missing.push('defaultSteps')
  if (!c.RootComponent) missing.push('RootComponent')
  if (!c.buildResultPayload) missing.push('buildResultPayload')
  if (missing.length > 0) {
    throw new Error(
      `WorkTypeConfig(${c.id ?? '?'}) missing: ${missing.join(', ')}`
    )
  }
}

// Created and developed by Jai Singh
