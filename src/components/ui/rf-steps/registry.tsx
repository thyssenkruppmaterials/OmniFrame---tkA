// Created and developed by Jai Singh
/**
 * STEP_REGISTRY (Phase 5.2).
 *
 * Single map from `WorkflowStepConfig.type` to the React component that
 * renders it. Replaces the giant `ExtraStepRenderer` switch in
 * `rf-cycle-count-unified.tsx`.
 *
 * Unknown step types: in dev/test we throw to surface the typo loudly; in
 * production we render an operator-safe fallback and emit a telemetry
 * counter (Phase 12.3 `step_dwell_seconds(step_id='unknown')`).
 */
import React from 'react'
import { logger } from '@/lib/utils/logger'
import { RFStepBarcodeScan } from './rf-step-barcode-scan'
import { RFStepConditionAssessment } from './rf-step-condition-assessment'
import { RFStepConfirm } from './rf-step-confirm'
import { RFStepEmptyLocationVerification } from './rf-step-empty-location-verification'
import { RFStepFoundPartTransfer } from './rf-step-found-part-transfer'
import { RFStepLocationScan } from './rf-step-location-scan'
import { RFStepNotes } from './rf-step-notes'
import { RFStepPartNumberVerification } from './rf-step-part-number-verification'
import { RFStepPhotoCapture } from './rf-step-photo-capture'
import { RFStepQuantityEntry } from './rf-step-quantity-entry'
import { RFStepReview } from './rf-step-review'
import { RFStepSerialCapture } from './rf-step-serial-capture'
import { RFStepSupervisorSignoff } from './rf-step-supervisor-signoff'
import type { StepProps } from './types'

export type StepComponent = React.ComponentType<StepProps>

export const STEP_REGISTRY: Record<string, StepComponent> = {
  // Five "main" cycle-count steps newly exposed via the registry.
  confirm: RFStepConfirm,
  location_scan: RFStepLocationScan,
  quantity_entry: RFStepQuantityEntry,
  empty_location_verification: RFStepEmptyLocationVerification,
  review: RFStepReview,

  // Eight extra steps previously only reachable through `ExtraStepRenderer`.
  photo_capture: RFStepPhotoCapture,
  serial_number: RFStepSerialCapture,
  barcode_label_scan: RFStepBarcodeScan,
  notes: RFStepNotes,
  condition_assessment: RFStepConditionAssessment,
  supervisor_signoff: RFStepSupervisorSignoff,
  part_number_verification: RFStepPartNumberVerification,
  found_part_transfer: RFStepFoundPartTransfer,
}

/** Look up a step component. Throws in dev/test, fallback in production. */
export function resolveStep(type: string): StepComponent {
  const c = STEP_REGISTRY[type]
  if (c) return c
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    throw new Error(`STEP_REGISTRY: unknown step type '${type}'`)
  }
  logger.error(
    `STEP_REGISTRY: unknown step type '${type}' — rendering fallback`
  )
  return UnknownStepFallback
}

const UnknownStepFallback: StepComponent = ({ onComplete }) => (
  <div className='rounded border border-amber-300 p-4'>
    <div className='mb-2 font-medium text-amber-700'>
      Step temporarily unavailable
    </div>
    <div className='text-muted-foreground mb-4 text-sm'>
      We couldn’t render this workflow step. You can continue without it; please
      tell your supervisor so we can investigate.
    </div>
    <button
      onClick={() => onComplete({ skipped: true, reason: 'unknown_step_type' })}
      className='rounded border px-3 py-1.5 text-sm'
    >
      Skip
    </button>
  </div>
)

// Created and developed by Jai Singh
