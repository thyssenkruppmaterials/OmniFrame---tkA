// Created and developed by Jai Singh
/**
 * useWorkEngineSettings — React hook over `workEngineSettingsService`.
 *
 * Returns the per-org engine row, per-work-type rows, warehouse overrides,
 * and a stable `resolve()` helper that runs through the same
 * warehouse → type → engine → default order as Postgres `work_setting()`.
 */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import {
  workEngineSettingsService,
  type WorkEngineSettingsRow,
  type WorkTypeSettingsRow,
  type WarehouseOverrideRow,
} from '@/lib/supabase/work-engine-settings.service'

export function useWorkEngineSettings(orgId: string | null | undefined) {
  const [engine, setEngine] = useState<WorkEngineSettingsRow | null>(null)
  const [types, setTypes] = useState<WorkTypeSettingsRow[]>([])
  const [overrides, setOverrides] = useState<WarehouseOverrideRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (!orgId) {
      setEngine(null)
      setTypes([])
      setOverrides([])
      setIsLoading(false)
      return
    }
    let cancelled = false
    setIsLoading(true)
    Promise.all([
      workEngineSettingsService.getEngineSettings(orgId),
      workEngineSettingsService.listWorkTypeSettings(orgId),
      workEngineSettingsService.listWarehouseOverrides(orgId),
    ])
      .then(([e, t, o]) => {
        if (cancelled) return
        setEngine(e)
        setTypes(t)
        setOverrides(o)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err : new Error(String(err)))
      })
      .finally(() => !cancelled && setIsLoading(false))

    // Realtime: re-fetch when any of the three settings tables change
    // for our org. Postgres NOTIFY is consumed by the Rust service; the
    // browser uses Postgres-changes for the same effect.
    const ch = supabase
      .channel(`work_engine_settings_${orgId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_engine_settings',
          filter: `organization_id=eq.${orgId}`,
        },
        () => setRefreshTick((t) => t + 1)
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_type_settings',
          filter: `organization_id=eq.${orgId}`,
        },
        () => setRefreshTick((t) => t + 1)
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_type_warehouse_overrides',
          filter: `organization_id=eq.${orgId}`,
        },
        () => setRefreshTick((t) => t + 1)
      )
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(ch)
    }
  }, [orgId, refreshTick])

  const resolve = useMemo(
    () =>
      <T>(
        taskType: string,
        warehouse: string | null,
        key: keyof WorkTypeSettingsRow & string
      ) => {
        const t = types.find((r) => r.task_type === taskType)
        const w = overrides.find(
          (r) => r.task_type === taskType && r.warehouse === warehouse
        )
        return workEngineSettingsService.resolveEffective<T>(engine, t, w, key)
      },
    [engine, types, overrides]
  )

  return {
    engine,
    types,
    overrides,
    resolve,
    isLoading,
    error,
    refresh: () => setRefreshTick((t) => t + 1),
  }
}

// Created and developed by Jai Singh
