// Created and developed by Jai Singh
/**
 * OmniBelt Admin Dashboard — service layer (P8).
 *
 * Single entry point for every read/write the dashboard performs.
 *
 * Read/write split (per `Patterns/Supabase-Read-Replica-Routing.md`):
 *   - All SELECTs route through `supabaseRead` (load-balanced replica
 *     when `VITE_SUPABASE_READ_URL` is set, transparent fallback to
 *     primary otherwise). This includes the 24h MV, raw event reads
 *     for the "last 5 min active users" tile, role / role-config /
 *     prefs reads, and settings reads.
 *   - Kill-switch + role-config writes go through the existing
 *     FastAPI admin endpoints (P2 — `/api/admin/omnibelt/kill-switch`,
 *     `/api/admin/omnibelt/role-config`) so the manual `pg_notify`
 *     emit and the org/permission validation stay consistent across
 *     surfaces.
 *   - Allow-list write is a direct Supabase upsert against the
 *     `settings` table — there is no FastAPI endpoint for it today
 *     (and we are constrained from adding one in P8). Mirrors the
 *     toast-settings pattern in `src/lib/services/settings-service.ts`.
 *
 * Nothing in this file opens a Supabase Realtime channel — fresh
 * data arrives via the existing `workServiceWs`
 * `OmnibeltConfigChanged` invalidation pump and the 60s polling
 * fallback baked into the analytics hooks.
 */
import { apiFetch } from '@/lib/api/auth-fetch'
import { supabase, supabaseRead } from '@/lib/supabase/client'
import type {
  OmnibeltRoleConfig,
  OmnibeltToolEvent,
  OmnibeltUserPrefs,
} from '@/lib/supabase/database.types'

/**
 * Shape of the global allow-list settings value. Mirrors
 * `OmnibeltAllowListValue` in `src/lib/services/omnibelt-settings-service.ts`.
 */
export interface AllowListValue {
  tool_ids: string[]
}

export interface KillSwitchRow {
  enabled: boolean
  /**
   * Where the resolved value came from: `org` if the `settings.system.omnibelt.enabled`
   * row was present, otherwise `none` (default-enabled fail-open).
   */
  source: 'env' | 'org' | 'none'
  updated_at: string | null
  updated_by: string | null
}

export interface RoleRow {
  id: string
  name: string
  display_name: string
  is_system: boolean | null
}

export interface RoleConfigRow extends OmnibeltRoleConfig {
  /** Joined role record — convenience for the dashboard table. */
  role?: { name: string; display_name: string } | null
}

export interface EventBucket {
  organization_id: string | null
  tool_id: string | null
  event_type: string | null
  bucket_hour: string | null
  event_count: number | null
  user_count: number | null
}

export interface PrefsAggregate {
  /** Map of tool_id -> count of users with this tool pinned. */
  pinned: Record<string, number>
  /** Map of skin -> count of users who picked it (NULL = inherit). */
  skinDistribution: Record<string, number>
  /** Map of mach3_behavior -> count of users. */
  mach3Distribution: Record<string, number>
}

const KILL_SWITCH_KEY = 'system.omnibelt.enabled'
const ALLOW_LIST_KEY = 'system.omnibelt.allow_list'

