// Created and developed by Jai Singh
/**
 * work.service.ts — generic CRUD over `work_tasks` (Phase 3.4).
 *
 * The plan calls for cycle-count-specific operations (variance recalc,
 * recount lifecycle, CSV import) to remain in `cycle-count.service.ts`,
 * which internally delegates list/get/reassign here.
 *
 * Mass delete + mass approve from `manual-counts-search.tsx` (Phase 7.5) go
 * through this service so a single `work_events('settings_changed')` row
 * accompanies every supervisor-initiated batch action.
 */
import type {
  WorkTask,
  WorkTypeId,
  WorkPriority,
  WorkStatus,
} from '@/lib/work-service/work-task-types'
import { supabase } from './client'

export interface ListWorkTasksFilter {
  organization_id: string
  task_type?: WorkTypeId
  status?: WorkStatus | WorkStatus[]
  priority?: WorkPriority
  assigned_to?: string | null // explicit null filters for unassigned
  warehouse?: string
  limit?: number
  offset?: number
}

export const workService = {
  async list(filter: ListWorkTasksFilter): Promise<WorkTask[]> {
    let q = supabase
      .from('work_tasks')
      .select('*')
      .eq('organization_id', filter.organization_id)
      .is('deleted_at', null)

    if (filter.task_type) q = q.eq('task_type', filter.task_type)
    if (filter.priority) q = q.eq('priority', filter.priority)
    if (filter.warehouse) q = q.eq('warehouse', filter.warehouse)
    if (Array.isArray(filter.status)) q = q.in('status', filter.status)
    else if (filter.status) q = q.eq('status', filter.status)
    if (filter.assigned_to === null) q = q.is('assigned_to', null)
    else if (filter.assigned_to) q = q.eq('assigned_to', filter.assigned_to)

    q = q
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })

    if (filter.limit) q = q.limit(filter.limit)
    if (filter.offset)
      q = q.range(
        filter.offset,
        (filter.offset ?? 0) + (filter.limit ?? 100) - 1
      )

    const { data, error } = await q
    if (error) throw error
    return (data ?? []) as WorkTask[]
  },

  async get(id: string): Promise<WorkTask | null> {
    const { data, error } = await supabase
      .from('work_tasks')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return (data as WorkTask | null) ?? null
  },

  /**
   * Optimistic-concurrency update (Phase 7.4). Caller passes the
   * `expected_updated_at` they fetched earlier; mismatch throws
   * `ConcurrencyError`.
   */
  async updatePriority(args: {
    id: string
    organization_id: string
    expected_updated_at: string
    new_priority: WorkPriority
  }): Promise<WorkTask> {
    const { data, error, count } = await supabase
      .from('work_tasks')
      .update(
        { priority: args.new_priority, updated_at: new Date().toISOString() },
        { count: 'exact' }
      )
      .eq('id', args.id)
      .eq('organization_id', args.organization_id)
      .eq('updated_at', args.expected_updated_at)
      .select('*')
      .single()
    if (error || count === 0) {
      throw new ConcurrencyError(`work_tasks.${args.id} changed under us`)
    }
    return data as WorkTask
  },

  /**
   * Best-effort single-row assignment sync on `work_tasks`. Matches by
   * `source_id` (the legacy `rr_cyclecount_data.id`) like `massApproveVariance`
   * / `massDelete`, with NO `updated_at` CAS, and returns the number of rows
   * updated instead of throwing. Pass `new_assignee = null` to unassign.
   *
   * Why no CAS here: the supervisor UI reads `rr_cyclecount_data`, so the only
   * `updated_at` it can compare against is the legacy row's. `work_tasks` gets
   * a separate `updated_at` (the projection trigger stamps its own `now()`)
   * and may not exist at all for un-projected rows — so a CAS on
   * `work_tasks.updated_at` raised a spurious `ConcurrencyError` for the vast
   * majority of rows and silently aborted the legacy write. Optimistic
   * concurrency for single-row supervisor actions now lives on the
   * authoritative legacy write in the caller.
   */
  async updateAssignment(args: {
    source_id: string
    organization_id: string
    new_assignee: string | null
  }): Promise<number> {
    const patch: Record<string, unknown> = {
      assigned_to: args.new_assignee,
      assigned_at: args.new_assignee ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }
    const { error, count } = await supabase
      .from('work_tasks')
      .update(patch, { count: 'exact' })
      .eq('organization_id', args.organization_id)
      .eq('source_id', args.source_id)
    if (error) throw error
    return count ?? 0
  },

  /**
   * Best-effort single-row approve sync on `work_tasks`. Mirrors
   * `massApproveVariance` for one id: matches by `source_id`, no `updated_at`
   * CAS, returns the number of rows updated. See `updateAssignment` for why
   * the CAS does not belong on `work_tasks`. When the org has
   * `work_tasks_shadow_write` ON the legacy approve write already cascades via
   * the projection trigger, so this call is idempotent; when it is OFF this is
   * what keeps `work_tasks` consistent.
   */
  async approveVariance(args: {
    source_id: string
    organization_id: string
  }): Promise<number> {
    const { error, count } = await supabase
      .from('work_tasks')
      .update(
        {
          status: 'completed',
          legacy_status: 'approved',
          updated_at: new Date().toISOString(),
        },
        { count: 'exact' }
      )
      .eq('organization_id', args.organization_id)
      .eq('source_id', args.source_id)
    if (error) throw error
    return count ?? 0
  },

  /**
   * Soft-delete on `work_tasks` (sets `deleted_at`) AND a hard-delete cascade
   * on the legacy `rr_cyclecount_data` source table. Dual-write keeps the UI
   * delete behaviour unchanged regardless of the per-org
   * `work_tasks_shadow_write` flag state — when shadow is on the projection
   * trigger handles cross-table state, and when shadow is off the legacy row
   * still goes away as the supervisor expects.
   *
   * Returns the number of legacy rows actually removed (the user-visible
   * count). Errors on the work_tasks side are best-effort and logged
   * upstream — the legacy delete is the source of truth for now.
   */
  async massDelete(ids: string[], orgId: string): Promise<number> {
    if (ids.length === 0) return 0

    await supabase
      .from('work_tasks')
      .update(
        {
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { count: 'exact' }
      )
      .eq('organization_id', orgId)
      .in('source_id', ids)

    const { error, count } = await supabase
      .from('rr_cyclecount_data')
      .delete({ count: 'exact' })
      .eq('organization_id', orgId)
      .in('id', ids)
    if (error) throw error
    return count ?? 0
  },

  /**
   * Mass approve — dual-write so it functions identically regardless of the
   * `work_tasks_shadow_write` flag state. work_tasks gets the new status
   * (`completed` + legacy_status `approved`); the legacy table receives the
   * `approved` status + approval audit columns the supervisor UI expects.
   */
  async massApproveVariance(
    ids: string[],
    orgId: string,
    approverUserId?: string
  ): Promise<number> {
    if (ids.length === 0) return 0

    const nowIso = new Date().toISOString()

    await supabase
      .from('work_tasks')
      .update(
        { status: 'completed', legacy_status: 'approved', updated_at: nowIso },
        { count: 'exact' }
      )
      .eq('organization_id', orgId)
      .in('source_id', ids)

    const legacyPatch: Record<string, unknown> = {
      status: 'approved',
      approved_at: nowIso,
      updated_at: nowIso,
    }
    if (approverUserId) legacyPatch.approved_by = approverUserId

    const { error, count } = await supabase
      .from('rr_cyclecount_data')
      .update(legacyPatch, { count: 'exact' })
      .eq('organization_id', orgId)
      .in('id', ids)
    if (error) throw error
    return count ?? 0
  },
}

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConcurrencyError'
  }
}

// Created and developed by Jai Singh
