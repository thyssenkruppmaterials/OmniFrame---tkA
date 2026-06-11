// Created and developed by Jai Singh
/**
 * Adapters between the legacy flat `CycleCountTask` shape (`./types.ts`) and
 * the discriminated-union `CycleCountWorkTask` (Phase 3.1). Round-trippable.
 *
 * Tested in `src/lib/work-service/__tests__/adapters.test.ts`.
 */
import type { CycleCountTask as LegacyCycleCountTask } from './types'
import type {
  CycleCountWorkTask,
  WorkTask,
  WorkPriority,
  WorkStatus,
} from './work-task-types'

export function legacyCycleCountToWorkTask(
  l: LegacyCycleCountTask
): CycleCountWorkTask {
  return {
    id: l.id,
    task_type: 'cycle_count',
    task_subtype: l.count_type,
    task_number: l.count_number,
    subject_material: l.material_number,
    subject_description: l.material_description ?? null,
    primary_location: l.location,
    secondary_location: l.transfer_destination_location ?? null,
    warehouse: l.warehouse,
    unit_of_measure: l.unit_of_measure,
    priority: l.priority as WorkPriority,
    status: mapLegacyStatusToWorkStatus(l.status),
    legacy_status: l.status,
    assigned_to: l.assigned_to,
    assigned_at: l.assigned_at,
    pushed_by: l.pushed_by,
    pushed_at: l.pushed_at,
    push_mode: l.push_mode,
    push_acknowledged: l.push_acknowledged,
    push_acknowledged_at: null,
    supervisor_assigned_at: null,
    supervisor_assigned_by: null,
    reservation_started_at: null,
    workflow_config_id: l.workflow_config_id,
    workflow_config_version: l.workflow_config_version,
    workflow_snapshot: l.workflow_snapshot ?? {},
    payload_version: 1,
    result_payload: null,
    organization_id: l.organization_id,
    created_at: '',
    updated_at: '',
    payload: {
      system_quantity: l.system_quantity,
      counted_quantity: l.counted_quantity,
      count_type: l.count_type ?? 'cycle_count',
      requires_recount: l.requires_recount,
      recount_completed: l.recount_completed,
      scanned_material_number: l.scanned_material_number,
      scanned_parts: l.scanned_parts as unknown as Array<
        Record<string, unknown>
      >,
      evidence_photo_urls: l.evidence_photo_urls ?? [],
      transfer_destination_location: l.transfer_destination_location,
      transfer_source_quantity: l.transfer_source_quantity,
    },
  }
}

export function workTaskToLegacyCycleCount(
  w: CycleCountWorkTask
): LegacyCycleCountTask {
  const p = w.payload
  return {
    id: w.id,
    count_number: w.task_number ?? '',
    material_number: w.subject_material ?? '',
    material_description: w.subject_description,
    location: w.primary_location,
    warehouse: w.warehouse,
    system_quantity: p.system_quantity ?? 0,
    counted_quantity: p.counted_quantity ?? null,
    unit_of_measure: w.unit_of_measure ?? '',
    priority: w.priority,
    status: w.legacy_status ?? mapWorkStatusToLegacyStatus(w.status),
    count_type: w.task_subtype,
    assigned_to: w.assigned_to,
    assigned_at: w.assigned_at ?? null,
    push_mode: w.push_mode,
    pushed_by: w.pushed_by,
    pushed_at: w.pushed_at,
    push_acknowledged: w.push_acknowledged,
    organization_id: w.organization_id,
    completed_at: null,
    recount_by: null,
    recount_date: null,
    recount_completed: Boolean(p.recount_completed),
    requires_recount: Boolean(p.requires_recount),
    counter_name: null,
    resolved_location_key: null,
    resolved_zone: null,
    resolved_aisle: null,
    resolved_sequence: null,
    resolution_source: null,
    workflow_config_id: w.workflow_config_id ?? null,
    workflow_config_version: w.workflow_config_version ?? null,
    workflow_snapshot: w.workflow_snapshot ?? {},
    workflow_result: {},
    evidence_photo_urls: p.evidence_photo_urls ?? [],
    review_threshold_pct: null,
    review_threshold_abs: null,
    scanned_material_number: p.scanned_material_number ?? null,
    location_reported_empty: null,
    part_variance: null,
    scanned_parts:
      (p.scanned_parts as unknown as LegacyCycleCountTask['scanned_parts']) ??
      [],
    transfer_destination_location: p.transfer_destination_location ?? null,
    transfer_source_quantity: p.transfer_source_quantity ?? null,
  }
}

export function isWorkTask(value: unknown): value is WorkTask {
  if (!value || typeof value !== 'object') return false
  const t = (value as { task_type?: unknown }).task_type
  return (
    typeof t === 'string' &&
    [
      'cycle_count',
      'zone_audit',
      'pick',
      'putaway',
      'replenish',
      'kit_pick',
    ].includes(t)
  )
}

function mapLegacyStatusToWorkStatus(s: string): WorkStatus {
  switch (s) {
    case 'in_progress':
    case 'recount':
      return 'in_progress'
    case 'awaiting_supervisor_signoff':
      return 'paused'
    case 'variance_review':
    case 'approved':
      return 'completed'
    case 'cancelled':
      return 'cancelled'
    case 'pending':
    default:
      return 'pending'
  }
}

function mapWorkStatusToLegacyStatus(s: WorkStatus): string {
  switch (s) {
    case 'pending':
    case 'claimed':
      return 'pending'
    case 'in_progress':
      return 'in_progress'
    case 'paused':
      return 'awaiting_supervisor_signoff'
    case 'completed':
      return 'approved'
    case 'cancelled':
      return 'cancelled'
  }
}

// Created and developed by Jai Singh
