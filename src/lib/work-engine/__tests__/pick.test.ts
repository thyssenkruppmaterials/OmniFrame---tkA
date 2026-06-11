// Created and developed by Jai Singh
/**
 * Follow-on: Picking Work Type — registry + buildResultPayload contract.
 *
 * Mirrors the shape of `registry.test.ts` but narrowly scoped to the pick
 * entry (`src/lib/work-engine/work-types/pick.tsx`). This guards against
 * a future refactor accidentally regressing the pick config back to a
 * `disabledStub` (which would silently detach OmniAgent's
 * `builtin-pick-completed` trigger from any real tasks).
 */
import { describe, it, expect, vi } from 'vitest'
import type { PickTask } from '@/lib/work-service/work-task-types'

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))
vi.mock('@/lib/supabase/work-engine-settings.service', () => ({
  workEngineSettingsService: {},
  invalidateWorkEngineFlagCache: () => {},
}))

const { workTypeRegistry } = await import('../registry')
const { assertWorkTypeConfigComplete } = await import('../types')
const { buildPickResultPayload } = await import('../work-types/pick')

function makePickTask(
  overrides: Partial<PickTask> = {},
  payloadOverrides: Partial<PickTask['payload']> = {}
): PickTask {
  return {
    id: 'task-uuid-1',
    task_type: 'pick',
    task_subtype: 'standard_pick',
    task_number: 'PICK-0001',
    subject_material: 'MAT-123',
    subject_description: 'Test Pick',
    primary_location: 'BIN-A1',
    secondary_location: null,
    warehouse: 'PDC',
    unit_of_measure: 'EA',
    priority: 'normal',
    status: 'claimed',
    assigned_to: 'user-uuid-1',
    pushed_by: null,
    pushed_at: null,
    push_mode: 'pull',
    push_acknowledged: false,
    payload_version: 1,
    result_payload: null,
    organization_id: 'org-uuid-1',
    created_at: '2026-05-02T00:00:00Z',
    updated_at: '2026-05-02T00:00:00Z',
    ...overrides,
    payload: {
      pick_qty: 3,
      destination_location: 'DOCK-12',
      transfer_order: '0000012345',
      movement_type: '601',
      ...payloadOverrides,
    },
  }
}

describe('workTypeRegistry.pick', () => {
  it('is present in the registry and enabled', () => {
    const cfg = workTypeRegistry.pick
    expect(cfg).toBeTruthy()
    expect(cfg.id).toBe('pick')
    expect(cfg.enabled).toBe(true)
    expect(cfg.capabilityRequired).toBe('pick')
    expect(cfg.dockMenuLabel).toBe('Pick')
  })

  it('satisfies the WorkTypeConfig contract', () => {
    expect(() =>
      assertWorkTypeConfigComplete(workTypeRegistry.pick)
    ).not.toThrow()
  })

  it('has the v1 5-step default workflow (confirm → location_scan → quantity_entry → barcode_label_scan → review)', () => {
    const steps = workTypeRegistry.pick.defaultSteps
    expect(steps.map((s) => s.type)).toEqual([
      'confirm',
      'location_scan',
      'quantity_entry',
      'barcode_label_scan',
      'review',
    ])
    expect(steps.every((s) => s.required)).toBe(true)
    expect(steps.map((s) => s.order)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('buildPickResultPayload', () => {
  it('projects form state onto the { picked_qty, destination_location_confirmed, notes } shape', () => {
    const task = makePickTask()
    const state = {
      countedQuantity: 2,
      scannedLocation: 'DOCK-12',
      notes: 'partial pick, 1 short',
    }
    const out = buildPickResultPayload(task, state)
    expect(out).toEqual({
      picked_qty: 2,
      destination_location_confirmed: 'DOCK-12',
      notes: 'partial pick, 1 short',
    })
  })

  it('falls back to payload.pick_qty when form state has no quantity', () => {
    const task = makePickTask({}, { pick_qty: 5 })
    const out = buildPickResultPayload(task, {})
    expect(out.picked_qty).toBe(5)
    expect(out.destination_location_confirmed).toBe('DOCK-12')
    expect(out.notes).toBeUndefined()
  })

  it('tolerates a null/undefined state without throwing', () => {
    const task = makePickTask()
    expect(() => buildPickResultPayload(task, null)).not.toThrow()
    expect(() => buildPickResultPayload(task, undefined)).not.toThrow()
  })
})

// Created and developed by Jai Singh
