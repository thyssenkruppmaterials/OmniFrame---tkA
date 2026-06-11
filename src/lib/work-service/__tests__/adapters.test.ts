// Created and developed by Jai Singh
/**
 * Phase 13.4 — Discriminated-union round-trip via legacy adapters.
 */
import { describe, it, expect } from 'vitest'
import {
  legacyCycleCountToWorkTask,
  workTaskToLegacyCycleCount,
} from '../adapters'
import type { CycleCountTask } from '../types'

const SAMPLE: CycleCountTask = {
  id: '00000000-0000-0000-0000-000000000001',
  count_number: 'CC-001',
  material_number: 'PART-A',
  material_description: 'Test part',
  location: 'A1-04-12',
  warehouse: 'PDC',
  system_quantity: 10,
  counted_quantity: null,
  unit_of_measure: 'EA',
  priority: 'normal',
  status: 'pending',
  count_type: 'quantity_check',
  assigned_to: null,
  assigned_at: null,
  push_mode: 'pull',
  pushed_by: null,
  pushed_at: null,
  push_acknowledged: false,
  organization_id: '00000000-0000-0000-0000-000000000099',
  completed_at: null,
  recount_by: null,
  recount_date: null,
  recount_completed: false,
  requires_recount: false,
  counter_name: null,
  resolved_location_key: null,
  resolved_zone: null,
  resolved_aisle: null,
  resolved_sequence: null,
  resolution_source: null,
  workflow_config_id: null,
  workflow_config_version: null,
  workflow_snapshot: {},
  workflow_result: {},
  evidence_photo_urls: [],
  review_threshold_pct: null,
  review_threshold_abs: null,
  scanned_material_number: null,
  location_reported_empty: null,
  part_variance: null,
  scanned_parts: [],
  transfer_destination_location: null,
  transfer_source_quantity: null,
}

describe('cycle-count adapters', () => {
  it('round-trips legacy → work-task → legacy preserving identity', () => {
    const w = legacyCycleCountToWorkTask(SAMPLE)
    const back = workTaskToLegacyCycleCount(w)
    expect(back.id).toBe(SAMPLE.id)
    expect(back.count_number).toBe(SAMPLE.count_number)
    expect(back.location).toBe(SAMPLE.location)
    expect(back.system_quantity).toBe(SAMPLE.system_quantity)
    expect(back.priority).toBe(SAMPLE.priority)
    expect(back.status).toBe(SAMPLE.status)
    expect(back.organization_id).toBe(SAMPLE.organization_id)
  })

  it('maps awaiting_supervisor_signoff → paused with legacy_status preserved', () => {
    const w = legacyCycleCountToWorkTask({
      ...SAMPLE,
      status: 'awaiting_supervisor_signoff',
    })
    expect(w.status).toBe('paused')
    expect(w.legacy_status).toBe('awaiting_supervisor_signoff')
    const back = workTaskToLegacyCycleCount(w)
    expect(back.status).toBe('awaiting_supervisor_signoff')
  })

  it('maps variance_review and approved → completed', () => {
    for (const legacy of ['variance_review', 'approved']) {
      const w = legacyCycleCountToWorkTask({ ...SAMPLE, status: legacy })
      expect(w.status).toBe('completed')
      expect(w.legacy_status).toBe(legacy)
    }
  })
})

// Created and developed by Jai Singh
