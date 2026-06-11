// Created and developed by Jai Singh
/**
 * ImportLt22Dialog — outbound-app dialog that pulls open / waiting
 * transfer orders from SAP via the on-prem OmniFrame agent's LT22
 * import endpoint.
 *
 * Lifecycle:
 *   1. User opens the dialog from the SmartImportButton in the outbound
 *      data manager (when EITHER the local agent has the `import-lt22`
 *      capability OR a fleet agent in the org reports it — see
 *      [[Patterns/Fleet-Aware-Smart-Routing]]).
 *   2. INSERT a row into `sap_outbound_to_import_runs` with status=queued
 *      and the user-chosen filters.
 *   3. Enqueue a `sap_agent_jobs` row pointing at `/sap/import-lt22`
 *      with the run id in the payload. When `bestAgentFor('import-lt22')`
 *      returns 'fleet' the dialog auto-pins the job to the chosen
 *      fleet agent via `assigned_agent_id` so the local v1.0.0 dev/test
 *      agent (which doesn't expose the endpoint) never claims it. The
 *      manual "Pin to agent" picker still overrides the auto-pin.
 *   4. Subscribe to the inserted run row via Realtime → live status pill.
 *   5. On `completed` → toast + close + invoke `onImported` so the data
 *      manager grid refreshes.
 *      On `failed` → keep dialog open with the error + retry button.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  Loader2,
  RefreshCw,
  Server,
  Sparkles,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import type { WsEvent, WsEventHandler } from '@/lib/work-service'
import { workServiceWs } from '@/lib/work-service/websocket'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useOnlineSapAgents } from '@/features/admin/sap-testing/components/agents-fleet-card'
import { useAgentDetection } from '@/features/admin/sap-testing/hooks/use-agent-detection'

// ─────────────────────────────────────────────────────────────────────
// Storage keys for sticky form values
// ─────────────────────────────────────────────────────────────────────
const STORAGE_PREFIX = 'omniframe.lt22.import.'
const KEY_WAREHOUSE = `${STORAGE_PREFIX}warehouse`
const KEY_STORAGE_TYPE = `${STORAGE_PREFIX}storage_type`
const KEY_LAYOUT = `${STORAGE_PREFIX}layout_variant`
const KEY_PINNED_AGENT = `${STORAGE_PREFIX}pinned_agent`

// Defaults from the user's recording (DeliveryData.vbs).
const DEFAULT_WAREHOUSE = 'PDC'
const DEFAULT_STORAGE_TYPE = '916'
const DEFAULT_LAYOUT = 'ONEBOXAPPX'

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────
type RunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'partial'
  | 'canceled'

interface ImportRunRow {
  id: string
  organization_id: string
  triggered_by: string | null
  warehouse: string
  storage_type: string | null
  show_open_only: boolean | null
  show_verified: boolean | null
  layout_variant: string | null
  date_from: string | null
  date_to: string | null
  status: RunStatus
  rows_imported: number | null
  duration_ms: number | null
  error: string | null
  agent_id: string | null
  job_id: string | null
  started_at: string | null
  completed_at: string | null
}

export interface ImportLt22DialogProps {
  open: boolean
  onClose: () => void
  /** Called once the import completes successfully (any row count). */
  onImported?: (rowsImported: number) => void
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
function readStoredString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

