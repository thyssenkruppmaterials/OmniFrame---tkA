// Created and developed by Jai Singh
/**
 * Backwards-compatible re-export of the renamed `WorkflowErrorBoundary`
 * (Phase 4.5). Existing imports of `CycleCountErrorBoundary` /
 * `withCycleCountErrorBoundary` continue to work; new code should import
 * from `./WorkflowErrorBoundary`.
 *
 * This shim ships during the transition and is removed in Phase 8 cleanup.
 */
export {
  WorkflowErrorBoundary,
  CycleCountErrorBoundary,
  withCycleCountErrorBoundary,
  withWorkflowErrorBoundary,
} from './WorkflowErrorBoundary'

// Created and developed by Jai Singh
