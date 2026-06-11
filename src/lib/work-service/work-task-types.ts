// Created and developed by Jai Singh
/**
 * BaseTask + discriminated WorkTask union (Phase 3.1).
 *
 * IMPORTANT: this file is ADDITIVE. The existing flat `CycleCountTask` export
 * in `./types.ts` stays as-is until Phase 6 runtime migration completes.
 * During Phase 3 we expose:
 *
 *   - `LegacyCycleCountTask` — alias for the existing flat shape.
 *   - `CycleCountWorkTask`    — discriminated-union member.
 *   - `WorkTask`              — full union (cycle_count | zone_audit | pick |
 *                                putaway | replenish | kit_pick).
 *   - Adapters in `./adapters.ts` to round-trip between the two.
 *
 * All six WorkTypeIds have a member, even disabled stubs, so registry
 * exhaustiveness tests are meaningful.
 */

export type WorkTypeId =
  | 'cycle_count'
  | 'zone_audit'
  | 'pick'
  | 'putaway'
  | 'replenish'
  | 'kit_pick'

export type WorkPriority = 'critical' | 'hot' | 'normal' | 'low'
export type WorkStatus =
  | 'pending'
  | 'claimed'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'cancelled'

export interface WorkflowSnapshot {
  config_id?: string | null
  config_version?: number | null
  count_type?: string | null
  steps?: Array<{
    id: string
    type: string
    label: string
    required: boolean
    order: number
    config: Record<string, unknown>
  }>
}

export interface BaseTask {
  id: string
  task_type: WorkTypeId
  task_subtype: string | null
  task_number: string | null
  subject_material: string | null
  subject_description: string | null
  primary_location: string
  secondary_location: string | null
  warehouse: string | null
  unit_of_measure: string | null
  priority: WorkPriority
  status: WorkStatus
  legacy_status?: string | null
  assigned_to: string | null
  assigned_at?: string | null
  pushed_by: string | null
  pushed_at: string | null
  push_mode: 'pull' | 'push'
  push_acknowledged: boolean
  push_acknowledged_at?: string | null
  supervisor_assigned_at?: string | null
  supervisor_assigned_by?: string | null
  reservation_started_at?: string | null
  workflow_config_id?: string | null
  workflow_config_version?: number | null
  workflow_snapshot?: WorkflowSnapshot | Record<string, never>
  payload_version: number
  result_payload: Record<string, unknown> | null
  organization_id: string
  created_at: string
  updated_at: string
}

export interface CycleCountWorkTask extends BaseTask {
  task_type: 'cycle_count'
  payload: {
    system_quantity: number
    counted_quantity: number | null
    count_type: string
    requires_recount?: boolean
    recount_completed?: boolean
    scanned_material_number?: string | null
    scanned_parts?: Array<Record<string, unknown>>
    evidence_photo_urls?: string[]
    transfer_destination_location?: string | null
    transfer_source_quantity?: number | null
    reassignment_count?: number
  }
}

export interface ZoneAuditTask extends BaseTask {
  task_type: 'zone_audit'
  payload: {
    zone_id: string
    expected_count: number
    counted_quantity?: number | null
    /** Originating SAP transfer-order number when seeded from LT22. */
    lt22_to_number?: string | null
  }
}

export interface PickTask extends BaseTask {
  task_type: 'pick'
  payload: {
    pick_qty: number
    destination_location: string
    transfer_order: string
    movement_type: string
  }
}

export interface PutawayTask extends BaseTask {
  task_type: 'putaway'
  payload: {
    inbound_delivery?: string
    destination_location?: string
    quantity?: number
  }
}

export interface ReplenishTask extends BaseTask {
  task_type: 'replenish'
  payload: {
    source_location?: string
    destination_location?: string
    quantity?: number
  }
}

export interface KitPickTask extends BaseTask {
  task_type: 'kit_pick'
  payload: {
    kit_id?: string
    component_material?: string
    quantity?: number
  }
}

export type WorkTask =
  | CycleCountWorkTask
  | ZoneAuditTask
  | PickTask
  | PutawayTask
  | ReplenishTask
  | KitPickTask

/**
 * Type guard: discriminate on `task_type`. Use sparingly — most code paths
 * should pass the union through to a registry-resolved handler.
 */
export function isCycleCountWorkTask(t: WorkTask): t is CycleCountWorkTask {
  return t.task_type === 'cycle_count'
}
export function isPickWorkTask(t: WorkTask): t is PickTask {
  return t.task_type === 'pick'
}
export function isZoneAuditWorkTask(t: WorkTask): t is ZoneAuditTask {
  return t.task_type === 'zone_audit'
}

// Created and developed by Jai Singh
