// Created and developed by Jai Singh
/**
 * Zone Rules Service — cycle-count zone mutual exclusion config
 *
 * Backs the "Zone Rules" card in Count Settings. Manages per-organization
 * policy (one_counter_per_zone / off), zone derivation pattern, and the
 * live roll-up of active zones (v_cycle_count_active_zones).
 *
 * Enforcement is in the DB (migration 225) via
 * public.enforce_cycle_count_zone_exclusivity. Supervisors and admins can
 * bypass per-transaction by setting the session GUC
 *     app.cycle_count_zone_lock_bypass = 'on'
 * immediately before an assignment statement.
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ZonePolicy = 'off' | 'one_counter_per_zone'

export interface ZoneExclusionPair {
  zone_a: string
  zone_b: string
}

export interface ZoneRules {
  organization_id: string
  enabled: boolean
  policy: ZonePolicy
  zone_pattern: string | null
  sticky_zone: boolean
  bypass_priorities: string[]
  bypass_count_types: string[]
  exclusion_pairs: ZoneExclusionPair[]
  notes: string | null
  /**
   * Migration 252: when true, rows whose location parses to a NULL zone
   * (empty / `<<empty>>` / no dash) fall back to LOCATION-EXACT-MATCH
   * exclusivity instead of bypassing the trigger. Default false (existing
   * behavior preserved).
   */
  treat_null_zone_as_locked: boolean
  /**
   * Migration 252: how long (in hours) `escalate_stale_zone_reservations`
   * skips a row whose `supervisor_assigned_at` is recent. Default 24.
   */
  supervisor_assignment_protection_hours: number
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export interface ZoneAssignment {
  organization_id: string
  zone: string
  user_id: string
  user_name: string | null
  user_email: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ActiveZone {
  organization_id: string
  zone: string
  locked_by: string
  locked_by_name: string | null
  locked_by_email: string | null
  /** All non-terminal rows: actively counting + reserved. */
  active_count_count: number
  /** In-progress / recount only. */
  actively_counting: number
  /** pending + assigned_to (soft-released reservation). */
  reserved_count: number
  acquired_at: string
  active_count_ids: string[]
  active_ids: string[] | null
  reserved_ids: string[] | null
  owner_last_heartbeat: string | null
  owner_online: boolean
  minutes_since_seen: number | null
  is_stuck: boolean
  has_reservation: boolean
  has_active: boolean
}

export interface ZoneRulesUpdate {
  enabled?: boolean
  policy?: ZonePolicy
  zone_pattern?: string | null
  sticky_zone?: boolean
  bypass_priorities?: string[]
  bypass_count_types?: string[]
  exclusion_pairs?: ZoneExclusionPair[]
  notes?: string | null
  /** Migration 252 — see {@link ZoneRules.treat_null_zone_as_locked}. */
  treat_null_zone_as_locked?: boolean
  /**
   * Migration 252 — see {@link ZoneRules.supervisor_assignment_protection_hours}.
   */
  supervisor_assignment_protection_hours?: number
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

async function currentOrgId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  return profile?.organization_id ?? null
}

export async function getZoneRules(): Promise<ZoneRules | null> {
  try {
    const orgId = await currentOrgId()
    if (!orgId) return null

    const { data, error } = await (supabase as any)
      .from('cycle_count_zone_rules')
      .select('*')
      .eq('organization_id', orgId)
      .maybeSingle()

    if (error) {
      logger.error('getZoneRules error:', error)
      return null
    }
    return (data as ZoneRules) ?? null
  } catch (error) {
    logger.error('getZoneRules exception:', error)
    return null
  }
}

export async function upsertZoneRules(
  updates: ZoneRulesUpdate
): Promise<ZoneRules | null> {
  try {
    const orgId = await currentOrgId()
    if (!orgId) throw new Error('No organization for current user')

    const {
      data: { user },
    } = await supabase.auth.getUser()

    const payload: Record<string, unknown> = {
      organization_id: orgId,
      updated_by: user?.id ?? null,
      ...updates,
    }

    const { data, error } = await (supabase as any)
      .from('cycle_count_zone_rules')
      .upsert(payload, { onConflict: 'organization_id' })
      .select('*')
      .single()

    if (error) {
      logger.error('upsertZoneRules error:', error)
      throw error
    }
    return data as ZoneRules
  } catch (error) {
    logger.error('upsertZoneRules exception:', error)
    throw error
  }
}

export async function listActiveZones(): Promise<ActiveZone[]> {
  // Migration 252 fix: previously this swallowed errors and returned [],
  // which made the Push panel "K1 is reserved for Nikki" preflight
  // silently miss real conflicts whenever the view query failed (RLS,
  // network, etc.). Now we throw so callers (useActiveZones) can decide
  // whether to retry or surface the error.
  const orgId = await currentOrgId()
  if (!orgId) return []

  const { data, error } = await (supabase as any)
    .from('v_cycle_count_active_zones')
    .select('*')
    .eq('organization_id', orgId)
    .order('acquired_at', { ascending: true })

  if (error) {
    logger.error('listActiveZones error:', error)
    throw error instanceof Error
      ? error
      : new Error(
          (error as { message?: string })?.message ?? 'listActiveZones failed'
        )
  }
  return (data ?? []) as ActiveZone[]
}

/**
 * Extract a zone string from a raw location, mirroring the SQL helper
 * public.cycle_count_zone_of. Used for client-side preview in the settings UI
 * so admins can see how locations map to zones before enabling the policy.
 */
export function deriveZone(
  location: string | null | undefined,
  pattern: string | null | undefined = null
): string | null {
  if (!location) return null
  if (location === '<<empty>>') return null
  if (pattern && pattern.length > 0) {
    try {
      const re = new RegExp(pattern)
      const match = location.match(re)
      return match && match[0] ? match[0] : null
    } catch {
      // Invalid regex — fall through to default.
    }
  }
  const idx = location.indexOf('-')
  return idx > 0 ? location.slice(0, idx) : location || null
}

/**
 * Friendly parser for zone enforcement errors. The trigger raises two
 * variants (migrations 225/227):
 *   ZONE_LOCKED:   zone is currently busy (another active counter).
 *   ZONE_ASSIGNED: zone has an admin-configured owner.
 * Both include DETAIL `zone=<X>;{owner|assigned_to}=<uuid>`.
 */
export type ZoneBlockKind = 'locked' | 'assigned'

export interface ParsedZoneBlockError {
  isZoneBlocked: true
  kind: ZoneBlockKind
  zone: string | null
  ownerName: string | null
  ownerId: string | null
  rawMessage: string
}

export type ZoneLockParseResult =
  | ParsedZoneBlockError
  | { isZoneBlocked: false; rawMessage: string }

export function parseZoneLockError(err: unknown): ZoneLockParseResult {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : ((err as { message?: string })?.message ?? String(err))

  if (!message) {
    return { isZoneBlocked: false, rawMessage: message ?? '' }
  }

  const isAssigned = message.includes('ZONE_ASSIGNED')
  const isLocked = message.includes('ZONE_LOCKED')
  if (!isAssigned && !isLocked) {
    return { isZoneBlocked: false, rawMessage: message }
  }

  const zoneMatch = /Zone\s+"([^"]+)"/i.exec(message)
  const ownerMatch = isAssigned
    ? /assigned to\s+([^.]+?)\./i.exec(message)
    : /counted by\s+([^.]+?)\./i.exec(message)

  const combined = `${message} ${(err as { details?: string })?.details ?? ''}`
  const detailMatch = isAssigned
    ? /zone=([^;]+);assigned_to=([0-9a-f-]+)/i.exec(combined)
    : /zone=([^;]+);owner=([0-9a-f-]+)/i.exec(combined)

  return {
    isZoneBlocked: true,
    kind: isAssigned ? 'assigned' : 'locked',
    zone: zoneMatch?.[1] ?? detailMatch?.[1] ?? null,
    ownerName: ownerMatch?.[1]?.trim() ?? null,
    ownerId: detailMatch?.[2] ?? null,
    rawMessage: message,
  }
}

