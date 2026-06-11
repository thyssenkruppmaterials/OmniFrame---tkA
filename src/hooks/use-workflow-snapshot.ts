// Created and developed by Jai Singh
/**
 * useWorkflowSnapshot — workflow-config resolver for cycle-count tasks
 * (Phase 6.0 rename of the original `use-task-workflow.ts`).
 *
 * The legacy export name `useTaskWorkflow` is retained as a deprecated
 * alias from `use-task-workflow.ts` until Phase 6 generic runtime is wired
 * into every caller.
 *
 * Behavior is unchanged from the original — this file is the renamed home
 * for the cycle-count-specific workflow snapshot resolver. The new generic
 * `useTaskWorkflow<T>` runtime lives in `use-task-workflow-runtime.ts`.
 */

export {
  useTaskWorkflow as useWorkflowSnapshot,
  hasStepType,
  getStep,
  TASK_WORKFLOW_QUERY_KEY,
} from './use-task-workflow'
export type { TaskWorkflow } from './use-task-workflow'

// Created and developed by Jai Singh