export const omnibeltAdminService = {
  /**
   * Read the org-wide kill-switch row. Returns `enabled: true` with
   * `source: 'none'` when no row exists (fail-open default).
   */
  async getKillSwitch(): Promise<KillSwitchRow> {
    const { data, error } = await supabaseRead
      .from('settings')
      .select('value, updated_at, user_id')
      .eq('key', KILL_SWITCH_KEY)
      .is('user_id', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) {
      return {
        enabled: true,
        source: 'none',
        updated_at: null,
        updated_by: null,
      }
    }

    const value = (data.value ?? {}) as Partial<{ enabled: boolean }>
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
      source: 'org',
      updated_at: data.updated_at ?? null,
      // settings table doesn't carry an updated_by column on the public schema
      // we surface — leave null. (The kill-switch FastAPI endpoint doesn't
      // stamp it either; the role-config table does.)
      updated_by: null,
    }
  },

  /**
   * POST to the FastAPI admin endpoint. Authentication flows via
   * `apiFetch`, which attaches the Supabase access token as a Bearer
   * header — the previous `credentials: 'include'` cookie path returned
   * 401 because the FastAPI auth dep reads the JWT from the header.
   */
  async setKillSwitch(enabled: boolean): Promise<{ enabled: boolean }> {
    const resp = await apiFetch('/api/admin/omnibelt/kill-switch', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    })
    if (!resp.ok) {
      const detail = await safeReadText(resp)
      throw new Error(
        `Kill-switch write failed: ${resp.status} ${resp.statusText} ${detail}`
      )
    }
    return (await resp.json()) as { enabled: boolean }
  },

  /** Read the org-wide allow-list. Returns `null` if unset (no restriction). */
  async getAllowList(): Promise<string[] | null> {
    const { data, error } = await supabaseRead
      .from('settings')
      .select('value')
      .eq('key', ALLOW_LIST_KEY)
      .is('user_id', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return null
    const value = (data.value ?? {}) as Partial<AllowListValue>
    if (!Array.isArray(value.tool_ids)) return null
    return value.tool_ids.filter((id): id is string => typeof id === 'string')
  },

  /**
   * Upsert the global allow-list row. Mirrors the toast-settings
   * pattern: select-by-key first, update on hit, insert on miss.
   * RLS gates the write to admin/superadmin (the `settings` table's
   * existing policy + `omnibelt.manage` permission on the route).
   *
   * NOTE: this pre-write SELECT intentionally stays on the primary
   * `supabase` client (not `supabaseRead`). Per
   * `memorybank/OmniFrame/Patterns/Supabase-Read-Replica-Routing.md`,
   * read-your-own-writes / RMW flows must read from primary. Reading
   * from the replica here would risk a stale "no row exists" answer
   * on the heels of a previous insert, which would trigger a duplicate
   * INSERT and trip the (key, user_id IS NULL) unique constraint.
   */
  async setAllowList(toolIds: string[]): Promise<void> {
    const payload = { tool_ids: toolIds }

    const { data: existing, error: selectError } = await supabase
      .from('settings')
      .select('id')
      .eq('key', ALLOW_LIST_KEY)
      .is('user_id', null)
      .limit(1)
      .maybeSingle()

    if (selectError) throw selectError

    if (existing) {
      const { error } = await supabase
        .from('settings')
        .update({
          value: payload,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('settings').insert({
        key: ALLOW_LIST_KEY,
        value: payload,
      })
      if (error) throw error
    }
  },

  /** Read every role visible to this user (system + custom). */
  async getRoles(): Promise<RoleRow[]> {
    const { data, error } = await supabaseRead
      .from('roles')
      .select('id, name, display_name, is_system')
      .eq('is_active', true)
      .order('is_system', { ascending: false })
      .order('name', { ascending: true })

    if (error) throw error
    return (data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      display_name: r.display_name,
      is_system: r.is_system ?? null,
    }))
  },

  /** Read every role-config row for the admin's org (RLS scopes by org). */
  async getRoleConfigs(): Promise<OmnibeltRoleConfig[]> {
    const { data, error } = await supabaseRead
      .from('omnibelt_role_config')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as OmnibeltRoleConfig[]
  },

  /**
   * POST to the existing FastAPI admin role-config endpoint. The
   * server stamps `organization_id` from the JWT and the trigger
   * fires the `omnibelt_config_changed` pg_notify automatically.
   */
  async saveRoleConfig(payload: {
    role_id: string
    default_tool_ids: string[]
    default_pinned_ids: string[]
    default_position: { anchor: string; offset: { x: number; y: number } }
    default_skin: 'pill' | 'orb' | 'skystrip'
  }): Promise<OmnibeltRoleConfig> {
    const resp = await apiFetch('/api/admin/omnibelt/role-config', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    if (!resp.ok) {
      const detail = await safeReadText(resp)
      throw new Error(
        `Role-config write failed: ${resp.status} ${resp.statusText} ${detail}`
      )
    }
    return (await resp.json()) as OmnibeltRoleConfig
  },

  /**
   * Read the 24h aggregation MV. RLS still applies — admins see their
   * own org only. `since` is honored client-side; the MV is hourly so
   * cap reads at 24h naturally.
   */
  async getEventsLast24h(): Promise<EventBucket[]> {
    const { data, error } = await supabaseRead
      .from('omnibelt_tool_events_24h_mv')
      .select('*')
      .order('bucket_hour', { ascending: true })
    if (error) throw error
    return (data ?? []) as EventBucket[]
  },

  /**
   * Live KPI — distinct user_ids with a `belt_visible` event in the
   * last 5 minutes. Runs against the raw event table (the hourly MV
   * is too coarse). Bounded query: `LIMIT 500` so a runaway insert
   * stream can't ruin the dashboard render.
   */
  async getActiveUsersLast5m(): Promise<number> {
    const since = new Date(Date.now() - 5 * 60_000).toISOString()
    const { data, error } = await supabaseRead
      .from('omnibelt_tool_events')
      .select('user_id')
      .gte('occurred_at', since)
      .eq('event_type', 'belt_visible')
      .limit(500)

    if (error) throw error
    const ids = new Set<string>()
    for (const row of data ?? []) {
      if (row.user_id) ids.add(row.user_id)
    }
    return ids.size
  },

  /** Pull the last N events for the analytics recent-activity feed. */
  async getRecentEvents(limit = 50): Promise<OmnibeltToolEvent[]> {
    const { data, error } = await supabaseRead
      .from('omnibelt_tool_events')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data ?? []) as OmnibeltToolEvent[]
  },

  /**
   * Aggregate user-prefs counts. Used for:
   *   - Tools tab "current org-wide pin count" column.
   *   - Analytics tab "skin distribution" pie.
   *   - (future) mach3 behavior distribution.
   *
   * RLS only lets a user read their own row, so we cannot run this
   * aggregate from the frontend in production. The query is gated
   * behind admin perms via RLS on `omnibelt_user_prefs` (which
   * currently restricts to self-rows) — when admin reads are added
   * to that policy in a future migration, this returns real data;
   * until then it returns empty maps and the dashboard tiles show
   * a "—" placeholder. Documented in the implementation log.
   */
  async getPrefsAggregate(): Promise<PrefsAggregate> {
    const result: PrefsAggregate = {
      pinned: {},
      skinDistribution: {},
      mach3Distribution: {},
    }
    try {
      // Best-effort — RLS will return an empty page when the policy
      // is self-only; we don't surface that as an error.
      const { data, error } = await supabaseRead
        .from('omnibelt_user_prefs')
        .select('pinned_tool_ids, skin, mach3_behavior')
      if (error || !data) return result

      for (const row of data as Pick<
        OmnibeltUserPrefs,
        'pinned_tool_ids' | 'skin' | 'mach3_behavior'
      >[]) {
        if (Array.isArray(row.pinned_tool_ids)) {
          for (const id of row.pinned_tool_ids) {
            result.pinned[id] = (result.pinned[id] ?? 0) + 1
          }
        }
        const skinKey = row.skin ?? 'inherit'
        result.skinDistribution[skinKey] =
          (result.skinDistribution[skinKey] ?? 0) + 1
        if (row.mach3_behavior) {
          result.mach3Distribution[row.mach3_behavior] =
            (result.mach3Distribution[row.mach3_behavior] ?? 0) + 1
        }
      }
    } catch {
      /* swallow — return empty result */
    }
    return result
  },
}

async function safeReadText(resp: Response): Promise<string> {
  try {
    return await resp.text()
  } catch {
    return ''
  }
}

// Created and developed by Jai Singh