// ---------------------------------------------------------------------------
// Realtime subscription for active zones
// ---------------------------------------------------------------------------

type ActiveZonesListener = (zones: ActiveZone[]) => void

// ---------------------------------------------------------------------------
// Zone Assignments CRUD
// ---------------------------------------------------------------------------

export async function listZoneAssignments(): Promise<ZoneAssignment[]> {
  try {
    const orgId = await currentOrgId()
    if (!orgId) return []

    const { data, error } = await (supabase as any)
      .from('v_cycle_count_zone_assignments')
      .select('*')
      .eq('organization_id', orgId)
      .order('zone', { ascending: true })

    if (error) {
      logger.error('listZoneAssignments error:', error)
      return []
    }
    return (data ?? []) as ZoneAssignment[]
  } catch (error) {
    logger.error('listZoneAssignments exception:', error)
    return []
  }
}

/**
 * Upsert a zone → user assignment. Zone is normalized to uppercase to match
 * the DB check constraint (`zone = upper(zone)`). Returns the saved row.
 */
export async function upsertZoneAssignment(params: {
  zone: string
  user_id: string
  notes?: string | null
}): Promise<ZoneAssignment | null> {
  try {
    const orgId = await currentOrgId()
    if (!orgId) throw new Error('No organization for current user')

    const {
      data: { user },
    } = await supabase.auth.getUser()

    const zone = params.zone.trim().toUpperCase()
    if (!zone) throw new Error('Zone cannot be empty')

    const payload: Record<string, unknown> = {
      organization_id: orgId,
      zone,
      user_id: params.user_id,
      notes: params.notes ?? null,
      updated_by: user?.id ?? null,
      created_by: user?.id ?? null,
    }

    const { data, error } = await (supabase as any)
      .from('cycle_count_zone_assignments')
      .upsert(payload, { onConflict: 'organization_id,zone' })
      .select(
        `
        organization_id, zone, user_id, notes, created_at, updated_at,
        assignee:user_profiles!user_id(full_name, email)
      `
      )
      .single()

    if (error) {
      logger.error('upsertZoneAssignment error:', error)
      throw error
    }

    // Shape the result to match ZoneAssignment (view schema).
    const row = data as {
      organization_id: string
      zone: string
      user_id: string
      notes: string | null
      created_at: string
      updated_at: string
      assignee?: { full_name: string | null; email: string | null } | null
    }
    return {
      organization_id: row.organization_id,
      zone: row.zone,
      user_id: row.user_id,
      user_name: row.assignee?.full_name ?? null,
      user_email: row.assignee?.email ?? null,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  } catch (error) {
    logger.error('upsertZoneAssignment exception:', error)
    throw error
  }
}

export async function deleteZoneAssignment(zone: string): Promise<void> {
  try {
    const orgId = await currentOrgId()
    if (!orgId) throw new Error('No organization for current user')

    const { error } = await (supabase as any)
      .from('cycle_count_zone_assignments')
      .delete()
      .eq('organization_id', orgId)
      .eq('zone', zone.trim().toUpperCase())

    if (error) {
      logger.error('deleteZoneAssignment error:', error)
      throw error
    }
  } catch (error) {
    logger.error('deleteZoneAssignment exception:', error)
    throw error
  }
}

/**
 * Fetches the list of users in the current org that can be zone owners
 * (any user in the org — the UI can filter further by role if desired).
 */
export interface OrgUserOption {
  id: string
  full_name: string | null
  email: string | null
  role: string | null
}

export async function listOrgUsersForZoneAssignment(): Promise<
  OrgUserOption[]
> {
  try {
    const orgId = await currentOrgId()
    if (!orgId) return []

    const { data, error } = await (supabase as any)
      .from('user_profiles')
      .select('id, full_name, email, role')
      .eq('organization_id', orgId)
      .order('full_name', { ascending: true })

    if (error) {
      logger.error('listOrgUsersForZoneAssignment error:', error)
      return []
    }
    return (data ?? []) as OrgUserOption[]
  } catch (error) {
    logger.error('listOrgUsersForZoneAssignment exception:', error)
    return []
  }
}

// ---------------------------------------------------------------------------
// Stuck-assignment release RPCs
// ---------------------------------------------------------------------------

/**
 * Admin release of a single stuck cycle-count assignment.
 *
 * Default (soft): flips status to `pending` but KEEPS `assigned_to` so the
 * original assignee retains priority on their next Pull Next. Phase 2 of
 * the Rust claim query filters `assigned_to IS NULL`, so no one else sees
 * the row — only the original assignee gets it back.
 *
 * Hard (`alsoUnassign = true`): clears `assigned_to` so the row returns
 * to the general pool. Use when the assignee is definitively not coming
 * back.
 */
export async function releaseStuckAssignment(
  countId: string,
  alsoUnassign = false
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await (supabase.rpc as any)(
      'release_stuck_cycle_count_assignment',
      { p_count_id: countId, p_also_unassign: alsoUnassign }
    )
    if (error) return { success: false, error: error.message }
    if (data && typeof data === 'object' && 'success' in data) {
      const asObj = data as { success: boolean; error?: string }
      return asObj.success
        ? { success: true }
        : { success: false, error: asObj.error ?? 'Release failed' }
    }
    return { success: false, error: 'Release RPC returned no result' }
  } catch (err) {
    logger.error('releaseStuckAssignment exception:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/**
 * Bulk release every cycle-count assignment in the caller's org held by an
 * operator whose heartbeat is older than `thresholdMinutes` (default 10).
 * Defaults to SOFT (keeps assignment). Pass `alsoUnassign=true` to return
 * rows to the general pool.
 */
export async function releaseAllStuckAssignments(
  thresholdMinutes = 10,
  alsoUnassign = false
): Promise<{ success: boolean; released?: number; error?: string }> {
  try {
    const { data, error } = await (supabase.rpc as any)(
      'release_all_stuck_cycle_count_assignments',
      {
        p_threshold_minutes: thresholdMinutes,
        p_also_unassign: alsoUnassign,
      }
    )
    if (error) return { success: false, error: error.message }
    if (data && typeof data === 'object' && 'success' in data) {
      const asObj = data as {
        success: boolean
        error?: string
        released?: number
      }
      return asObj.success
        ? { success: true, released: asObj.released ?? 0 }
        : { success: false, error: asObj.error ?? 'Bulk release failed' }
    }
    return { success: false, error: 'Bulk release RPC returned no result' }
  } catch (err) {
    logger.error('releaseAllStuckAssignments exception:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ---------------------------------------------------------------------------
// Supervisor override RPC
// ---------------------------------------------------------------------------

/**
 * Force-assigns a count to a user even if the target zone is currently locked
 * by another active counter. Server-side role check enforces
 * superadmin/admin/manager/logistics_coordinator. Returns `{ success, error? }`
 * from the underlying RPC.
 */
export async function forceAssignCountToUser(
  countId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await (supabase.rpc as any)(
      'assign_cycle_count_to_user_force',
      { p_count_id: countId, p_user_id: userId }
    )

    if (error) {
      return { success: false, error: error.message }
    }

    if (data && typeof data === 'object' && 'success' in data) {
      const asObj = data as { success: boolean; error?: string }
      if (!asObj.success) {
        return { success: false, error: asObj.error ?? 'Force-assign failed' }
      }
      return { success: true }
    }

    return { success: false, error: 'Force-assign RPC returned no result' }
  } catch (err) {
    logger.error('forceAssignCountToUser exception:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/**
 * Subscribes to rr_cyclecount_data changes and re-queries the active zones
 * view. Returns an unsubscribe function. Throttled to max 1 call / 500 ms
 * to avoid storms during bulk imports.
 */
export function subscribeToActiveZones(
  listener: ActiveZonesListener
): () => void {
  let throttleTimer: ReturnType<typeof setTimeout> | null = null
  let cancelled = false

  const refresh = () => {
    if (throttleTimer) return
    throttleTimer = setTimeout(async () => {
      throttleTimer = null
      if (cancelled) return
      try {
        const zones = await listActiveZones()
        if (!cancelled) listener(zones)
      } catch (err) {
        // listActiveZones now throws on error (migration 252 review).
        // The realtime subscriber retries on the next tick, so we just
        // log and swallow here — no toast spam from silent reconnects.
        logger.error('subscribeToActiveZones refresh failed:', err)
      }
    }, 500)
  }

  // Initial emit.
  refresh()

  const channel = supabase
    .channel('cycle-count-zone-activity')
    .on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'rr_cyclecount_data' },
      () => refresh()
    )
    .subscribe()

  return () => {
    cancelled = true
    if (throttleTimer) {
      clearTimeout(throttleTimer)
      throttleTimer = null
    }
    supabase.removeChannel(channel)
  }
}

// Created and developed by Jai Singh
