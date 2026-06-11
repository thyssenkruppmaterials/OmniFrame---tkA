// Created and developed by Jai Singh
/**
 * Phase 13.4 — payload_version validator + migrator contract.
 */
import { describe, it, expect } from 'vitest'
import {
  validatePayload,
  migratePayload,
  latestPayloadVersion,
} from '../payload-schemas'

describe('payload schemas', () => {
  it('cycle_count v1 accepts a well-shaped payload', () => {
    expect(() =>
      validatePayload('cycle_count', 1, {
        system_quantity: 12,
        count_type: 'quantity_check',
      })
    ).not.toThrow()
  })

  it('cycle_count v1 rejects a missing required field', () => {
    expect(() =>
      validatePayload('cycle_count', 1, { system_quantity: 12 })
    ).toThrow()
  })

  it('migrates cycle_count v0 (legacy projection) → v1', () => {
    const out = migratePayload('cycle_count', 0, 1, {
      system_quantity: 9,
      count_type: 'quantity_check',
    })
    expect(out).toBeTruthy()
  })

  it('rejects downward migration', () => {
    expect(() => migratePayload('cycle_count', 1, 0, {} as unknown)).toThrow()
  })

  it('reports latest version per task type', () => {
    expect(latestPayloadVersion('cycle_count')).toBeGreaterThanOrEqual(1)
    expect(latestPayloadVersion('pick')).toBe(1)
  })

  it('throws on unknown task type', () => {
    // @ts-expect-error testing invalid input
    expect(() => validatePayload('not_a_type', 1, {})).toThrow()
  })
})

// Created and developed by Jai Singh
