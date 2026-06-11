// Created and developed by Jai Singh
/**
 * useAuditLog — derived admin change log for the Audit tab.
 *
 * There is no standalone audit_log table for OmniBelt yet (deferred
 * to a v1.5 follow-up). For P8 we synthesize the audit trail from
 * the `omnibelt_role_config.updated_at` / `updated_by` columns and
 * (optionally) the kill-switch settings row's `updated_at` so the
 * admin can see *who touched what when*.
 *
 * Returns rows shaped for direct rendering by `AuditLogTable`:
 *   { id, timestamp, actor_id, actor_label, target, kind, diff_after }
 *
 * Refetch on 60s interval when visible; reset on bootstrap
 * invalidation via the WS pump.
 */
import { useMemo } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type { OmnibeltRoleConfig } from '@/lib/supabase/database.types'
import { omnibeltAdminService } from '../services/omnibelt-admin.service'
import type { RoleRow } from '../services/omnibelt-admin.service'

export const OMNIBELT_AUDIT_LOG_KEY = ['omnibelt', 'admin', 'audit'] as const

export interface AuditEntry {
  id: string
  timestamp: string
  actor_id: string | null
  actor_label: string
  target: string
  kind: 'role_config' | 'kill_switch'
  diff_after: Record<string, unknown>
}

export function useAuditLog(
  roles: RoleRow[] | undefined
): UseQueryResult<OmnibeltRoleConfig[]> & { entries: AuditEntry[] } {
  const { authState } = useUnifiedAuth()
  const orgId = authState.profile?.organization_id ?? null

  const query = useQuery<OmnibeltRoleConfig[]>({
    queryKey: [...OMNIBELT_AUDIT_LOG_KEY, orgId],
    enabled: Boolean(orgId),
    queryFn: () => omnibeltAdminService.getRoleConfigs(),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  const entries = useMemo<AuditEntry[]>(() => {
    const rolesMap = new Map<string, RoleRow>()
    for (const r of roles ?? []) rolesMap.set(r.id, r)
    return (query.data ?? []).map<AuditEntry>((row) => ({
      id: row.id,
      timestamp: row.updated_at ?? row.created_at,
      actor_id: row.updated_by,
      actor_label: row.updated_by ? shortenId(row.updated_by) : 'system',
      target: rolesMap.get(row.role_id)?.display_name ?? `role:${row.role_id}`,
      kind: 'role_config',
      diff_after: {
        default_tool_ids: row.default_tool_ids,
        default_pinned_ids: row.default_pinned_ids,
        default_position: row.default_position,
        default_skin: row.default_skin,
      },
    }))
  }, [query.data, roles])

  return Object.assign(query, { entries })
}

function shortenId(uuid: string): string {
  if (uuid.length <= 8) return uuid
  return `${uuid.slice(0, 8)}…`
}

// Created and developed by Jai Singh
