// Created and developed by Jai Singh
/**
 * OmniBelt — Resolved-tools hook
 *
 * Filters the bundle-time `TOOL_REGISTRY` through every gate the
 * launcher knows about and returns the surviving tools plus a
 * pre-computed pinned slice for the Pill row.
 *
 * Filter pipeline (spec §11, §15.6):
 *   1. Org allow-list — `bootstrap.allow_list`, when present;
 *      otherwise no restriction.
 *   2. Role default — `bootstrap.role_config?.default_tool_ids`,
 *      when admin-curated; otherwise no restriction.
 *   3. Per-user hidden — `useOmnibeltStore(s => s.hiddenToolIds)`.
 *   4. RBAC permission — `usePermissionStore.hasPermission(action,
 *      resource)` for tools that declare one (same pattern as
 *      `src/components/layout/command-palette.tsx`).
 *
 * Pin resolution:
 *   - User pin set (`useOmnibeltStore.pinnedToolIds`) wins.
 *   - Falls back to `role_config.default_pinned_ids`.
 *   - Tool order is honored when present; otherwise registry order.
 *
 * Renders cheaply via `useMemo` keyed off the stable inputs — the
 * Pill re-renders only when the surviving tool list actually
 * changes shape.
 */
import { useMemo } from 'react'
import { usePermissionStore } from '@/stores/permissionStore'
import { useOmnibeltBootstrap } from '../hooks/useOmnibeltBootstrap'
import { useOmnibeltStore } from '../store/omnibeltStore'
import { TOOL_REGISTRY, type ToolDef } from './registry'

export type ResolvedTools = {
  /** Tools the user has pinned to the Pill (or role-default pins). */
  pinned: ToolDef[]
  /** Every tool that survived the filter pipeline. */
  all: ToolDef[]
  /** Count of tools that were excluded for ANY reason. Useful for
   *  admin previews showing "12 of 18 visible to this role". */
  filtered_count: number
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of list) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function reorder<T extends { id: string }>(
  items: T[],
  order: readonly string[]
): T[] {
  if (order.length === 0) return items
  const indexOf = new Map(order.map((id, i) => [id, i] as const))
  // Stable sort — items not in `order` retain their relative position
  // at the tail (after the ordered set).
  const indexed = items.map((it, i) => ({ it, i }))
  indexed.sort((a, b) => {
    const ai = indexOf.has(a.it.id) ? indexOf.get(a.it.id)! : Infinity
    const bi = indexOf.has(b.it.id) ? indexOf.get(b.it.id)! : Infinity
    if (ai !== bi) return ai - bi
    return a.i - b.i
  })
  return indexed.map((x) => x.it)
}

export function useResolvedTools(): ResolvedTools {
  const bootstrap = useOmnibeltBootstrap()
  const allowList = bootstrap.data?.allow_list ?? null
  const defaultToolIds = bootstrap.data?.role_config?.default_tool_ids ?? null
  const defaultPinnedIds = bootstrap.data?.role_config?.default_pinned_ids ?? []

  const pinnedToolIds = useOmnibeltStore((s) => s.pinnedToolIds)
  const hiddenToolIds = useOmnibeltStore((s) => s.hiddenToolIds)
  const toolOrder = useOmnibeltStore((s) => s.toolOrder)

  // Subscribe to a permission-store version-ish value so the memo
  // recomputes when permissions change. `lastLoadTime` is updated
  // on every successful (re)load.
  const lastLoadTime = usePermissionStore((s) => s.lastLoadTime)
  const hasPermission = usePermissionStore((s) => s.hasPermission)

  return useMemo<ResolvedTools>(() => {
    // Empty `allow_list` is "no restriction" per the Rust bootstrap
    // contract (`rust-dashboard-service/src/omnibelt.rs` →
    // `read_allow_list` returns `Vec::new()` when no setting row
    // exists). Treating `[]` as a literal set would filter every
    // tool — that's also what the bootstrap placeholder relies on
    // so the launcher stays usable while the FastAPI backend is
    // unreachable (see `useOmnibeltBootstrap` resilience block).
    const allowSet =
      allowList && allowList.length > 0 ? new Set(allowList) : null
    const roleDefaultSet =
      defaultToolIds && defaultToolIds.length > 0
        ? new Set(defaultToolIds)
        : null
    const hiddenSet = new Set(hiddenToolIds)

    const surviving: ToolDef[] = []
    let filteredCount = 0

    for (const tool of TOOL_REGISTRY) {
      // 1) org allow-list (skip when null — no restriction).
      if (allowSet && !allowSet.has(tool.id)) {
        filteredCount += 1
        continue
      }
      // 2) role default tool ids (skip when null — no restriction).
      if (roleDefaultSet && !roleDefaultSet.has(tool.id)) {
        filteredCount += 1
        continue
      }
      // 3) per-user hidden.
      if (hiddenSet.has(tool.id)) {
        filteredCount += 1
        continue
      }
      // 4) RBAC permission gate.
      if (tool.permission) {
        if (!hasPermission(tool.permission.action, tool.permission.resource)) {
          filteredCount += 1
          continue
        }
      }
      surviving.push(tool)
    }

    const ordered = reorder(surviving, toolOrder)

    // Pin resolution — user pins win; role defaults fill the gap
    // when the user hasn't picked anything yet.
    const effectivePinIds =
      pinnedToolIds.length > 0 ? pinnedToolIds : dedupe(defaultPinnedIds)
    const orderedById = new Map(ordered.map((t) => [t.id, t] as const))
    const pinned = effectivePinIds
      .map((id) => orderedById.get(id))
      .filter((t): t is ToolDef => Boolean(t))

    return { pinned, all: ordered, filtered_count: filteredCount }
    // `lastLoadTime` is intentionally a dep — it advances on every
    // successful permission reload and forces the memo to recompute
    // so `hasPermission` evaluates against the fresh permission set.
    // ESLint can't statically see that `hasPermission` closes over
    // the same state slice that `lastLoadTime` indexes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    allowList,
    defaultToolIds,
    defaultPinnedIds,
    pinnedToolIds,
    hiddenToolIds,
    toolOrder,
    hasPermission,
    lastLoadTime,
  ])
}

// Created and developed by Jai Singh
