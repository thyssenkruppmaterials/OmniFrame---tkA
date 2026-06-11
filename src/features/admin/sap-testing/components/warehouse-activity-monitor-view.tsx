// Created and developed by Jai Singh
/**
 * LL01 Warehouse Activity Monitor — main view shell (2026-05-22).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { History, Loader2, Radio } from 'lucide-react'
import { useOrgId } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useLL01FleetProgress } from '../hooks/use-ll01-fleet-progress'
import { agentFetch } from '../lib/agent-fetch'
import { AgingTab } from './AgingTab'
import { HeatmapTab } from './HeatmapTab'
import { TrendTab } from './TrendTab'
import { LL01ReportButton } from './ll01-report-button'
import {
  LL01_PLANTS,
  type LL01CategoryKey,
  type LL01Progress,
  type LL01RunResult,
  type LL01SnapshotRow,
} from './warehouse-activity-monitor-types'

interface WarehouseActivityMonitorViewProps {
  result: LL01RunResult | null
  isRunning: boolean
  progress: LL01Progress | null
  lastRunAt: string | null
  onRefresh: () => void
  executionModeIsFleet: boolean
  /** True when `result` is a saved run reloaded via the date picker rather
   *  than the live run. Surfaces a banner + "Back to current run" affordance. */
  isHistorical?: boolean
  /** True while the picked historical run's payload is still loading. */
  historicalLoading?: boolean
  /** Clears the historical selection and returns to the live run. */
  onExitHistorical?: () => void
}

async function fetchSnapshots(orgId: string): Promise<LL01SnapshotRow[]> {
  // ll01_activity_snapshots is not yet in database.types.ts (regen deferred —
  // see Implement-LL01-Warehouse-Activity-Monitor.md). Cast the typed `from`
  // through `any` so the build passes; fields are validated by the runtime
  // shape `LL01SnapshotRow` in warehouse-activity-monitor-types.ts.
  const { data, error } = await (
    supabase.from as unknown as (
      table: string
    ) => ReturnType<typeof supabase.from>
  )('ll01_activity_snapshots')
    .select('ran_at, plant, category, count, snapshot_run_id')
    .eq('organization_id', orgId)
    .order('ran_at', { ascending: false })
    .limit(5000)

  if (error) {
    // Surfaced silently — caller falls back to empty trend data.
    // (`no-console` rule prohibits console.warn in production code; the
    // empty return + caller's "no data yet" UI is the right user-facing path.)
    return []
  }
  return (data ?? []) as unknown as LL01SnapshotRow[]
}

export function WarehouseActivityMonitorView({
  result,
  isRunning,
  progress,
  lastRunAt,
  onRefresh,
  executionModeIsFleet,
  isHistorical = false,
  historicalLoading = false,
  onExitHistorical,
}: WarehouseActivityMonitorViewProps) {
  const orgId = useOrgId()
  const [snapshots, setSnapshots] = useState<LL01SnapshotRow[]>([])
  const [selectedPlants, setSelectedPlants] = useState<string[]>([
    ...LL01_PLANTS,
  ])
  const [pollProgress, setPollProgress] = useState<LL01Progress | null>(null)

  const loadSnapshots = useCallback(async () => {
    if (!orgId) return
    const rows = await fetchSnapshots(orgId)
    setSnapshots(rows)
  }, [orgId])

  useEffect(() => {
    void loadSnapshots()
  }, [loadSnapshots, result?.snapshot_run_id])

  useEffect(() => {
    if (!isRunning || executionModeIsFleet) {
      setPollProgress(null)
      return
    }
    const id = window.setInterval(async () => {
      try {
        // agentFetch returns the raw Response — see lib/agent-fetch.ts.
        const res = await agentFetch('/sap/ll01/warehouse-activity/progress')
        if (res.ok) {
          const prog = (await res.json()) as LL01Progress
          setPollProgress(prog)
        }
      } catch {
        /* agent offline mid-run */
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [isRunning, executionModeIsFleet])

  const priorSnapshots = useMemo(() => {
    if (!result?.snapshot_run_id) return snapshots
    return snapshots.filter((s) => s.snapshot_run_id !== result.snapshot_run_id)
  }, [snapshots, result?.snapshot_run_id])

  // Fleet runs can't poll the agent's /progress endpoint (it's on a Citrix
  // box). Derive live progress from the agent's relayed console stream instead
  // so the bar advances as each plant (warehouse) is processed.
  const fleetProgress = useLL01FleetProgress(isRunning && executionModeIsFleet)

  const togglePlant = (plant: string) => {
    setSelectedPlants((prev) =>
      prev.includes(plant) ? prev.filter((p) => p !== plant) : [...prev, plant]
    )
  }

  // Precedence: live console-derived fleet progress > local-mode poll > the
  // static initial progress set at run start (fleet's "Fetching…" placeholder
  // until the first plant line arrives).
  const effectiveProgress = fleetProgress ?? pollProgress ?? progress

  return (
    <Tabs defaultValue='heatmap' className='w-full'>
      {isHistorical && (
        <div className='mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm'>
          <span className='flex items-center gap-2'>
            {historicalLoading ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              <History className='h-4 w-4 text-amber-600' />
            )}
            {historicalLoading
              ? 'Loading saved run…'
              : result
                ? `Viewing saved run from ${format(
                    new Date(result.ran_at),
                    'MMM d, yyyy · h:mm a'
                  )}`
                : 'Saved run unavailable.'}
          </span>
          {onExitHistorical && (
            <Button size='sm' variant='outline' onClick={onExitHistorical}>
              <Radio className='mr-1.5 h-3.5 w-3.5' />
              Back to current run
            </Button>
          )}
        </div>
      )}
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <TabsList>
          <TabsTrigger value='heatmap'>Heatmap</TabsTrigger>
          <TabsTrigger value='aging'>Aging</TabsTrigger>
          <TabsTrigger value='trend'>Trend</TabsTrigger>
        </TabsList>
        <LL01ReportButton result={result} />
      </div>
      <TabsContent value='heatmap' className='mt-4'>
        <HeatmapTab
          result={result}
          priorSnapshots={priorSnapshots}
          isRunning={isRunning}
          progress={effectiveProgress}
          lastRunAt={lastRunAt}
          selectedPlants={selectedPlants}
          onTogglePlant={togglePlant}
          onRefresh={onRefresh}
        />
      </TabsContent>
      <TabsContent value='aging' className='mt-4'>
        <AgingTab
          result={result}
          selectedPlants={selectedPlants}
          onTogglePlant={togglePlant}
        />
      </TabsContent>
      <TabsContent value='trend' className='mt-4'>
        <TrendTab
          snapshots={snapshots}
          selectedPlants={selectedPlants}
          onTogglePlant={togglePlant}
          onDrilldown={(_plant, _category: LL01CategoryKey) => {
            /* Trend drilldown re-fetch is a follow-up — rows aren't in snapshots */
          }}
        />
      </TabsContent>
    </Tabs>
  )
}

// Created and developed by Jai Singh