function writeStoredString(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

function statusPillClasses(status: RunStatus | null): string {
  switch (status) {
    case 'queued':
      return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800'
    case 'running':
      return 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-800'
    case 'completed':
      return 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800'
    case 'failed':
      return 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-200 dark:border-red-800'
    case 'partial':
      return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800'
    case 'canceled':
      return 'bg-zinc-200 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700'
    default:
      return 'bg-zinc-100 text-zinc-700 border-zinc-300'
  }
}

function relTime(ts: string | null): string {
  if (!ts) return '—'
  const t = Date.parse(ts)
  if (!t) return ts
  const diff = Math.max(0, Date.now() - t)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────
export function ImportLt22Dialog({
  open,
  onClose,
  onImported,
}: ImportLt22DialogProps) {
  const detection = useAgentDetection()
  const onlineAgents = useOnlineSapAgents()

  // ─── Form state (sticky via localStorage) ───
  const [warehouse, setWarehouse] = useState(() =>
    readStoredString(KEY_WAREHOUSE, DEFAULT_WAREHOUSE)
  )
  const [storageType, setStorageType] = useState(() =>
    readStoredString(KEY_STORAGE_TYPE, DEFAULT_STORAGE_TYPE)
  )
  const [layoutVariant, setLayoutVariant] = useState(() =>
    readStoredString(KEY_LAYOUT, DEFAULT_LAYOUT)
  )
  const [showOpenWaiting, setShowOpenWaiting] = useState(true)
  const [showVerified, setShowVerified] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [pinnedAgentId, setPinnedAgentId] = useState<string>(() =>
    readStoredString(KEY_PINNED_AGENT, '')
  )
  // v1.7.2 — track whether we've already warned the user about a
  // pinned-agent override being dropped on capability mismatch, so a
  // re-render doesn't spam toasts every 5s.
  const [pinnedAgentDropped, setPinnedAgentDropped] = useState(false)

  // ─── Live run state ───
  const [activeRun, setActiveRun] = useState<ImportRunRow | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [recentRuns, setRecentRuns] = useState<ImportRunRow[]>([])

  // ─── Persist sticky values ───
  useEffect(() => writeStoredString(KEY_WAREHOUSE, warehouse), [warehouse])
  useEffect(
    () => writeStoredString(KEY_STORAGE_TYPE, storageType),
    [storageType]
  )
  useEffect(() => writeStoredString(KEY_LAYOUT, layoutVariant), [layoutVariant])
  useEffect(
    () => writeStoredString(KEY_PINNED_AGENT, pinnedAgentId),
    [pinnedAgentId]
  )

  // ─── Recent runs for the chosen warehouse ───
  const loadRecentRuns = useCallback(async () => {
    if (!warehouse) {
      setRecentRuns([])
      return
    }
    // sap_outbound_to_import_runs is added in migration 250 — generated
    // DB types don't include it yet, so cast through to bypass the typed
    // overload (matches the pattern used by sap_agents / sap_agent_jobs).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = supabase as any
    try {
      const { data } = await client
        .from('sap_outbound_to_import_runs')
        .select('*')
        .eq('warehouse', warehouse)
        .order('started_at', { ascending: false })
        .limit(5)
      setRecentRuns((data ?? []) as ImportRunRow[])
    } catch (err) {
      logger.warn('Failed to load recent LT22 runs', err)
      setRecentRuns([])
    }
  }, [warehouse])

  useEffect(() => {
    if (open) {
      void loadRecentRuns()
    }
  }, [open, loadRecentRuns])

  // ─── Live status updates on the active run row ───
  //
  // 2026-05-06 — Tier 1 deferred-channel migration (see
  // `memorybank/OmniFrame/Implementations/Migrate-Tier1-Deferred-
  // Channels-To-Rust-WS.md`). The previous
  // `supabase.channel('lt22-import-run-{id}')` per-run channel is
  // retired in favour of a typed `WsEvent::ImportRunStatusChanged`
  // pushed via the `WorkServiceWebSocket` singleton.
  //
  //   - DB:   migration 272 adds the NOTIFY trigger on
  //           sap_outbound_to_import_runs.
  //   - Rust: `sap_import_runs_listener` consumes
  //           `LISTEN sap_import_run_changed`.
  //   - FE:   THIS effect registers a single handler on the singleton
  //           (filtering by run id) and re-fetches the full row on
  //           each WS push so we still get error / agent_id / etc.
  //           A 5-min safety-net poll covers the case where the WS
  //           push is missed.
  useEffect(() => {
    if (!activeRun?.id) return
    const runId = activeRun.id
    let cancelled = false

    const refetchRun = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as any
      const { data } = await client
        .from('sap_outbound_to_import_runs')
        .select('*')
        .eq('id', runId)
        .maybeSingle()
      if (cancelled || !data) return
      const next = data as ImportRunRow
      setActiveRun(next)
      if (next.status === 'completed' || next.status === 'partial') {
        const rows = next.rows_imported ?? 0
        toast.success(
          rows === 0
            ? 'No new transfer orders to import.'
            : `Imported ${rows.toLocaleString()} transfer order${rows === 1 ? '' : 's'}.`,
          { duration: 4000 }
        )
        onImported?.(rows)
        setTimeout(() => {
          if (cancelled) return
          onClose()
          setActiveRun(null)
        }, 800)
        void loadRecentRuns()
      } else if (next.status === 'failed' || next.status === 'canceled') {
        toast.error(`Import failed: ${next.error ?? 'unknown error'}`, {
          duration: 6000,
        })
        void loadRecentRuns()
      }
    }

    let wsHandler: WsEventHandler | null = null
    const orgId = activeRun.organization_id
    if (orgId) {
      const handler: WsEventHandler = (event: WsEvent) => {
        if (event.type !== 'ImportRunStatusChanged') return
        if (event.run_id !== runId) return
        // Belt-and-braces org check — defence-in-depth on top of the
        // Rust send-loop's deny-by-default org filter.
        if (event.organization_id && event.organization_id !== orgId) return
        void refetchRun()
      }
      try {
        workServiceWs.connect(orgId, handler)
        wsHandler = handler
      } catch {
        /* WS setup failure — fall back to safety-net polling only. */
      }
    }

    const SAFETY_NET_INTERVAL_MS = 5 * 60_000
    const safetyNet = setInterval(() => {
      if (workServiceWs.getConnectionState() === 'connected') return
      void refetchRun()
    }, SAFETY_NET_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(safetyNet)
      if (wsHandler) {
        try {
          workServiceWs.removeHandler(wsHandler)
        } catch {
          /* ignore */
        }
      }
    }
  }, [
    activeRun?.id,
    activeRun?.organization_id,
    onClose,
    onImported,
    loadRecentRuns,
  ])

  // v1.6.6 follow-up — fleet routing decision (declared up here so
  // `handleSubmit` below can capture it for the auto-pin). When the
  // local agent lacks `import-lt22` but a fleet agent has it, the
  // dialog pivots the agent strip + auto-pins the queue job to that
  // fleet agent so a stale local agent (e.g. v1.0.0 dev/test build
  // that polls the queue but doesn't expose the endpoint) never
  // claims the wrong job.
  const route = detection.bestAgentFor('import-lt22')
  const fleetAgent = useMemo(() => {
    if (route !== 'fleet') return null
    return (
      detection.fleet.agents.find((a) =>
        a.capabilities.includes('import-lt22')
      ) ?? null
    )
  }, [route, detection.fleet.agents])

  // v1.7.2 — filter the "Pin to Agent" picker to ONLY agents that
  // actually advertise the `import-lt22` capability. Pre-1.7.2 the
  // picker listed every online agent in the fleet, so a user could
  // (and reportedly did) pin the LT22 job to a v1.0.0 dev/test agent
  // that polls the sap_agent_jobs queue but doesn't expose
  // /sap/import-lt22. The pinned agent would then claim the row and
  // 404 on dispatch, the user would see "failed" with no obvious
  // recourse. Filtering to capability holders eliminates that whole
  // class of misconfiguration.
  const lt22CapableAgents = useMemo(
    () =>
      onlineAgents.filter((a) =>
        Array.isArray(a.capabilities)
          ? a.capabilities.includes('import-lt22')
          : false
      ),
    [onlineAgents]
  )

  // v1.7.2 — if the persisted `pinnedAgentId` from localStorage
  // doesn't match any currently-online lt22-capable agent (e.g. the
  // saved pin is the v1.0.0 dev agent the user has since upgraded to
  // v1.7.x but the new id has changed; OR the saved pin is now
  // offline; OR the saved pin doesn't have the cap at all), drop it
  // so the auto-pin to the fleet agent kicks in. We toast ONCE per
  // dialog session so the user understands why their pin disappeared.
  // The picker `<select>` also defensively re-syncs to '' below so
  // the bound value is always coherent with the available options.
  useEffect(() => {
    if (!open) {
      // Reset the warning so a re-open with a NEW stale pin re-toasts.
      setPinnedAgentDropped(false)
      return
    }
    if (!pinnedAgentId) return
    const stillCapable = lt22CapableAgents.some((a) => a.id === pinnedAgentId)
    if (stillCapable) return
    // The pin doesn't match any lt22-capable online agent — drop it.
    const replacement = fleetAgent?.id ?? null
    setPinnedAgentId('')
    if (!pinnedAgentDropped) {
      setPinnedAgentDropped(true)
      toast.warning(
        `Saved pinned agent ${pinnedAgentId} doesn't have the import-lt22 capability` +
          (replacement
            ? ` — using ${replacement} instead.`
            : ' — falling back to the fleet auto-routing.'),
        { duration: 5000 }
      )
    }
  }, [open, pinnedAgentId, lt22CapableAgents, fleetAgent, pinnedAgentDropped])

  // ─── Submit handler ───
  const handleSubmit = useCallback(async () => {
    setSubmitError(null)
    if (!warehouse.trim()) {
      setSubmitError('Warehouse is required.')
      return
    }
    setIsSubmitting(true)
    try {
      // Resolve user + org for the run row's org scope.
      const { data: authData } = await supabase.auth.getUser()
      const userId = authData.user?.id
      if (!userId) throw new Error('Not signed in.')
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', userId)
        .maybeSingle()
      const orgId = profile?.organization_id as string | undefined
      if (!orgId) throw new Error('Could not resolve organization_id.')

      // 1. INSERT the run row. Realtime sub will flip the pill as the
      //    agent PATCHes status.
      const runInsert = {
        organization_id: orgId,
        triggered_by: userId,
        warehouse: warehouse.trim(),
        storage_type: storageType.trim() || null,
        show_open_only: showOpenWaiting,
        show_verified: showVerified,
        layout_variant: layoutVariant.trim() || null,
        date_from: dateFrom || null,
        date_to: dateTo || null,
        status: 'queued' as const,
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as any
      const { data: runRow, error: runErr } = await client
        .from('sap_outbound_to_import_runs')
        .insert(runInsert)
        .select('*')
        .single()
      if (runErr)
        throw new Error(`Could not create import run: ${runErr.message}`)
      const run = runRow as ImportRunRow
      setActiveRun(run)

      // 2. Enqueue the agent job. The payload mirrors Lt22ImportRequest
      //    on the agent side.
      const jobPayload: Record<string, unknown> = {
        warehouse: warehouse.trim(),
        storage_type: storageType.trim(),
        show_verified: showVerified,
        show_open_waiting: showOpenWaiting,
        layout_variant: layoutVariant.trim(),
        date_from: dateFrom || null,
        date_to: dateTo || null,
        organization_id: orgId,
        triggered_by: userId,
        import_run_id: run.id,
      }
      // v1.6.6 follow-up — auto-pin when the routing decision is 'fleet'
      // AND the user hasn't manually overridden via the "Pin to agent"
      // picker. Without the auto-pin a v1.0.0 local agent that polls the
      // queue but doesn't expose `/sap/import-lt22` would happily claim
      // the job and 404 on dispatch. Manual pin always wins.
      const effectivePinnedAgentId =
        pinnedAgentId ||
        (route === 'fleet' && fleetAgent ? fleetAgent.id : null)
      const jobInsert: Record<string, unknown> = {
        organization_id: orgId,
        requested_by: userId,
        endpoint: '/sap/import-lt22',
        payload: jobPayload,
        priority: 80,
        max_attempts: 1,
        status: 'queued',
        idempotency_key: `lt22-${run.id}`,
        assigned_agent_id: effectivePinnedAgentId,
      }
      const { data: jobRow, error: jobErr } = await client
        .from('sap_agent_jobs')
        .insert(jobInsert)
        .select('id')
        .single()
      if (jobErr) {
        // Best-effort: mark the run failed so the UI doesn't spin forever.
        await client
          .from('sap_outbound_to_import_runs')
          .update({
            status: 'failed',
            error: `Job submit failed: ${jobErr.message}`,
            completed_at: new Date().toISOString(),
          })
          .eq('id', run.id)
        throw new Error(`Could not enqueue job: ${jobErr.message}`)
      }

      // Patch the run with its job id so the dashboard can cross-link.
      if (jobRow?.id) {
        await client
          .from('sap_outbound_to_import_runs')
          .update({ job_id: jobRow.id as string })
          .eq('id', run.id)
      }

      toast.info('Import queued — agent will pick it up shortly.', {
        duration: 2500,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setSubmitError(msg)
      toast.error(`Import failed to start: ${msg}`)
      setActiveRun(null)
    } finally {
      setIsSubmitting(false)
    }
  }, [
    warehouse,
    storageType,
    layoutVariant,
    showOpenWaiting,
    showVerified,
    dateFrom,
    dateTo,
    pinnedAgentId,
    route,
    fleetAgent,
  ])

  // ─── Reset transient state on close ───
  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      setActiveRun(null)
      setSubmitError(null)
      onClose()
    }
  }, [isSubmitting, onClose])

  // ─── Derived UI bits ───
  const status: RunStatus | null = activeRun?.status ?? null
  const isInFlight = status === 'queued' || status === 'running'
  const hasFailed = status === 'failed' || status === 'canceled'
  // `route` and `fleetAgent` are derived above (before handleSubmit).
  const agentLabel = useMemo(() => {
    if (route === 'fleet' && fleetAgent) {
      const name = fleetAgent.hostname || fleetAgent.id
      const ver = fleetAgent.version ? `v${fleetAgent.version}` : ''
      return ver ? `${name} · ${ver} (Fleet)` : `${name} (Fleet)`
    }
    if (!detection.health) return 'Agent unavailable'
    const name = detection.agentName ?? 'Local Agent'
    const ver = detection.health.version ? `v${detection.health.version}` : ''
    return ver ? `${name} · ${ver}` : name
  }, [route, fleetAgent, detection.health, detection.agentName])
  const canRoute = route !== null
  const isFleetRoute = route === 'fleet'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose()
      }}
    >
      <DialogContent className='max-h-[90vh] w-[95vw] max-w-2xl overflow-y-auto'>
        <DialogHeader>
          <div className='flex items-center gap-2'>
            <DialogTitle className='text-xl font-bold'>
              Import Open TOs from SAP
            </DialogTitle>
            <Badge
              variant='outline'
              className='border-blue-400 text-blue-700 dark:text-blue-300'
            >
              LT22
            </Badge>
          </div>
          <DialogDescription>
            Pulls every open / waiting transfer order matching the filters below
            from SAP via the on-prem OmniFrame agent.
          </DialogDescription>
        </DialogHeader>

        {/* Agent strip — green when ANY routing path works (local or fleet),
            amber when neither does. The "Using agent:" line names the
            actual agent that will run the job. Fleet routing makes the
            (Fleet) suffix explicit so the user knows the work is going
            cross-machine. */}
        <div
          className={cn(
            'mt-2 flex items-center gap-2 rounded-md border px-3 py-2 text-xs',
            canRoute
              ? 'border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100'
              : 'border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
          )}
        >
          <Server className='h-3.5 w-3.5' />
          <span className='font-medium'>
            {isFleetRoute ? 'Routing through:' : 'Using agent:'}
          </span>
          <span>{agentLabel}</span>
          {canRoute && (
            <span className='ml-auto inline-flex items-center gap-1'>
              <span className='h-1.5 w-1.5 rounded-full bg-emerald-500' />
              {isFleetRoute ? 'Fleet · queued' : 'Online'}
            </span>
          )}
        </div>

        {/* Status pill (only when a run is active) */}
        {activeRun && (
          <div
            className={cn(
              'mt-3 flex items-center gap-3 rounded-md border px-3 py-2 text-sm',
              statusPillClasses(status)
            )}
          >
            {status === 'running' || status === 'queued' ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : status === 'completed' || status === 'partial' ? (
              <CheckCircle2 className='h-4 w-4' />
            ) : status === 'failed' || status === 'canceled' ? (
              <AlertCircle className='h-4 w-4' />
            ) : (
              <Clock className='h-4 w-4' />
            )}
            <div className='flex-1'>
              <div className='font-medium capitalize'>
                {status ?? 'Unknown'}
                {activeRun.rows_imported != null && status !== 'failed' && (
                  <span className='ml-2 font-normal'>
                    · {activeRun.rows_imported.toLocaleString()} rows
                  </span>
                )}
              </div>
              {activeRun.error && (
                <div className='mt-0.5 text-xs opacity-90'>
                  {activeRun.error}
                </div>
              )}
              {activeRun.agent_id && (
                <div className='mt-0.5 text-xs opacity-70'>
                  Agent: {activeRun.agent_id}
                </div>
              )}
            </div>
            {hasFailed && (
              <Button
                variant='outline'
                size='sm'
                onClick={() => {
                  setActiveRun(null)
                  setSubmitError(null)
                }}
              >
                <RefreshCw className='mr-1.5 h-3.5 w-3.5' />
                Retry
              </Button>
            )}
          </div>
        )}

        {/* Form */}
        <div className='mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='lt22-warehouse'>
              Warehouse <span className='text-destructive'>*</span>
            </Label>
            <Input
              id='lt22-warehouse'
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value.toUpperCase())}
              placeholder='PDC'
              maxLength={4}
              disabled={isInFlight}
              className='font-mono uppercase'
            />
            <p className='text-muted-foreground text-[11px]'>T3_LGNUM</p>
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='lt22-storage-type'>Storage Type</Label>
            <Input
              id='lt22-storage-type'
              value={storageType}
              onChange={(e) => setStorageType(e.target.value)}
              placeholder='916 (blank = all)'
              maxLength={4}
              disabled={isInFlight}
              className='font-mono'
            />
            <p className='text-muted-foreground text-[11px]'>T3_LGTYP-LOW</p>
          </div>

          <div className='flex flex-col gap-1.5 sm:col-span-2'>
            <Label htmlFor='lt22-layout'>Layout Variant</Label>
            <Input
              id='lt22-layout'
              value={layoutVariant}
              onChange={(e) => setLayoutVariant(e.target.value)}
              placeholder='ONEBOXAPPX'
              disabled={isInFlight}
              className='font-mono'
            />
            <p className='text-muted-foreground text-[11px]'>
              LISTV — saved column layout. ONEBOXAPPX is the customer's
              outbound-friendly default.
            </p>
          </div>

          <div className='flex items-center justify-between gap-3 rounded-md border p-3 sm:col-span-2'>
            <div className='flex flex-col gap-0.5'>
              <span className='text-sm font-medium'>
                Show "Open + Waiting" rows
              </span>
              <span className='text-muted-foreground text-xs'>
                T3_SENAC — typical default for outbound queries.
              </span>
            </div>
            <Switch
              checked={showOpenWaiting}
              onCheckedChange={setShowOpenWaiting}
              disabled={isInFlight}
            />
          </div>

          <div className='flex items-center justify-between gap-3 rounded-md border p-3 sm:col-span-2'>
            <div className='flex flex-col gap-0.5'>
              <span className='text-sm font-medium'>Show "Verified" rows</span>
              <span className='text-muted-foreground text-xs'>
                T3_SEVON — usually OFF; turn on if you also want fully processed
                TOs in the snapshot.
              </span>
            </div>
            <Switch
              checked={showVerified}
              onCheckedChange={setShowVerified}
              disabled={isInFlight}
            />
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='lt22-date-from'>Created from (optional)</Label>
            <Input
              id='lt22-date-from'
              type='date'
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              disabled={isInFlight}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='lt22-date-to'>Created to (optional)</Label>
            <Input
              id='lt22-date-to'
              type='date'
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              disabled={isInFlight}
            />
          </div>

          {/* v1.7.2 — only render the picker when there's MORE than
              one capable agent (a single capable agent + zero choice
              is just "use that one"). The list itself is filtered to
              `import-lt22` holders so a user can never pin to a
              v1.0.0 dev agent that polls the queue but doesn't
              expose the endpoint. */}
          {lt22CapableAgents.length > 1 && (
            <div className='flex flex-col gap-1.5 sm:col-span-2'>
              <Label htmlFor='lt22-pinned-agent'>Pin to Agent (optional)</Label>
              <select
                id='lt22-pinned-agent'
                value={pinnedAgentId}
                onChange={(e) => setPinnedAgentId(e.target.value)}
                disabled={isInFlight}
                className='border-border bg-background h-9 rounded-md border px-3 text-sm'
              >
                <option value=''>Any capable agent in the org</option>
                {lt22CapableAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.display_name || agent.hostname || agent.id}
                    {agent.citrix_session ? ` · ${agent.citrix_session}` : ''}
                    {agent.version ? ` · v${agent.version}` : ''}
                  </option>
                ))}
              </select>
              <p className='text-muted-foreground text-[11px]'>
                Only agents reporting the <code>import-lt22</code> capability
                are listed.
              </p>
            </div>
          )}
        </div>

        {submitError && !activeRun && (
          <div className='mt-3 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200'>
            <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' />
            <span>{submitError}</span>
          </div>
        )}

        {/* Recent runs */}
        {recentRuns.length > 0 && (
          <div className='mt-5'>
            <div className='text-muted-foreground mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide uppercase'>
              <Database className='h-3.5 w-3.5' />
              Recent runs · {warehouse}
            </div>
            <div className='space-y-1.5'>
              {recentRuns.map((run) => (
                <div
                  key={run.id}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs',
                    statusPillClasses(run.status)
                  )}
                >
                  <span className='font-mono uppercase'>{run.status}</span>
                  <span>·</span>
                  <span>{(run.rows_imported ?? 0).toLocaleString()} rows</span>
                  <span className='ml-auto opacity-80'>
                    {relTime(run.started_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className='mt-5'>
          <Button
            variant='ghost'
            onClick={handleClose}
            disabled={isSubmitting || isInFlight}
          >
            {isInFlight ? 'Running…' : 'Cancel'}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isSubmitting || isInFlight || !canRoute || !warehouse.trim()
            }
          >
            {isSubmitting ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Queuing…
              </>
            ) : isInFlight ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Importing…
              </>
            ) : (
              <>
                <Zap className='mr-2 h-4 w-4' />
                {isFleetRoute ? 'Run LT22 Import (Fleet)' : 'Run LT22 Import'}
              </>
            )}
          </Button>
        </DialogFooter>

        {/* Footer hint — only show when neither routing path works.
            When local is missing the cap but a fleet agent has it the
            agent strip already names the fleet target, so a separate
            warning would be noise. */}
        {!canRoute && (
          <p className='text-muted-foreground mt-2 flex items-center gap-1.5 text-[11px]'>
            <Sparkles className='h-3 w-3' />
            {detection.available
              ? 'Your local agent does not report `import-lt22` and no fleet agent reports it either. Upgrade the local agent OR ensure a remote v1.6.6+ agent is online.'
              : 'The OmniFrame agent must be running on this machine OR a fleet agent in your org must be online. Launch OmniFrame_Agent.exe (or sign into a Citrix box that has it) and re-open this dialog.'}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
