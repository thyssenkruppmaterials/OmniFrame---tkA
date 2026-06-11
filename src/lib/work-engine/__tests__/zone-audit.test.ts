// Created and developed by Jai Singh
/**
 * Zoning follow-on — assert the zone_audit registry entry is real.
 *
 * The registry exhaustiveness gate (in `registry.test.ts`) already covers
 * the union shape; this file is the per-WorkType happy-path:
 *  1. `zone_audit` is enabled in the registry,
 *  2. its config satisfies `assertWorkTypeConfigComplete`,
 *  3. `buildResultPayload` produces the expected SAP-comparable shape.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))
vi.mock('@/lib/supabase/work-engine-settings.service', () => ({
  workEngineSettingsService: {},
  invalidateWorkEngineFlagCache: () => {},
}))

const { workTypeRegistry } = await import('../registry')
const { assertWorkTypeConfigComplete } = await import('../types')
const { zoneAuditWorkType, buildZoneAuditResultPayload } =
  await import('../work-types/zone-audit')

const mockTask = {
  id: 'task-uuid-1',
  task_type: 'zone_audit' as const,
  task_subtype: 'standard_audit',
  task_number: 'ZA-0001',
  subject_material: '23089792',
  subject_description: null,
  primary_location: '916-A1-01',
  secondary_location: null,
  warehouse: 'PDC',
  unit_of_measure: 'EA',
  priority: 'normal' as const,
  status: 'pending' as const,
  assigned_to: null,
  pushed_by: null,
  pushed_at: null,
  push_mode: 'pull' as const,
  push_acknowledged: false,
  payload_version: 1,
  result_payload: null,
  organization_id: 'c9d89a74-7179-4033-93ea-56267cf42a17',
  created_at: '',
  updated_at: '',
  payload: {
    zone_id: '916',
    expected_count: 12,
    lt22_to_number: '0010234567',
  },
}

describe('zone_audit WorkType registry entry', () => {
  it('is enabled in the registry', () => {
    expect(workTypeRegistry.zone_audit).toBeTruthy()
    expect(workTypeRegistry.zone_audit.id).toBe('zone_audit')
    expect(workTypeRegistry.zone_audit.enabled).toBe(true)
  })

  it('exposes a complete WorkTypeConfig (passes the registry exhaustiveness gate)', () => {
    expect(() =>
      assertWorkTypeConfigComplete(workTypeRegistry.zone_audit)
    ).not.toThrow()
  })

  it('declares the four default workflow steps from STEP_REGISTRY', () => {
    const stepTypes = zoneAuditWorkType.defaultSteps.map((s) => s.type)
    expect(stepTypes).toEqual([
      'confirm',
      'location_scan',
      'quantity_entry',
      'review',
    ])
  })

  it('requires the `zone_audit` capability and exposes the dock label', () => {
    expect(zoneAuditWorkType.capabilityRequired).toBe('zone_audit')
    expect(zoneAuditWorkType.dockMenuLabel).toBe('Zone Audit')
  })
})

describe('buildZoneAuditResultPayload', () => {
  it('returns counted_quantity / variance_quantity / notes from form state', () => {
    const out = buildZoneAuditResultPayload(mockTask, {
      countedQuantity: 5,
      notes: 'two missing',
    })
    expect(out).toEqual({
      counted_quantity: 5,
      variance_quantity: 5 - 12,
      notes: 'two missing',
    })
  })

  it('falls back to the task payload counted_quantity when state omits it', () => {
    const out = buildZoneAuditResultPayload(
      { ...mockTask, payload: { ...mockTask.payload, counted_quantity: 9 } },
      {}
    )
    expect(out.counted_quantity).toBe(9)
    expect(out.variance_quantity).toBe(9 - 12)
  })

  it('treats missing counted_quantity as 0 (operator confirmed empty bin)', () => {
    const out = buildZoneAuditResultPayload(mockTask, {})
    expect(out.counted_quantity).toBe(0)
    expect(out.variance_quantity).toBe(-12)
  })
})

// Created and developed by Jai Singh
