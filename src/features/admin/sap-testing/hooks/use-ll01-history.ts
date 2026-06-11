// Created and developed by Jai Singh
/**
 * useLL01History — read access to the persisted LL01 Warehouse Activity
 * Monitor run history (2026-05-31).
 *
 * Backed by `ll01_activity_runs` (migration 333), which the agent writes one
 * full-fidelity JSONB row per run. This hook splits the read into two cheap
 * queries so the date picker stays snappy:
 *
 *   - `runs`    — slim INDEX (id / ran_at / ok only), fetched once per org.
 *   - `loadRun` — lazy full-payload fetch for the single run the user picks.
 *
 * `ll01_activity_runs` is not yet in `database.types.ts` (regen deferred, same
 * as `ll01_activity_snapshots` — see Implement-LL01-Warehouse-Activity-Monitor),
 * so `from` is cast through `unknown` here; the runtime shape is validated by
 * `LL01RunIndexEntry` / `LL01RunResult`.
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import type {
  LL01RunIndexEntry,
  LL01RunResult,
} from '../components/warehouse-activity-monitor-types'

/** Cap the index read. One run/day for a year is ~365; this is a generous
 *  ceiling that keeps the picker query bounded without paging. */
const RUN_INDEX_LIMIT = 730

// Call `supabase.from(table)` with `this` BOUND to the client. Detaching the
// method (`const f = supabase.from; f(table)`) loses `this` and throws inside
// supabase-js — which is exactly what silently broke the history index +
// loadRun (the History button stayed disabled and recovery never fired). The
// parenthesized member call below preserves `this`, mirroring `fetchSnapshots`
// in warehouse-activity-monitor-view.tsx.
function untypedFrom(table: string) {
  return (
    supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>
  )(table)
}

export interface UseLL01HistoryResult {
  /** Saved runs, newest first. Empty until the index resolves. */
  runs: LL01RunIndexEntry[]
  /** True while the index is (re)loading. */
  loadingIndex: boolean
  /** Refetch the index — call after a fresh run persists. */
  refreshIndex: () => Promise<void>
  /** Lazily fetch one run's full payload, normalized to `LL01RunResult`.
   *  Returns null when the row is missing or RLS hides it. */
  loadRun: (snapshotRunId: string) => Promise<LL01RunResult | null>
}

export function useLL01History(orgId: string | null): UseLL01HistoryResult {
  const [runs, setRuns] = useState<LL01RunIndexEntry[]>([])
  const [loadingIndex, setLoadingIndex] = useState(false)

  const refreshIndex = useCallback(async () => {
    if (!orgId) {
      setRuns([])
      return
    }
    setLoadingIndex(true)
    try {
      const { data, error } = await untypedFrom('ll01_activity_runs')
        .select('snapshot_run_id, ran_at, ok')
        .eq('organization_id', orgId)
        .order('ran_at', { ascending: false })
        .limit(RUN_INDEX_LIMIT)
      if (error) {
        // Surfaced silently — caller falls back to "no saved runs" UI.
        setRuns([])
        return
      }
      setRuns((data ?? []) as unknown as LL01RunIndexEntry[])
    } finally {
      setLoadingIndex(false)
    }
  }, [orgId])

  useEffect(() => {
    void refreshIndex()
  }, [refreshIndex])

  const loadRun = useCallback(
    async (snapshotRunId: string): Promise<LL01RunResult | null> => {
      if (!orgId) return null
      const { data, error } = await untypedFrom('ll01_activity_runs')
        .select(
          'snapshot_run_id, ran_at, agent_id, ok, payload_version, duration_ms, plants, categories, errors'
        )
        .eq('organization_id', orgId)
        .eq('snapshot_run_id', snapshotRunId)
        .maybeSingle()
      if (error || !data) return null
      const row = data as unknown as {
        snapshot_run_id: string
        ran_at: string
        agent_id: string | null
        ok: boolean
        payload_version: number | null
        duration_ms: number | null
        plants: string[] | null
        categories: LL01RunResult['categories'] | null
        errors: LL01RunResult['errors'] | null
      }
      // Same boundary-normalization discipline as the live dispatch path:
      // coerce every field so the consuming tabs only ever see the typed
      // shape (see Debug/Fix-LL01-Fleet-Result-Shape-Drift-Crash).
      return {
        ok: row.ok,
        payload_version: row.payload_version ?? undefined,
        snapshot_run_id: row.snapshot_run_id,
        ran_at: row.ran_at,
        agent_id: row.agent_id ?? '',
        duration_ms: row.duration_ms ?? 0,
        plants: row.plants ?? [],
        categories: row.categories ?? [],
        errors: row.errors ?? [],
      }
    },
    [orgId]
  )

  return { runs, loadingIndex, refreshIndex, loadRun }
}

// Created and developed by Jai Singh
