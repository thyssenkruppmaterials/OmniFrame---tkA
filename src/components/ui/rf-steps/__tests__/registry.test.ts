// Created and developed by Jai Singh
/**
 * Phase 13.4 — STEP_REGISTRY exhaustiveness.
 */
import { describe, it, expect } from 'vitest'
import { STEP_REGISTRY, resolveStep } from '../registry'

const REQUIRED_TYPES = [
  // 5 main steps newly exposed via the registry
  'confirm',
  'location_scan',
  'quantity_entry',
  'empty_location_verification',
  'review',
  // 8 extras
  'photo_capture',
  'serial_number',
  'barcode_label_scan',
  'notes',
  'condition_assessment',
  'supervisor_signoff',
  'part_number_verification',
  'found_part_transfer',
]

describe('STEP_REGISTRY', () => {
  it('registers every required step type', () => {
    for (const t of REQUIRED_TYPES) {
      expect(STEP_REGISTRY[t]).toBeTruthy()
    }
  })

  it('resolveStep throws for unknown types in dev/test', () => {
    expect(() => resolveStep('not_a_step_type')).toThrow(/unknown/i)
  })
})

// Created and developed by Jai Singh
