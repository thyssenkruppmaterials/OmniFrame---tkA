// Created and developed by Jai Singh
/**
 * Defer History Service
 *
 * Reads the `v_cycle_count_defer_history` view (migration 269) to surface
 * "who deferred / skipped a cycle count, when, and why" on the Inventory
 * Counts dashboard. The view joins `cycle_count_operator_deferred_counts`
 * with `user_profiles` + `rr_cyclecount_data` and inherits RLS from the
 * underlying defer table via `security_invoker = true`.
 *
 * Design contract:
 *   - History is fetched LAZILY (popover hover, modal open, filter opt-in).
 *     The bulk dashboard query in `cycle-count.service.ts::fetchCycleCountData`
 *     is NOT changed.
 *   - "Active + cleared" is the default — supervisors auditing skip activity
 *     usually want the full timeline.
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

export interface DeferHistoryEntry {
  id: string
  organization_id: string
  count_id: string
  count_number: string | null
  user_id: string
  user_full_name: string | null
  user_email: string | null
  user_username: string | null
  defer_reason: string | null
  deferred_at: string
  cleared_at: string | null
  reactivated_at: string | null
  is_active: boolean
  resume_priority: number
  times_deferred: number
}

export interface DeferHistoryFilter {
  /** Filter to a specific count's history. */
  countId?: string
  /** Limit to defers performed by these users. */
  userIds?: string[]
  /** When false, only currently-active defers are returned. Default: true. */
  includeCleared?: boolean
  /** Earliest `deferred_at` (inclusive). ISO timestamp. */
  since?: string
  /** Latest `deferred_at` (exclusive). ISO timestamp. */
  until?: string
  /** Limit row count. */
  limit?: number
}

const VIEW = 'v_cycle_count_defer_history'

export class DeferHistoryService {
  private static instance: DeferHistoryService

  private constructor() {}

  static getInstance(): DeferHistoryService {
    if (!DeferHistoryService.instance) {
      DeferHistoryService.instance = new DeferHistoryService()
    }
    return DeferHistoryService.instance
  }

  /**
   * Full defer history for a single count (active + cleared), newest first.
   * Used by the popover on the Skipped badge and the Skip/Defer History
   * section in `EditCountModal`.
   */
  async fetchForCount(countId: string): Promise<{
    data: DeferHistoryEntry[]
    error: Error | null
  }> {
    if (!countId) return { data: [], error: null }
    try {
      const { data, error } = await (supabase as any)
        .from(VIEW)
        .select('*')
        .eq('count_id', countId)
        .order('deferred_at', { ascending: false })

      if (error) {
        logger.error('DeferHistoryService.fetchForCount error:', error)
        return { data: [], error: new Error(error.message) }
      }
      return { data: (data ?? []) as DeferHistoryEntry[], error: null }
    } catch (err) {
      logger.error('DeferHistoryService.fetchForCount unexpected error:', err)
      return {
        data: [],
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }

  /**
   * Org-wide defer history, optionally filtered.
   * Used by the "Deferred by [user]" multi-select in the dashboard header
   * and by the search predicate to map operator names to count_ids.
   */
  async fetchForOrg(opts: DeferHistoryFilter = {}): Promise<{
    data: DeferHistoryEntry[]
    error: Error | null
  }> {
    try {
      let q = (supabase as any)
        .from(VIEW)
        .select('*')
        .order('deferred_at', { ascending: false })

      if (opts.countId) q = q.eq('count_id', opts.countId)
      if (opts.userIds && opts.userIds.length > 0) {
        q = q.in('user_id', opts.userIds)
      }
      if (opts.includeCleared === false) q = q.eq('is_active', true)
      if (opts.since) q = q.gte('deferred_at', opts.since)
      if (opts.until) q = q.lt('deferred_at', opts.until)
      if (opts.limit && opts.limit > 0) q = q.limit(opts.limit)

      const { data, error } = await q
      if (error) {
        logger.error('DeferHistoryService.fetchForOrg error:', error)
        return { data: [], error: new Error(error.message) }
      }
      return { data: (data ?? []) as DeferHistoryEntry[], error: null }
    } catch (err) {
      logger.error('DeferHistoryService.fetchForOrg unexpected error:', err)
      return {
        data: [],
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }

  /**
   * Distinct deferring-users in the org, suitable for populating the
   * "Deferred by" multi-select filter. Ordered by most-recent activity.
   */
  async fetchDistinctUsers(opts: { includeCleared?: boolean } = {}): Promise<{
    data: Array<{
      user_id: string
      user_full_name: string | null
      user_email: string | null
      latest_deferred_at: string
    }>
    error: Error | null
  }> {
    try {
      let q = (supabase as any)
        .from(VIEW)
        .select('user_id, user_full_name, user_email, deferred_at')
        .order('deferred_at', { ascending: false })

      if (opts.includeCleared === false) q = q.eq('is_active', true)

      const { data, error } = await q
      if (error) {
        logger.error('DeferHistoryService.fetchDistinctUsers error:', error)
        return { data: [], error: new Error(error.message) }
      }

      const seen = new Map<
        string,
        {
          user_id: string
          user_full_name: string | null
          user_email: string | null
          latest_deferred_at: string
        }
      >()
      for (const row of (data ?? []) as Array<{
        user_id: string
        user_full_name: string | null
        user_email: string | null
        deferred_at: string
      }>) {
        if (!row.user_id || seen.has(row.user_id)) continue
        seen.set(row.user_id, {
          user_id: row.user_id,
          user_full_name: row.user_full_name,
          user_email: row.user_email,
          latest_deferred_at: row.deferred_at,
        })
      }
      return { data: Array.from(seen.values()), error: null }
    } catch (err) {
      logger.error(
        'DeferHistoryService.fetchDistinctUsers unexpected error:',
        err
      )
      return {
        data: [],
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }
}

export const deferHistoryService = DeferHistoryService.getInstance()

// Created and developed by Jai Singh
