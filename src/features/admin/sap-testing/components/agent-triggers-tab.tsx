// Created and developed by Jai Singh
/**
 * Agent Triggers admin tab — Phase 9 of the rust-work-service
 * full-integration plan (2026-05-07).
 *
 * REWRITE: prior versions of this file embedded a 700-LOC browser-side
 * trigger evaluator (`useAgentTriggerRuntime`). Phase 9 deletes that
 * runtime hook entirely and moves trigger evaluation server-side into
 * `rust-work-service::triggers::evaluator`. This tab is now PURE CRUD
 * over the new `agent_triggers` table (created by migration 281),
 * plus a live "trigger fire stream" panel fed by
 * `WsEvent::TriggerFired`.
 *
 * Architecture:
 *
 *   admin → REST POST /api/v1/triggers
 *        → INSERT public.agent_triggers
 *        → notify_agent_triggers_changed NOTIFY
 *        → rust-work-service trigger_loader hot-reloads in-memory rules
 *        → rust-work-service trigger_evaluator listens on each row
 *          source-table's NOTIFY channel and INSERTs sap_agent_jobs
 *          on every match
 *        → broadcast WsEvent::TriggerFired (this tab observes)
 *        → existing agent fleet drains sap_agent_jobs (no agent
 *          changes required for evaluation; agents are pure consumers)
 *
 * See:
 *   - `Implementations/Implement-Rust-Work-Service-Phase9.md`
 *   - `Decisions/ADR-Trigger-DSL-Evaluator-Phase9.md`
 *   - REST client: `@/lib/work-service/triggers-client`
 *   - WS hook:     `./hooks/use-trigger-fire-stream`
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  FlaskConical,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  Zap,
  ZapOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  createTrigger,
  deleteTrigger,
  getAllowlists,
  listTriggers,
  previewMatch,
  updateTrigger,
  type AllowlistsResponse,
  type CreateTriggerRequest,
  type TriggerRow,
} from '@/lib/work-service/triggers-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'
import { useAgentConsoleStream } from '../hooks/use-agent-console-stream'
import { useAgentDetection } from '../hooks/use-agent-detection'
import { useSapTestingDashboard } from '../hooks/use-sap-testing-dashboard'
import { useTriggerFireStream } from '../hooks/use-trigger-fire-stream'
// Phase 3 / Phase 6 (rust-work-service full-integration plan, 2026-05-07)
// — fleet observability cards live ABOVE the trigger CRUD list so admins
// can correlate "agent <X> is online + healthy" with "this trigger
// fires sap_agent_jobs that <X> drains". `RecentJobsCard` and the
// `SapConsoleCard` (mounted at the bottom) close the loop end-to-end:
// trigger configured → trigger fires → job INSERT → agent claims →
// console line streamed back. Audit gap closures FE-1 / FE-2 / FE-3
// (2026-05-07) — see `Sessions/2026-05-07.md`.
import { AgentHealthCard } from './agent-health-card'
import { AgentsFleetCard } from './agents-fleet-card'
import { RecentJobsCard } from './recent-jobs-card'
import { SapConsoleCard, useSapConsole } from './sap-console-card'

// ──────────────────────────────────────────────────────────────────────
// Templates — pre-fill helpers for the Create dialog. Recreate the
// three patterns the deleted `_HARDCODED_TRIGGERS` shipped with so an
// admin can land them in two clicks (template → name → save).
// ──────────────────────────────────────────────────────────────────────

interface TriggerTemplate {
  name: string
  description: string
  source_table: string
  source_events: string[]
  match_filter: Record<string, unknown>
  target_endpoint: string
  payload_template: Record<string, unknown>
  post_success_patch?: Record<string, unknown>
}

const TEMPLATES: TriggerTemplate[] = [
  {
    name: 'Auto-Confirm Completed Putaways',
    description:
      'Fire LT12 when an rf_putaway_operations row reaches to_status=Completed (skips MCA + already-confirmed rows).',
    source_table: 'rf_putaway_operations',
    source_events: ['INSERT', 'UPDATE'],
    match_filter: {
      all: [
        { eq: { field: 'to_status', value: 'Completed' } },
        { neq: { field: 'is_mca_workflow', value: true } },
        { is_null: { field: 'confirmed_source' } },
      ],
    },
    target_endpoint: '/sap/confirm-to',
    payload_template: {
      to_number: '{{row.to_number}}',
      warehouse: '{{row.warehouse}}',
    },
    post_success_patch: {
      table: 'rf_putaway_operations',
      filter: { eq: { field: 'id', value: '{{row.id}}' } },
      update: { confirmed_source: 'agent_trigger_direct' },
    },
  },
  {
    name: 'Queued Shipment Processor',
    description:
      'Process every shipment_queue INSERT end-to-end via the 6-step One Click Ship flow.',
    source_table: 'shipment_queue',
    source_events: ['INSERT'],
    match_filter: {},
    target_endpoint: '/sap/process-shipment',
    payload_template: {
      delivery: '{{row.delivery}}',
      item: '{{row.item}}',
      to_number: '{{row.to_number}}',
      warehouse: '{{row.warehouse}}',
      tracking: '{{row.tracking}}',
    },
  },
  {
    name: 'Auto-Confirm Completed Picks → LT12',
    description:
      'Fire LT12 when a work_tasks row with task_type=pick reaches status=completed and has no prior LT12 mark.',
    source_table: 'work_tasks',
    source_events: ['INSERT', 'UPDATE'],
    match_filter: {
      all: [
        { eq: { field: 'task_type', value: 'pick' } },
        { eq: { field: 'status', value: 'completed' } },
        { is_null: { field: 'payload.lt12_confirmed_at' } },
      ],
    },
    target_endpoint: '/sap/lt12',
    payload_template: {
      transfer_order: '{{row.payload.transfer_order}}',
      warehouse: '{{row.warehouse}}',
    },
  },
]

// ──────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────

export function AgentTriggersTab() {
  const [triggers, setTriggers] = useState<TriggerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [allowlists, setAllowlists] = useState<AllowlistsResponse | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<TriggerRow | null>(null)
  const [pendingTemplate, setPendingTemplate] =
    useState<TriggerTemplate | null>(null)

  const { fires, clear: clearFires } = useTriggerFireStream({ maxEntries: 200 })
  const sapDashboard = useSapTestingDashboard()
  const fleetCapabilities = sapDashboard.data?.fleet_capabilities ?? {}

  // Phase 6 — shared fleet snapshot drives BOTH the AgentsFleetCard /
  // AgentHealthCard rendering above AND the SapConsoleCard agent-filter
  // dropdown below, so a single `useAgentDetection` subscription serves
  // every card on this tab (no duplicate fetches — see audit FE-2 note).
  const agentDetection = useAgentDetection()
  const {
    messages: consoleMessages,
    push: pushConsole,
    clear: clearConsole,
  } = useSapConsole('sap-console:agent-triggers-tab', 200)
  const [consoleAgentFilter, setConsoleAgentFilter] = useState<string | null>(
    null
  )
  useAgentConsoleStream(pushConsole, { agentFilter: consoleAgentFilter })

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rows, lists] = await Promise.all([
        listTriggers(),
        allowlists ? Promise.resolve(allowlists) : getAllowlists(),
      ])
      setTriggers(rows)
      setAllowlists(lists)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [allowlists])

  useEffect(() => {
    void refresh()
    // run once on mount; refresh callback handles allowlist memoisation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stats = useMemo(() => {
    const enabled = triggers.filter((t) => t.enabled).length
    return {
      total: triggers.length,
      enabled,
      disabled: triggers.length - enabled,
      firesShown: fires.length,
    }
  }, [triggers, fires])

  const onToggle = useCallback(async (row: TriggerRow) => {
    try {
      const next = await updateTrigger(row.id, { enabled: !row.enabled })
      setTriggers((prev) => prev.map((t) => (t.id === row.id ? next : t)))
      toast.success(next.enabled ? 'Trigger enabled' : 'Trigger disabled', {
        description: next.name,
      })
    } catch (e) {
      toast.error('Toggle failed', {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }, [])

  const onDelete = useCallback(async (row: TriggerRow) => {
    if (
      !confirm(
        `Delete trigger "${row.name}"? This cannot be undone. Pending sap_agent_jobs already enqueued by this trigger continue to drain.`
      )
    ) {
      return
    }
    try {
      await deleteTrigger(row.id)
      setTriggers((prev) => prev.filter((t) => t.id !== row.id))
      toast.success('Trigger deleted', { description: row.name })
    } catch (e) {
      toast.error('Delete failed', {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }, [])

  return (
    <div className='space-y-4'>
      {/* ─── Header strip with KPIs + capability banner ─── */}
      <Card className='shadow-sm'>
        <CardContent className='flex flex-wrap items-center gap-3 py-3'>
          <ShieldCheck className='h-4 w-4 shrink-0 text-emerald-500' />
          <div className='min-w-0 flex-1'>
            <div className='text-sm font-medium'>
              Server-side triggers active
            </div>
            <div className='text-muted-foreground text-xs'>
              Triggers are evaluated by{' '}
              <code className='font-mono'>rust-work-service</code> on the source
              table's Postgres NOTIFY channel. Any agent in the fleet can claim
              the resulting <code className='font-mono'>sap_agent_jobs</code>{' '}
              row — fires even when no browser tab is open.
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <KpiBadge icon={Zap} label='Triggers' value={stats.total} />
            <KpiBadge
              icon={ShieldCheck}
              label='Enabled'
              value={stats.enabled}
              tone='active'
            />
            <KpiBadge
              icon={Server}
              label='Recent fires'
              value={stats.firesShown}
            />
            <Button size='sm' variant='outline' onClick={() => void refresh()}>
              <RefreshCw className='mr-1 h-3 w-3' />
              Refresh
            </Button>
            <Button size='sm' onClick={() => setCreating(true)}>
              <Plus className='mr-1 h-3 w-3' />
              New Trigger
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className='border-red-500/40 shadow-sm'>
          <CardContent className='flex items-center gap-2 py-3 text-sm text-red-700 dark:text-red-400'>
            <AlertCircle className='h-4 w-4' />
            <span>Failed to load triggers: {error}</span>
          </CardContent>
        </Card>
      )}

      {/* ─── Fleet & Diagnostics ───────────────────────────────────────
          Audit gaps FE-1 / FE-2 (2026-05-07): fleet + health cards live
          here so admins can see WHO is going to drain a job a trigger
          fires (`AgentsFleetCard`) and WHETHER the local agent process
          is healthy (`AgentHealthCard`) before scrolling into trigger
          CRUD. `RecentJobsCard` underneath closes the loop end-to-end:
          trigger fires → sap_agent_jobs INSERT → fleet drains → row
          appears in the ledger. */}
      <div className='space-y-3'>
        <div className='text-muted-foreground flex items-center gap-2 px-1 text-[11px] font-semibold tracking-[0.08em] uppercase'>
          <Server className='h-3.5 w-3.5' />
          Fleet &amp; Diagnostics
        </div>
        <div className='grid gap-3 lg:grid-cols-2'>
          <AgentsFleetCard defaultOpen />
          <AgentHealthCard
            agentConnected={agentDetection.available}
            defaultOpen={false}
          />
        </div>
        <RecentJobsCard limit={50} defaultOpen />
      </div>

      {/* ─── Body: triggers list + recent fires panel ─── */}
      <Card className='gap-0 overflow-hidden p-0 shadow-sm'>
        <div className='divide-border grid divide-y lg:grid-cols-5 lg:divide-x lg:divide-y-0'>
          <div className='flex min-h-0 flex-col lg:col-span-3'>
            <div className='flex items-center justify-between gap-2 border-b px-4 py-3'>
              <div className='text-muted-foreground flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] uppercase'>
                <Zap className='h-3.5 w-3.5' />
                Triggers
                <Badge
                  variant='secondary'
                  className='ml-1 font-mono text-[10px] font-normal'
                >
                  {triggers.length}
                </Badge>
              </div>
              <Button
                size='sm'
                variant='outline'
                className='h-7'
                onClick={() => setCreating(true)}
              >
                <Plus className='mr-1.5 h-3.5 w-3.5' />
                Add
              </Button>
            </div>
            <div className='min-h-0 flex-1 overflow-y-auto px-4 py-3'>
              {loading ? (
                <div className='text-muted-foreground flex items-center gap-2 text-sm'>
                  <Loader2 className='h-3.5 w-3.5 animate-spin' /> Loading
                  triggers…
                </div>
              ) : triggers.length === 0 ? (
                <EmptyTriggersCard
                  onPickTemplate={setPendingTemplate}
                  onAddCustom={() => setCreating(true)}
                />
              ) : (
                <div className='space-y-2'>
                  {triggers.map((row) => (
                    <TriggerCard
                      key={row.id}
                      row={row}
                      fleetCapabilities={fleetCapabilities}
                      onToggle={() => void onToggle(row)}
                      onEdit={() => setEditing(row)}
                      onDelete={() => void onDelete(row)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className='flex min-h-0 flex-col lg:col-span-2'>
            <div className='flex items-center justify-between gap-2 border-b px-4 py-3'>
              <div className='text-muted-foreground flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] uppercase'>
                <Server className='h-3.5 w-3.5' />
                Recent fires
                <Badge
                  variant='secondary'
                  className='ml-1 font-mono text-[10px] font-normal'
                >
                  {fires.length}
                </Badge>
              </div>
              <Button
                size='sm'
                variant='ghost'
                className='h-7'
                onClick={clearFires}
              >
                Clear
              </Button>
            </div>
            <div className='min-h-0 flex-1 overflow-y-auto px-4 py-3'>
              {fires.length === 0 ? (
                <div className='text-muted-foreground text-xs'>
                  No fires observed yet. The list updates live from{' '}
                  <code className='font-mono'>WsEvent::TriggerFired</code>{' '}
                  events broadcast by{' '}
                  <code className='font-mono'>rust-work-service</code>.
                </div>
              ) : (
                <div className='space-y-2'>
                  {fires.map((entry) => {
                    const trigger = triggers.find(
                      (t) => t.id === entry.trigger_id
                    )
                    return (
                      <FireRow
                        key={entry.id}
                        entry={entry}
                        triggerName={trigger?.name ?? entry.trigger_id}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* ─── SAP Console ──────────────────────────────────────────────
          Audit gap FE-3 (2026-05-07): the SAP Console is mounted in
          BOTH the inventory + agent-triggers tabs (Phase 6 intent) so
          admins can correlate a trigger fire above with the live
          console output the agent emits while servicing the resulting
          `sap_agent_jobs` row. The console buffer is independent from
          the inventory tab's (separate `useSapConsole` storageKey) so
          each tab keeps its own scrollback without overwriting the
          other. */}
      <div className='space-y-2'>
        <div className='text-muted-foreground flex items-center gap-2 px-1 text-[11px] font-semibold tracking-[0.08em] uppercase'>
          <Server className='h-3.5 w-3.5' />
          SAP Console
        </div>
        <SapConsoleCard
          messages={consoleMessages}
          onClear={clearConsole}
          agentFilter={{
            agents: agentDetection.fleet.agents.map((a) => a.id),
            selected: consoleAgentFilter,
            onChange: setConsoleAgentFilter,
          }}
        />
      </div>

      {/* ─── Dialogs ─── */}
      {creating && allowlists && (
        <CreateOrEditDialog
          mode='create'
          open
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false)
              setPendingTemplate(null)
            }
          }}
          allowlists={allowlists}
          fleetCapabilities={fleetCapabilities}
          template={pendingTemplate}
          onSaved={(row) => {
            setTriggers((prev) => [row, ...prev])
            setCreating(false)
            setPendingTemplate(null)
            toast.success('Trigger created', { description: row.name })
          }}
        />
      )}
      {editing && allowlists && (
        <CreateOrEditDialog
          mode='edit'
          open
          existing={editing}
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          allowlists={allowlists}
          fleetCapabilities={fleetCapabilities}
          onSaved={(row) => {
            setTriggers((prev) => prev.map((t) => (t.id === row.id ? row : t)))
            setEditing(null)
            toast.success('Trigger updated', { description: row.name })
          }}
        />
      )}
      {pendingTemplate && !creating && allowlists && (
        // Template picked from the empty-state card → open Create dialog
        // pre-filled with the template body.
        <CreateOrEditDialog
          mode='create'
          open
          onOpenChange={(open) => {
            if (!open) setPendingTemplate(null)
          }}
          allowlists={allowlists}
          fleetCapabilities={fleetCapabilities}
          template={pendingTemplate}
          onSaved={(row) => {
            setTriggers((prev) => [row, ...prev])
            setPendingTemplate(null)
            toast.success('Trigger created', { description: row.name })
          }}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function KpiBadge({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  tone?: 'active'
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2 py-1',
        tone === 'active' &&
          'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
      )}
    >
      <Icon className='h-3 w-3' />
      <span className='text-muted-foreground text-[10px] font-semibold tracking-wide uppercase'>
        {label}
      </span>
      <span className='text-foreground font-mono text-xs font-semibold tabular-nums'>
        {value}
      </span>
    </div>
  )
}

function EmptyTriggersCard({
  onPickTemplate,
  onAddCustom,
}: {
  onPickTemplate: (tpl: TriggerTemplate) => void
  onAddCustom: () => void
}) {
  return (
    <Card className='border-dashed'>
      <CardContent className='space-y-4 py-8'>
        <div className='flex flex-col items-center gap-2 text-center'>
          <ZapOff className='text-muted-foreground h-8 w-8' />
          <div className='font-medium'>No triggers configured</div>
          <div className='text-muted-foreground max-w-md text-sm'>
            Pick a starter template below to land a common pattern with one
            click, or build a custom rule from scratch. Triggers are evaluated
            server-side; admins do not need an agent installed locally.
          </div>
        </div>
        <div className='space-y-2'>
          <Label className='text-muted-foreground text-[10px] font-semibold tracking-wide uppercase'>
            Starter templates
          </Label>
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.name}
              onClick={() => onPickTemplate(tpl)}
              className='hover:bg-accent block w-full rounded-md border p-3 text-left transition-colors'
            >
              <div className='flex items-start gap-3'>
                <Zap className='mt-0.5 h-4 w-4 shrink-0 text-blue-500' />
                <div className='min-w-0 flex-1'>
                  <div className='text-sm font-medium'>{tpl.name}</div>
                  <div className='text-muted-foreground mt-0.5 line-clamp-2 text-xs'>
                    {tpl.description}
                  </div>
                  <div className='mt-1 flex flex-wrap gap-1.5'>
                    <Badge
                      variant='secondary'
                      className='font-mono text-[10px]'
                    >
                      {tpl.source_table}
                    </Badge>
                    <Badge
                      variant='secondary'
                      className='font-mono text-[10px]'
                    >
                      {tpl.source_events.join('/')}
                    </Badge>
                    <Badge
                      variant='secondary'
                      className='font-mono text-[10px]'
                    >
                      → {tpl.target_endpoint}
                    </Badge>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
        <div className='flex justify-center'>
          <Button variant='outline' size='sm' onClick={onAddCustom}>
            <Plus className='mr-2 h-4 w-4' />
            Or build a custom trigger
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function TriggerCard({
  row,
  fleetCapabilities,
  onToggle,
  onEdit,
  onDelete,
}: {
  row: TriggerRow
  fleetCapabilities: Record<string, string[]>
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const endpointWarning = useMemo(() => {
    const allCaps = Object.values(fleetCapabilities).flat()
    if (allCaps.length === 0) {
      return 'No agents currently online — fired jobs will queue until an agent connects.'
    }
    // Endpoint capability convention: `agent-side-endpoint:<route>` or
    // the bare route as a capability id. We accept either signal.
    const routeId = row.target_endpoint
    const matches = allCaps.some(
      (c) => c === routeId || c === `agent-side-endpoint:${routeId}`
    )
    if (!matches) {
      // Soft warning — many handlers are unconditionally available
      // on every agent build (e.g. `/sap/confirm-to`, `/sap/lt12`),
      // so an absent capability ≠ definitely-broken. Surface it as
      // an info pill rather than an error.
      return undefined
    }
    return undefined
  }, [fleetCapabilities, row.target_endpoint])

  return (
    <Card
      className={cn(
        'group border-l-2 transition-all hover:shadow-md',
        row.enabled ? 'border-l-emerald-500/70' : 'border-l-zinc-400/50'
      )}
    >
      <CardContent className='space-y-2 px-3 py-2.5'>
        <div className='flex items-start gap-2'>
          {row.enabled ? (
            <ShieldCheck className='mt-0.5 h-3.5 w-3.5 text-emerald-500' />
          ) : (
            <ZapOff className='text-muted-foreground mt-0.5 h-3.5 w-3.5' />
          )}
          <div className='min-w-0 flex-1'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='truncate text-sm font-semibold'>{row.name}</span>
              <Badge
                variant='outline'
                className={cn(
                  'font-mono text-[10px]',
                  row.enabled
                    ? 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
                    : 'border-muted-foreground/30 text-muted-foreground'
                )}
              >
                {row.enabled ? 'enabled' : 'disabled'}
              </Badge>
            </div>
            {row.description && (
              <div className='text-muted-foreground mt-0.5 line-clamp-2 text-xs'>
                {row.description}
              </div>
            )}
          </div>
          <div className='flex shrink-0 items-center gap-0.5'>
            <Switch
              checked={row.enabled}
              onCheckedChange={onToggle}
              className='scale-90'
            />
            <Button
              size='sm'
              variant='ghost'
              className='h-7 w-7 p-0'
              onClick={onEdit}
              title='Edit trigger'
            >
              <Info className='h-3.5 w-3.5' />
            </Button>
            <Button
              size='sm'
              variant='ghost'
              className='text-muted-foreground h-7 w-7 p-0 hover:text-red-600'
              onClick={onDelete}
              title='Delete trigger'
            >
              <Trash2 className='h-3.5 w-3.5' />
            </Button>
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-1.5 pl-5'>
          <Chip icon={Database} label='source'>
            {row.source_table} · {row.source_events.join('/')}
          </Chip>
          <Chip icon={Zap} label='action'>
            {row.target_endpoint}
          </Chip>
        </div>
        {endpointWarning && (
          <div className='text-muted-foreground flex items-start gap-1.5 pl-5 text-[11px]'>
            <AlertCircle className='mt-0.5 h-3 w-3 text-amber-500' />
            <span>{endpointWarning}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function FireRow({
  entry,
  triggerName,
}: {
  entry: { timestamp: string; target_endpoint: string; source_row_id: string }
  triggerName: string
}) {
  return (
    <div className='hover:bg-accent/30 rounded-md border px-2 py-1.5 transition-colors'>
      <div className='flex items-center gap-2'>
        <Zap className='h-3 w-3 shrink-0 text-emerald-500' />
        <span className='truncate text-xs font-medium'>{triggerName}</span>
        <Badge variant='secondary' className='font-mono text-[10px]'>
          {entry.target_endpoint}
        </Badge>
      </div>
      <div className='text-muted-foreground mt-0.5 flex items-center gap-1.5 pl-5 text-[10px]'>
        <Clock className='h-2.5 w-2.5' />
        <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
        <span>·</span>
        <code className='font-mono'>row {entry.source_row_id.slice(0, 8)}</code>
      </div>
    </div>
  )
}

function Chip({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <span
      className='bg-muted/60 inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]'
      title={`${label}: ${typeof children === 'string' ? children : ''}`}
    >
      <Icon className='text-muted-foreground h-2.5 w-2.5 shrink-0' />
      <span className='text-muted-foreground'>{label}</span>
      <span className='text-foreground truncate'>{children}</span>
    </span>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Create / Edit dialog — JSON-text form (Phase 9 ships form-based; a
// future visual filter builder is deferred to Phase 11).
// ──────────────────────────────────────────────────────────────────────

interface CreateOrEditDialogProps {
  mode: 'create' | 'edit'
  open: boolean
  onOpenChange: (open: boolean) => void
  allowlists: AllowlistsResponse
  fleetCapabilities: Record<string, string[]>
  template?: TriggerTemplate | null
  existing?: TriggerRow
  onSaved: (row: TriggerRow) => void
}

function CreateOrEditDialog(props: CreateOrEditDialogProps) {
  const { mode, open, onOpenChange, allowlists, template, existing, onSaved } =
    props

  const initial = useMemo(() => {
    if (mode === 'edit' && existing) {
      return {
        name: existing.name,
        description: existing.description ?? '',
        enabled: existing.enabled,
        source_table: existing.source_table,
        source_events: existing.source_events,
        match_filter_json: JSON.stringify(existing.match_filter, null, 2),
        target_endpoint: existing.target_endpoint,
        payload_template_json: JSON.stringify(
          existing.payload_template,
          null,
          2
        ),
        post_success_patch_json: existing.post_success_patch
          ? JSON.stringify(existing.post_success_patch, null, 2)
          : '',
      }
    }
    if (template) {
      return {
        name: template.name,
        description: template.description,
        enabled: false,
        source_table: template.source_table,
        source_events: template.source_events,
        match_filter_json: JSON.stringify(template.match_filter, null, 2),
        target_endpoint: template.target_endpoint,
        payload_template_json: JSON.stringify(
          template.payload_template,
          null,
          2
        ),
        post_success_patch_json: template.post_success_patch
          ? JSON.stringify(template.post_success_patch, null, 2)
          : '',
      }
    }
    return {
      name: '',
      description: '',
      enabled: false,
      source_table: allowlists.source_tables[0] ?? '',
      source_events: ['INSERT'] as string[],
      match_filter_json: '{}',
      target_endpoint: allowlists.target_endpoints[0] ?? '',
      payload_template_json: '{}',
      post_success_patch_json: '',
    }
  }, [mode, existing, template, allowlists])

  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [enabled, setEnabled] = useState(initial.enabled)
  const [sourceTable, setSourceTable] = useState(initial.source_table)
  const [sourceEvents, setSourceEvents] = useState<string[]>(
    initial.source_events
  )
  const [matchFilterJson, setMatchFilterJson] = useState(
    initial.match_filter_json
  )
  const [targetEndpoint, setTargetEndpoint] = useState(initial.target_endpoint)
  const [payloadJson, setPayloadJson] = useState(initial.payload_template_json)
  const [postPatchJson, setPostPatchJson] = useState(
    initial.post_success_patch_json
  )

  const [saving, setSaving] = useState(false)
  const [previewRowJson, setPreviewRowJson] = useState('{}')
  const [previewState, setPreviewState] = useState<{
    matched: boolean
    error?: { pointer: string; message: string }
  } | null>(null)

  const toggleEvent = useCallback((evt: string) => {
    setSourceEvents((prev) =>
      prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]
    )
  }, [])

  const onPreview = useCallback(async () => {
    let filter: Record<string, unknown>
    let row: Record<string, unknown>
    try {
      filter = JSON.parse(matchFilterJson)
    } catch (e) {
      setPreviewState({
        matched: false,
        error: {
          pointer: '/match_filter',
          message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
        },
      })
      return
    }
    try {
      row = JSON.parse(previewRowJson)
    } catch (e) {
      setPreviewState({
        matched: false,
        error: {
          pointer: '/row',
          message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
        },
      })
      return
    }
    try {
      const resp = await previewMatch({ match_filter: filter, row })
      setPreviewState(resp)
    } catch (e) {
      setPreviewState({
        matched: false,
        error: {
          pointer: '/',
          message: e instanceof Error ? e.message : String(e),
        },
      })
    }
  }, [matchFilterJson, previewRowJson])

  const onSave = useCallback(async () => {
    setSaving(true)
    try {
      let matchFilter: Record<string, unknown>
      try {
        matchFilter = JSON.parse(matchFilterJson)
      } catch (e) {
        toast.error('match_filter is not valid JSON', {
          description: e instanceof Error ? e.message : String(e),
        })
        return
      }
      let payloadTemplate: Record<string, unknown>
      try {
        payloadTemplate = JSON.parse(payloadJson)
      } catch (e) {
        toast.error('payload_template is not valid JSON', {
          description: e instanceof Error ? e.message : String(e),
        })
        return
      }
      let postSuccessPatch: Record<string, unknown> | undefined = undefined
      if (postPatchJson.trim().length > 0) {
        try {
          postSuccessPatch = JSON.parse(postPatchJson)
        } catch (e) {
          toast.error('post_success_patch is not valid JSON', {
            description: e instanceof Error ? e.message : String(e),
          })
          return
        }
      }
      const body: CreateTriggerRequest = {
        name: name.trim(),
        description: description.trim() || undefined,
        enabled,
        source_table: sourceTable,
        source_events: sourceEvents,
        match_filter: matchFilter,
        target_endpoint: targetEndpoint,
        payload_template: payloadTemplate,
        post_success_patch: postSuccessPatch,
      }
      const row =
        mode === 'edit' && existing
          ? await updateTrigger(existing.id, body)
          : await createTrigger(body)
      onSaved(row)
    } catch (e) {
      toast.error(mode === 'edit' ? 'Update failed' : 'Create failed', {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setSaving(false)
    }
  }, [
    mode,
    existing,
    name,
    description,
    enabled,
    sourceTable,
    sourceEvents,
    matchFilterJson,
    targetEndpoint,
    payloadJson,
    postPatchJson,
    onSaved,
  ])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-3xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit' ? 'Edit Trigger' : 'New Trigger'}
          </DialogTitle>
          <DialogDescription>
            Triggers are evaluated server-side. Filter syntax is the v1 DSL (
            {allowlists.grammar_version}); see{' '}
            <code className='font-mono'>ADR-Trigger-DSL-Evaluator-Phase9</code>.
            Use the preview pane below to dry-run your filter before saving.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-2'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor='trig-name'>Name</Label>
              <Input
                id='trig-name'
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className='flex items-center gap-2 sm:justify-end'>
              <Label htmlFor='trig-enabled' className='text-sm'>
                Enabled
              </Label>
              <Switch
                id='trig-enabled'
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='trig-desc'>Description</Label>
            <Textarea
              id='trig-desc'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor='trig-source'>Source table</Label>
              <select
                id='trig-source'
                className='border-input bg-background w-full rounded-md border px-3 py-2 text-sm'
                value={sourceTable}
                onChange={(e) => setSourceTable(e.target.value)}
              >
                {allowlists.source_tables.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='trig-target'>Target endpoint</Label>
              <select
                id='trig-target'
                className='border-input bg-background w-full rounded-md border px-3 py-2 text-sm'
                value={targetEndpoint}
                onChange={(e) => setTargetEndpoint(e.target.value)}
              >
                {allowlists.target_endpoints.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className='space-y-1.5'>
            <Label>Source events</Label>
            <div className='flex gap-2'>
              {allowlists.source_events.map((evt) => (
                <Button
                  key={evt}
                  type='button'
                  size='sm'
                  variant={sourceEvents.includes(evt) ? 'default' : 'outline'}
                  onClick={() => toggleEvent(evt)}
                >
                  {evt}
                </Button>
              ))}
            </div>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='trig-filter'>match_filter (DSL JSON)</Label>
            <Textarea
              id='trig-filter'
              value={matchFilterJson}
              onChange={(e) => setMatchFilterJson(e.target.value)}
              rows={6}
              className='font-mono text-xs'
            />
            <p className='text-muted-foreground text-[11px]'>
              Empty <code className='font-mono'>{'{}'}</code> means "always
              match". Use <code className='font-mono'>{'{ all: [...] }'}</code>,{' '}
              <code className='font-mono'>{'{ any: [...] }'}</code>,{' '}
              <code className='font-mono'>{'{ eq: { field, value } }'}</code>,{' '}
              <code className='font-mono'>is_null</code>, etc.
            </p>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='trig-payload'>payload_template (JSON)</Label>
            <Textarea
              id='trig-payload'
              value={payloadJson}
              onChange={(e) => setPayloadJson(e.target.value)}
              rows={5}
              className='font-mono text-xs'
            />
            <p className='text-muted-foreground text-[11px]'>
              Use <code className='font-mono'>{'"{{row.field}}"'}</code> to
              interpolate values from the source row.
            </p>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='trig-postpatch'>
              post_success_patch (JSON, optional)
            </Label>
            <Textarea
              id='trig-postpatch'
              value={postPatchJson}
              onChange={(e) => setPostPatchJson(e.target.value)}
              rows={4}
              className='font-mono text-xs'
              placeholder='Leave blank for no post-success patch'
            />
          </div>

          <div className='space-y-2 rounded-md border p-3'>
            <div className='flex items-center gap-2'>
              <FlaskConical className='h-4 w-4' />
              <div className='text-sm font-semibold'>Match preview</div>
            </div>
            <Textarea
              value={previewRowJson}
              onChange={(e) => setPreviewRowJson(e.target.value)}
              rows={4}
              className='font-mono text-xs'
              placeholder='Paste a sample row JSON here'
            />
            <div className='flex items-center justify-between gap-2'>
              <Button
                size='sm'
                variant='outline'
                onClick={() => void onPreview()}
              >
                Run preview
              </Button>
              {previewState && <PreviewBadge state={previewState} />}
            </div>
            {previewState?.error && (
              <div className='text-xs text-red-600 dark:text-red-400'>
                {previewState.error.message}
                <span className='text-muted-foreground ml-2 font-mono text-[10px]'>
                  ({previewState.error.pointer})
                </span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className='gap-2'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void onSave()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' /> Saving…
              </>
            ) : (
              <>
                <CheckCircle2 className='mr-2 h-4 w-4' />
                {mode === 'edit' ? 'Save changes' : 'Create trigger'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PreviewBadge({
  state,
}: {
  state: { matched: boolean; error?: { pointer: string; message: string } }
}) {
  if (state.error) {
    return (
      <Badge
        variant='outline'
        className='border-red-500/50 text-red-600 dark:text-red-400'
      >
        <AlertCircle className='mr-1 h-3 w-3' />
        Filter rejected
      </Badge>
    )
  }
  return state.matched ? (
    <Badge
      variant='outline'
      className='border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
    >
      <CheckCircle2 className='mr-1 h-3 w-3' />
      Matches
    </Badge>
  ) : (
    <Badge
      variant='outline'
      className='border-muted-foreground/30 text-muted-foreground'
    >
      Does not match
    </Badge>
  )
}

// Created and developed by Jai Singh
