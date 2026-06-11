// Created and developed by Jai Singh
/**
 * Live Operator Status Panel
 * Real-time display of active operators and their current status
 * Part of Phase 6: Work Management System Redesign
 *
 * 2026-05-07 — extended with the "In Building" tab (the Option-2
 * union of presence-tracked users that are NOT currently checked in
 * to the work engine). Tab 1 ("On Counts") stays as-is — same data
 * source (`useActiveWorkers()` against `worker_heartbeats`), same
 * card layout. Tab 2 ("In Building") consumes `usePresence()` and
 * renders compact cards for users present in the org but absent
 * from the work-heartbeats table.
 *
 * 2026-05-09 — operator cards on Tab 1 ("On Counts") are now
 * click-to-open. Clicking an `<OperatorCard>` opens
 * `<OperatorTaskQueueDialog>` scoped to that operator (drag-to-
 * reorder list of the next ~12 cycle-count tasks, same surface that
 * previously lived as a third "Up Next" peer tab). Tab 2
 * ("In Building") cards are NOT clickable — those users aren't on
 * counts so the queue would always be empty. The supervisor's
 * mental model is "click a card to drill into that operator", so
 * presence-only users would just frustrate the click affordance.
 * See `Implementations/Implement-Operator-Cycle-Count-Queue-Tab`.
 *
 * Privacy contract is unchanged: the panel still mounts only inside
 * the Inventory Counts tab, which is RBAC-gated by
 * `view inventory_apps`. Tab 2 inherits the same gate (no new
 * permission key). See
 * `memorybank/OmniFrame/Decisions/ADR-Scoped-CurrentPage-In-ActiveOperators.md`.
 */
import { useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  Activity,
  Bell,
  Boxes,
  CircleDot,
  Clock,
  Coffee,
  Cog,
  Compass,
  Headset,
  ListTodo,
  MapPin,
  Package,
  Pause,
  Radar,
  RefreshCw,
  Scan,
  Settings,
  ShieldCheck,
  Smartphone,
  Truck,
  Users,
  Warehouse,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'
import { resolveFeature } from '@/lib/presence'
import {
  PRESENCE_STATUS_CONFIG,
  type PresenceRfActivity,
  type PresenceStatus,
  type PresenceUser,
} from '@/lib/presence/types'
import { cn } from '@/lib/utils'
import type { WorkerStatus, WorkerStatusType } from '@/lib/work-service/types'
import { usePresenceOptional } from '@/context/presence-context'
import { useActiveWorkers } from '@/hooks/use-active-workers'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatTile, type StatTileAccent } from '@/components/ui/stat-tile'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { OperatorTaskQueueDialog } from '@/components/operator-task-queue'
import { PresenceAvatar } from '@/components/presence/presence-avatar'

const STATUS_THEME: Record<
  WorkerStatusType,
  {
    label: string
    dot: string
    text: string
    chipBg: string
    chipText: string
    ring: string
    cardBorder: string
    cardBg: string
  }
> = {
  busy: {
    label: 'Busy',
    dot: 'bg-orange-500',
    text: 'text-orange-600 dark:text-orange-400',
    chipBg: 'bg-orange-500/15 dark:bg-orange-500/10',
    chipText: 'text-orange-700 dark:text-orange-400',
    ring: 'ring-orange-500/30 dark:ring-orange-500/20',
    cardBorder: 'border-orange-500/25 dark:border-orange-500/20',
    cardBg: 'bg-orange-500/[0.04] dark:bg-orange-500/[0.06]',
  },
  online: {
    label: 'Online',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    chipBg: 'bg-emerald-500/15 dark:bg-emerald-500/10',
    chipText: 'text-emerald-700 dark:text-emerald-400',
    ring: 'ring-emerald-500/30 dark:ring-emerald-500/20',
    cardBorder: 'border-emerald-500/25 dark:border-emerald-500/20',
    cardBg: 'bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06]',
  },
  idle: {
    label: 'Idle',
    dot: 'bg-sky-500',
    text: 'text-sky-600 dark:text-sky-400',
    chipBg: 'bg-sky-500/15 dark:bg-sky-500/10',
    chipText: 'text-sky-700 dark:text-sky-400',
    ring: 'ring-sky-500/30 dark:ring-sky-500/20',
    cardBorder: 'border-sky-500/25 dark:border-sky-500/20',
    cardBg: 'bg-sky-500/[0.04] dark:bg-sky-500/[0.06]',
  },
  break: {
    label: 'Break',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    chipBg: 'bg-amber-500/15 dark:bg-amber-500/10',
    chipText: 'text-amber-700 dark:text-amber-400',
    ring: 'ring-amber-500/30 dark:ring-amber-500/20',
    cardBorder: 'border-amber-500/25 dark:border-amber-500/20',
    cardBg: 'bg-amber-500/[0.04] dark:bg-amber-500/[0.06]',
  },
  offline: {
    label: 'Offline',
    dot: 'bg-slate-400',
    text: 'text-slate-500 dark:text-slate-400',
    chipBg: 'bg-slate-500/10 dark:bg-slate-400/10',
    chipText: 'text-slate-600 dark:text-slate-400',
    ring: 'ring-slate-500/20 dark:ring-slate-400/20',
    cardBorder: 'border-border/50',
    cardBg: 'bg-card/50',
  },
}

/**
 * Theme palette for presence-status tiles + cards on Tab 2
 * ("In Building"). Mirrors the shape of `STATUS_THEME` so the
 * tile/card components can swap which theme they're driven by
 * without forking layout. Colours are pulled from the same green /
 * yellow / red / gray family as `PRESENCE_STATUS_CONFIG` —
 * deliberately distinct from the work-engine palette so a
 * supervisor flipping tabs sees the colour shift and registers the
 * semantic shift.
 */
type PresenceBucket = 'online' | 'away' | 'busy' | 'offline'

const PRESENCE_THEME: Record<
  PresenceBucket,
  {
    label: string
    dot: string
    text: string
    chipBg: string
    chipText: string
    cardBorder: string
    cardBg: string
  }
> = {
  online: {
    label: 'Available',
    dot: 'bg-green-500',
    text: 'text-green-600 dark:text-green-400',
    chipBg: 'bg-green-500/15 dark:bg-green-500/10',
    chipText: 'text-green-700 dark:text-green-400',
    cardBorder: 'border-green-500/25 dark:border-green-500/20',
    cardBg: 'bg-green-500/[0.04] dark:bg-green-500/[0.06]',
  },
  away: {
    label: 'Away',
    dot: 'bg-yellow-500',
    text: 'text-yellow-600 dark:text-yellow-400',
    chipBg: 'bg-yellow-500/15 dark:bg-yellow-500/10',
    chipText: 'text-yellow-700 dark:text-yellow-400',
    cardBorder: 'border-yellow-500/25 dark:border-yellow-500/20',
    cardBg: 'bg-yellow-500/[0.04] dark:bg-yellow-500/[0.06]',
  },
  busy: {
    label: 'Busy',
    dot: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
    chipBg: 'bg-red-500/15 dark:bg-red-500/10',
    chipText: 'text-red-700 dark:text-red-400',
    cardBorder: 'border-red-500/25 dark:border-red-500/20',
    cardBg: 'bg-red-500/[0.04] dark:bg-red-500/[0.06]',
  },
  offline: {
    label: 'Offline',
    dot: 'bg-gray-400',
    text: 'text-gray-500 dark:text-gray-400',
    chipBg: 'bg-gray-500/10 dark:bg-gray-400/10',
    chipText: 'text-gray-600 dark:text-gray-400',
    cardBorder: 'border-border/50',
    cardBg: 'bg-card/50',
  },
}

/**
 * Map a `PresenceStatus` to one of the four buckets `PRESENCE_THEME`
 * supports. Folds `do_not_disturb` into `busy` (same red palette,
 * same UX cue — "don't bother this person") so the count strip
 * stays visually coherent at four tiles.
 */
function bucketForPresenceStatus(status: PresenceStatus): PresenceBucket {
  if (status === 'do_not_disturb') return 'busy'
  if (status === 'busy') return 'busy'
  if (status === 'away') return 'away'
  if (status === 'offline') return 'offline'
  return 'online'
}

const getInitials = (name: string | null | undefined): string => {
  if (!name) return '··'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
  }
  return name.substring(0, 2).toUpperCase()
}

/**
 * Map a string icon name (from `route-features.ts`) to a concrete
 * Lucide component. We deliberately import only a small "warehouse-
 * relevant" subset (the panel's primary user is a supervisor watching
 * shop-floor operators on RF / inventory / outbound apps) and resolve
 * everything else to `Compass`. This keeps the bundle delta tiny —
 * importing the full set of ~40 icons referenced by `route-features.ts`
 * pulled an extra ~40 KB into this chunk for affordances supervisors
 * would rarely see in this surface.
 *
 * Adding more icons is fine if a real warehouse use-case appears (e.g.
 * if RF starts showing "Quality Inspections"); just import the lucide
 * icon and add an entry here. Keeping `route-features.ts` dependency-
 * free (just strings) lets us extend the catalogue cheaply without
 * pulling icon code into every consumer.
 */
const FEATURE_ICONS: Record<string, LucideIcon> = {
  Activity,
  Boxes,
  Clock,
  Cog,
  Compass,
  Headset,
  ListTodo,
  Package,
  Settings,
  ShieldCheck,
  Smartphone,
  Truck,
  // Aliases used in `route-features.ts` so we don't have to keep the
  // string names lockstep with installed lucide-react names.
  TruckIcon: Truck,
  Users,
  Warehouse,
}

function resolveIcon(name: string | undefined): LucideIcon {
  if (!name) return Compass
  return FEATURE_ICONS[name] ?? Compass
}

// ---- RF activity rendering ------------------------------------------
//
// Privacy contract: `rf_activity` rides the same single-consumer
// gate as `current_page` (this file, scoped to the Inventory Counts
// tab via `view inventory_apps`). Do NOT render `rf_activity` from
// `<OnlineUsersPanel>`, `<StatusSelector>`, or `<PresenceAvatar>`.
// See `memorybank/OmniFrame/Decisions/ADR-RF-Activity-Telemetry.md`.

/**
 * Humanise a `current_step` snake_case label. Falls back to a
 * generic title-case of the raw string for unmapped values so a
 * future RF screen lights up immediately rather than silently.
 */
const STEP_LABELS: Record<string, string> = {
  rf_home: 'RF Home',
  rf_scanning: 'Scanning',
  rf_inventory: 'RF Inventory',
  rf_locations: 'RF Locations',
  rf_profile: 'RF Profile',
  putaway: 'Put-Away',
  picking: 'Picking',
  kitting_apps: 'Kitting Apps',
  kitting_picking: 'Kitting: Picking',
  build_kit: 'Build Kit',
  inspect_kit: 'Inspect Kit',
  cycle_count: 'Cycle Count',
  grs_cycle_count: 'GRS Cycle Count',
  grs_core_pulls: 'GRS Core Pulls',
  // Match the RF UI's button label exactly ("Inbound Part Transfer", not
  // "Inbound Transfer"). 2026-05-07 PM debug: supervisor reading the panel
  // expected the sub-row label to mirror what the operator sees on their
  // RF screen — see Debug/Fix-RF-Activity-Step-Source-Confusion.
  inbound_part_transfer: 'Inbound Part Transfer',
  my_productivity: 'My Productivity',
  work_queue: 'Work Queue',
  claim_tasks: 'Claim Tasks',
  sap_migo: 'SAP MIGO',
  // Future per-form sub-step labels (not emitted today; here so
  // when a form learns to push e.g. `'scanning_material'` directly
  // the panel humanises it correctly without a code change in this
  // file).
  scanning_material: 'Scanning Material',
  scanning_location: 'Scanning Location',
  scanning_bin: 'Scanning Bin',
  confirming_count: 'Confirming Count',
  reviewing_variance: 'Reviewing Variance',
  capturing_photo: 'Capturing Photo',
  capturing_serial: 'Capturing Serial',
  signing_off: 'Signing Off',
}

function humaniseStep(step: string | null | undefined): string | null {
  if (!step) return null
  if (STEP_LABELS[step]) return STEP_LABELS[step]
  // Fallback: title-case the underscores. Avoids the supervisor
  // seeing a raw `unmapped_step_name` while still surfacing it.
  return step
    .split('_')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

/**
 * Rolling-clock state describing how recently the operator
 * touched their RF tab. The UI uses this to render an active
 * pulse / idle badge / nothing depending on age. Recomputed on a
 * 5s timer so the badge advances even when no presence broadcast
 * lands (the broadcast itself is debounced — visual freshness is
 * cheaper to recompute locally than to re-broadcast).
 */
type ActivityFreshness = 'live' | 'recent' | 'idle' | 'unknown'

function freshnessFromLastInput(
  lastInputAt: string | null | undefined,
  now: number
): { kind: ActivityFreshness; ageSec: number } {
  if (!lastInputAt) return { kind: 'unknown', ageSec: 0 }
  const t = Date.parse(lastInputAt)
  if (Number.isNaN(t)) return { kind: 'unknown', ageSec: 0 }
  const ageSec = Math.max(0, Math.floor((now - t) / 1000))
  if (ageSec < 10) return { kind: 'live', ageSec }
  if (ageSec < 60) return { kind: 'recent', ageSec }
  return { kind: 'idle', ageSec }
}

/**
 * Hook returning a value that ticks every `intervalMs`. Used to
 * keep the relative-age badges fresh without re-rendering the
 * whole panel on every keystroke.
 */
function useNowTicker(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/**
 * Compact "x s ago" / "x m ago" formatter for the idle badge —
 * `formatDistanceToNow` from date-fns adds "about" / "less than"
 * qualifiers which are noisy on a 60px-tall card.
 */
function shortAge(ageSec: number): string {
  if (ageSec < 60) return `${ageSec}s`
  const mins = Math.floor(ageSec / 60)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h`
}

/**
 * Tab 1 ("On Counts") sub-row — renders beneath the existing
 * zone/work-type line on each operator card. Visible only when
 * `rf_activity != null`; collapses to nothing otherwise so
 * non-RF operators keep the existing layout.
 */
function RfActivityRow({ activity }: { activity: PresenceRfActivity }) {
  const now = useNowTicker(5_000)
  const fresh = freshnessFromLastInput(activity.last_input_at, now)
  const stepLabel = humaniseStep(activity.current_step)
  const scan = activity.last_scan

  return (
    <div className='border-border/30 mt-1.5 flex items-center gap-2 border-t pt-1.5 text-[11px]'>
      {/* Live / idle dot */}
      {fresh.kind === 'live' ? (
        <span
          className='relative flex h-2 w-2 shrink-0'
          title='Active right now'
        >
          <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75' />
          <span className='relative inline-flex h-2 w-2 rounded-full bg-emerald-500' />
        </span>
      ) : fresh.kind === 'idle' ? (
        <span
          className='inline-flex h-2 w-2 shrink-0 rounded-full bg-slate-400'
          title='Idle'
        />
      ) : (
        <span className='inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-400' />
      )}

      {/* Step label */}
      {stepLabel ? (
        <span className='text-foreground/90 inline-flex min-w-0 items-center gap-1 truncate font-medium'>
          <Radar className='h-3 w-3 shrink-0 opacity-70' />
          <span className='truncate'>{stepLabel}</span>
        </span>
      ) : null}

      {/* Last scan */}
      {scan ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className='text-muted-foreground inline-flex min-w-0 cursor-help items-center gap-1'>
              <span className='text-muted-foreground/40'>·</span>
              <Scan className='h-3 w-3 shrink-0' />
              <span className='truncate font-mono'>{scan.value}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side='bottom' align='start' className='max-w-[280px]'>
            <div className='space-y-0.5'>
              <div className='font-semibold'>Last scan</div>
              <div className='font-mono text-[11px]'>{scan.value}</div>
              <div className='text-muted-foreground text-[10px]'>
                {scan.type} ·{' '}
                {formatDistanceToNow(new Date(scan.at), { addSuffix: true })}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      ) : null}

      {/* Idle badge */}
      {fresh.kind === 'idle' ? (
        <span className='text-muted-foreground/80 ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-500/10 px-1.5 py-0 text-[10px] font-semibold tracking-wide uppercase dark:bg-slate-400/10'>
          Idle {shortAge(fresh.ageSec)}
        </span>
      ) : null}
    </div>
  )
}

/**
 * Tab 2 ("In Building") inline activity indicator. Compact icon
 * next to the feature label; the tooltip expands to a snapshot
 * matching the Tab 1 sub-row content. Tooltip avoids blowing up
 * Tab 2 card height (those cards are deliberately ~60px).
 */
function RfActivityIndicator({ activity }: { activity: PresenceRfActivity }) {
  const now = useNowTicker(5_000)
  const fresh = freshnessFromLastInput(activity.last_input_at, now)
  const stepLabel = humaniseStep(activity.current_step)
  const scan = activity.last_scan

  const indicatorClass =
    fresh.kind === 'live'
      ? 'text-emerald-500'
      : fresh.kind === 'idle'
        ? 'text-slate-400'
        : 'text-amber-500'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex shrink-0 cursor-help items-center',
            indicatorClass
          )}
          aria-label='RF activity'
        >
          <Radar className='h-3 w-3' />
        </span>
      </TooltipTrigger>
      <TooltipContent side='bottom' align='start' className='max-w-[280px]'>
        <div className='space-y-1'>
          <div className='flex items-center gap-1.5 text-[11px] font-semibold'>
            {fresh.kind === 'live' ? (
              <span className='inline-flex h-2 w-2 rounded-full bg-emerald-400' />
            ) : fresh.kind === 'idle' ? (
              <span className='inline-flex h-2 w-2 rounded-full bg-slate-400' />
            ) : (
              <span className='inline-flex h-2 w-2 rounded-full bg-amber-400' />
            )}
            RF Activity
          </div>
          {stepLabel ? (
            <div className='text-[11px]'>
              <span className='text-muted-foreground'>Step: </span>
              <span className='font-medium'>{stepLabel}</span>
            </div>
          ) : null}
          {scan ? (
            <div className='text-[11px]'>
              <span className='text-muted-foreground'>Last scan: </span>
              <span className='font-mono'>{scan.value}</span>
              <span className='text-muted-foreground/70'>
                {' '}
                ({formatDistanceToNow(new Date(scan.at), { addSuffix: true })})
              </span>
            </div>
          ) : null}
          {activity.work_zone ? (
            <div className='text-[11px]'>
              <span className='text-muted-foreground'>Zone: </span>
              <span className='font-mono'>{activity.work_zone}</span>
            </div>
          ) : null}
          {fresh.kind === 'idle' ? (
            <div className='text-muted-foreground text-[10px] italic'>
              Idle {shortAge(fresh.ageSec)}
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

interface OperatorCardProps {
  worker: WorkerStatus
  /**
   * Raw `location.pathname` of the operator's current tab, when
   * available from the presence subsystem. Optional — when `null`
   * (operator not in presence map, presence disabled, or worker has
   * no presence row yet) the card falls back to its pre-existing
   * "task location" affordance.
   *
   * Privacy contract: this prop is ONLY threaded in here from
   * `<LiveOperatorStatus>`, which is mounted inside the Inventory
   * Counts tab (RBAC-gated by `view inventory_apps`). The same
   * `current_page` field is intentionally NOT exposed on the org-wide
   * `<OnlineUsersPanel>` / `<StatusSelector>` / `<PresenceAvatar>`
   * surfaces — see
   * `memorybank/OmniFrame/Decisions/ADR-Scoped-CurrentPage-In-ActiveOperators.md`.
   */
  currentPage?: string | null
  /**
   * Granular RF activity telemetry for the operator (when available
   * via the presence subsystem). Same RBAC scope + same single-
   * consumer contract as `currentPage`. Renders a "live activity"
   * sub-row beneath the existing zone/work-type display when
   * non-null; collapses to nothing otherwise (so non-RF operators
   * keep the existing layout). See
   * `memorybank/OmniFrame/Decisions/ADR-RF-Activity-Telemetry.md`.
   */
  rfActivity?: PresenceRfActivity | null
  /**
   * Click handler — opens the per-operator task queue dialog.
   * Required as of 2026-05-09 (the dialog replaced the previous
   * "Up Next" peer tab). The card is also keyboard-activatable
   * (Enter / Space) and exposes `aria-label="Open queue for ..."`
   * so the affordance is discoverable to screen readers.
   */
  onSelect: () => void
}

function OperatorCard({
  worker,
  currentPage,
  rfActivity,
  onSelect,
}: OperatorCardProps) {
  const theme = STATUS_THEME[worker.status] ?? STATUS_THEME.offline
  const taskLocation = worker.current_location || worker.current_zone || null
  const initials = getInitials(worker.full_name)
  const lastSeen = worker.last_heartbeat
    ? formatDistanceToNow(new Date(worker.last_heartbeat), { addSuffix: true })
    : '—'

  const feature = resolveFeature(currentPage)
  const FeatureIcon = resolveIcon(feature?.icon)

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        // Enter / Space mirror native <button> activation. We
        // explicitly preventDefault on Space so it doesn't scroll
        // the panel beneath the card before the dialog mounts.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      aria-label={`Open queue for ${worker.full_name ?? 'operator'}`}
      className={cn(
        'group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/5 active:translate-y-0 dark:hover:shadow-black/20',
        'focus-visible:ring-ring/60 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        theme.cardBorder,
        theme.cardBg
      )}
    >
      <div className='relative shrink-0'>
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ring-2',
            theme.chipBg,
            theme.chipText,
            theme.ring
          )}
        >
          {initials}
        </div>
        <span
          className={cn(
            'border-background absolute -right-0.5 -bottom-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2',
            theme.dot
          )}
          title={theme.label}
        >
          {worker.status === 'busy' && (
            <span className='absolute inset-0 animate-ping rounded-full bg-orange-400 opacity-60' />
          )}
        </span>
      </div>

      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span className='text-foreground truncate text-sm font-semibold'>
            {worker.full_name || 'Unknown'}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
              theme.chipBg,
              theme.chipText
            )}
          >
            {theme.label}
          </span>
        </div>
        <div className='mt-1 flex items-center gap-2 text-[11px]'>
          {taskLocation ? (
            <span className='text-muted-foreground inline-flex min-w-0 items-center gap-1'>
              <MapPin className='h-3 w-3 shrink-0' />
              <span className='truncate font-mono'>{taskLocation}</span>
            </span>
          ) : (
            <span className='text-muted-foreground/70 inline-flex items-center gap-1 italic'>
              {worker.status === 'idle'
                ? 'Waiting for assignment'
                : worker.status === 'break'
                  ? 'On break'
                  : 'No active task'}
            </span>
          )}
          {worker.current_task_type && (
            <span className='bg-background/70 text-muted-foreground rounded px-1 py-0.5 font-mono text-[10px] font-medium'>
              {worker.current_task_type}
            </span>
          )}
        </div>
        {/* Current screen (scoped re-enablement of `current_page` —
            ADR-Scoped-CurrentPage-In-ActiveOperators). Only renders
            when the presence subsystem has a row for this worker; the
            tooltip exposes the raw pathname for supervisors who need
            to see exactly which sub-route the operator is on. */}
        {feature && (
          <div className='mt-1 flex items-center gap-1.5 text-[11px]'>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className='text-muted-foreground/90 inline-flex min-w-0 cursor-help items-center gap-1'>
                  <FeatureIcon className='h-3 w-3 shrink-0' />
                  <span className='truncate'>
                    on <span className='font-medium'>{feature.label}</span>
                    {feature.sublabel ? (
                      <span className='text-muted-foreground/70'>
                        {' · '}
                        {feature.sublabel}
                      </span>
                    ) : null}
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent
                side='bottom'
                align='start'
                className='max-w-[320px]'
              >
                <div className='space-y-0.5'>
                  <div className='font-semibold'>{feature.label}</div>
                  <div className='font-mono text-[10px] opacity-80'>
                    {feature.raw}
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        )}
        {/* Granular RF activity sub-row (current step / last scan /
            idle indicator). Renders only when the operator's
            presence row carries an `rf_activity` block — i.e. when
            they're an RF operator inside the workflow tree. See
            `ADR-RF-Activity-Telemetry`. */}
        {rfActivity ? <RfActivityRow activity={rfActivity} /> : null}
      </div>

      <div className='text-muted-foreground/80 shrink-0 text-right'>
        <div className='flex items-center justify-end gap-1 text-[11px] tabular-nums'>
          <Clock className='h-3 w-3' />
          {lastSeen}
        </div>
      </div>
    </div>
  )
}

/**
 * Compact card for Tab 2 ("In Building"). Visually lighter than
 * `OperatorCard` because these users are NOT actively running a
 * count — supervisors browsing the tab want a glance at "who else
 * is around", not a full work-status dossier.
 *
 * Layout choices:
 * - Single row, ~60px high (vs the work card's ~80–90px).
 * - Smaller `<PresenceAvatar size="sm">`.
 * - Status badge inline with the name.
 * - Sub-row "in **{feature}**" with the same `resolveFeature()`
 *   resolver as Tab 1, so navigation labels stay consistent.
 * - Hover tooltip on the feature row exposes the raw pathname.
 *
 * Privacy contract identical to `OperatorCard`: this surface is
 * still inside `<LiveOperatorStatus>`, still inside the
 * `view inventory_apps`-gated Inventory Counts tab. No new permission
 * key. The grep contract in
 * `ADR-Scoped-CurrentPage-In-ActiveOperators.md` continues to count
 * `live-operator-status.tsx` as a single consumer file.
 */
function PresenceUserCard({ user }: { user: PresenceUser }) {
  const bucket = bucketForPresenceStatus(user.status)
  const theme = PRESENCE_THEME[bucket]
  const lastSeen = user.last_active_at
    ? formatDistanceToNow(new Date(user.last_active_at), { addSuffix: true })
    : '—'
  const feature = resolveFeature(user.current_page)
  const FeatureIcon = resolveIcon(feature?.icon)
  const rfActivity = user.rf_activity ?? null

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2.5 overflow-hidden rounded-lg border px-2.5 py-1.5 transition-all duration-200 hover:shadow-sm hover:shadow-black/5 dark:hover:shadow-black/20',
        theme.cardBorder,
        theme.cardBg
      )}
    >
      <PresenceAvatar
        src={user.avatar_url}
        fallback={user.initials}
        alt={user.display_name}
        status={user.status}
        size='sm'
        className='shrink-0'
      />

      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1.5'>
          <span className='text-foreground truncate text-xs font-semibold'>
            {user.display_name}
          </span>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0 text-[9px] font-semibold tracking-wide uppercase',
              theme.chipBg,
              theme.chipText
            )}
          >
            {theme.label}
          </span>
        </div>
        <div className='mt-0.5 flex items-center gap-1 text-[10px]'>
          {feature ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className='text-muted-foreground/90 inline-flex min-w-0 cursor-help items-center gap-1'>
                  <FeatureIcon className='h-3 w-3 shrink-0' />
                  <span className='truncate'>
                    in <span className='font-medium'>{feature.label}</span>
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent
                side='bottom'
                align='start'
                className='max-w-[320px]'
              >
                <div className='space-y-0.5'>
                  <div className='font-semibold'>{feature.label}</div>
                  <div className='font-mono text-[10px] opacity-80'>
                    {feature.raw}
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className='text-muted-foreground/60 italic'>
              {PRESENCE_STATUS_CONFIG[user.status].label}
            </span>
          )}
          {/* Inline RF activity indicator. Tooltip-based to keep the
              compact card height unchanged — Tab 2 is deliberately
              ~60px tall. See `ADR-RF-Activity-Telemetry` for the
              full privacy contract. */}
          {rfActivity ? <RfActivityIndicator activity={rfActivity} /> : null}
        </div>
      </div>

      <div className='text-muted-foreground/80 shrink-0 text-right'>
        <div className='flex items-center justify-end gap-1 text-[10px] tabular-nums'>
          <Clock className='h-2.5 w-2.5' />
          {lastSeen}
        </div>
      </div>
    </div>
  )
}

interface SummaryTileProps {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  status: WorkerStatusType
  isActive?: boolean
}

// Worker-engine status → canonical StatTile accent. Mirrors the active
// branch of `STATUS_THEME` above; tiles with `isActive === false` fall
// back to the muted 'default' accent so the colour-coded surface tint
// only fires when there's actual data behind the count.
const STATUS_TO_ACCENT: Record<WorkerStatusType, StatTileAccent> = {
  busy: 'orange',
  online: 'emerald',
  idle: 'sky',
  break: 'amber',
  offline: 'default',
}

function SummaryTile({
  label,
  value,
  icon: Icon,
  status,
  isActive,
}: SummaryTileProps) {
  const accent: StatTileAccent = isActive ? STATUS_TO_ACCENT[status] : 'default'
  return (
    <StatTile
      label={label}
      value={value}
      icon={<Icon />}
      accent={accent}
      className='transition-colors duration-200'
    />
  )
}

interface PresenceSummaryTileProps {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  bucket: PresenceBucket
  isActive?: boolean
}

// Presence-bucket → canonical StatTile accent. The presence palette is
// (green / yellow / red / gray); we map to the closest accent in the
// canonical palette ('emerald' / 'amber' / 'rose' / 'default').
const PRESENCE_TO_ACCENT: Record<PresenceBucket, StatTileAccent> = {
  online: 'emerald',
  away: 'amber',
  busy: 'rose',
  offline: 'default',
}

function PresenceSummaryTile({
  label,
  value,
  icon: Icon,
  bucket,
  isActive,
}: PresenceSummaryTileProps) {
  const accent: StatTileAccent = isActive
    ? PRESENCE_TO_ACCENT[bucket]
    : 'default'
  return (
    <StatTile
      label={label}
      value={value}
      icon={<Icon />}
      accent={accent}
      className='transition-colors duration-200'
    />
  )
}

export function LiveOperatorStatus() {
  const {
    workers,
    isLoading,
    refreshWorkers,
    onlineCount,
    idleCount,
    busyCount,
    breakCount,
    offlineCount,
    isWsConnected,
  } = useActiveWorkers()

  // Cross-reference the worker list with the presence map to pick up
  // each operator's `current_page`. We deliberately keep
  // `useActiveWorkers()` as the source of truth for "who is an
  // operator" (it joins on `worker_heartbeats` and includes
  // task/zone/location context the presence broadcast does not
  // carry); presence is consulted purely for the navigation field.
  //
  // Why `usePresenceOptional()` (not `usePresence()`): this card
  // mounts inside the Inventory Counts tab. If a future caller
  // mounts the same card outside the `<PresenceProvider>` (e.g. a
  // standalone monitoring dashboard) we want it to degrade
  // gracefully — `null` → no current_page → existing rendering path.
  const presence = usePresenceOptional()

  const [activeTab, setActiveTab] = useState<'on-counts' | 'in-building'>(
    'on-counts'
  )

  // The operator currently expanded into the per-operator task-queue
  // dialog. `null` means the dialog is closed. We keep the id (not
  // the worker object) so a worker-list refetch doesn't keep a stale
  // copy alive — the open worker is recomputed from the live workers
  // array on every render. If the open operator drops out of the
  // workers list (offline, prune), the dialog gracefully closes.
  const [openOperatorId, setOpenOperatorId] = useState<string | null>(null)

  const sortedWorkers = useMemo(() => {
    const statusOrder: Record<WorkerStatusType, number> = {
      busy: 0,
      online: 1,
      idle: 2,
      break: 3,
      offline: 4,
    }
    return [...workers].sort(
      (a, b) => (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5)
    )
  }, [workers])

  const activeWorkers = useMemo(
    () => sortedWorkers.filter((w) => w.status !== 'offline'),
    [sortedWorkers]
  )

  // ---- Tab 2 ("In Building") data --------------------------------------
  //
  // Take every presence-tracked user (excluding self — the presence
  // service already drops the current user from `allPresent` at the
  // service layer, see `presence.service.ts:511` and
  // `presence.service.rust.ts:417`) and subtract anyone who is
  // already in the work-heartbeats list. The Set lookup gives us
  // O(1) dedup per presence user; building it once per render is
  // cheap (workers list is small).
  //
  // Dedup rationale: a user appearing in BOTH worker_heartbeats and
  // presence is a work-engine operator who happens to also be on a
  // browser tab. Tab 1 already shows them in full operator card
  // form, so duplicating into Tab 2 would clutter the panel and
  // mislead supervisors about the "non-operator" headcount.
  //
  // Sort: presence statuses ranked online → busy → away → offline,
  // matching the "most relevant first" order Tab 1 already follows
  // (busy is mid-rank rather than top because in the presence world
  // "busy" usually means "in a meeting, leave me alone" — supervisors
  // looking for someone to ping should see Available colleagues first).
  const allPresent = presence?.onlineUsersState.allPresent
  const inBuildingUsers = useMemo<PresenceUser[]>(() => {
    if (!allPresent) return []
    const workerIds = new Set(workers.map((w) => w.user_id))
    const filtered = allPresent.filter((u) => !workerIds.has(u.user_id))
    const presenceOrder: Record<PresenceStatus, number> = {
      online: 0,
      busy: 1,
      do_not_disturb: 2,
      away: 3,
      offline: 4,
    }
    return filtered.sort(
      (a, b) => (presenceOrder[a.status] ?? 5) - (presenceOrder[b.status] ?? 5)
    )
  }, [allPresent, workers])

  const inBuildingCounts = useMemo(() => {
    const c = { online: 0, away: 0, busy: 0, offline: 0 }
    for (const u of inBuildingUsers) {
      c[bucketForPresenceStatus(u.status)] += 1
    }
    return c
  }, [inBuildingUsers])

  const totalActive = onlineCount + busyCount + idleCount

  return (
    <Card className='border-border/50 bg-card/50 overflow-hidden backdrop-blur-sm'>
      <CardHeader className='border-border/40 border-b px-4 py-3'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex items-center gap-3'>
            <div className='ring-border/50 flex h-9 w-9 items-center justify-center rounded-lg bg-linear-to-br from-slate-500/15 to-slate-500/5 ring-1 dark:from-slate-400/15 dark:to-slate-400/5'>
              <Users className='h-4 w-4 text-slate-700 dark:text-slate-300' />
            </div>
            <div className='min-w-0'>
              <CardTitle className='text-foreground text-sm leading-tight font-semibold'>
                Active Operators
              </CardTitle>
              <p className='text-muted-foreground mt-0.5 flex items-center gap-2 text-[11px]'>
                <span className='tabular-nums'>{totalActive} active</span>
                <span className='text-muted-foreground/40'>·</span>
                <span className='tabular-nums'>{workers.length} on counts</span>
                <span className='text-muted-foreground/40'>·</span>
                <span className='tabular-nums'>
                  {inBuildingUsers.length} in building
                </span>
              </p>
            </div>
          </div>

          <div className='flex items-center gap-2'>
            <div
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold tracking-wide uppercase',
                isWsConnected
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
              )}
            >
              {isWsConnected ? (
                <>
                  <span className='relative flex h-1.5 w-1.5'>
                    <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75' />
                    <span className='relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500' />
                  </span>
                  Live
                </>
              ) : (
                <>
                  <WifiOff className='h-2.5 w-2.5' />
                  Polling
                </>
              )}
            </div>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => refreshWorkers()}
              disabled={isLoading}
              className='h-7 w-7 rounded-md p-0'
              title='Refresh operators'
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')}
              />
              <span className='sr-only'>Refresh workers</span>
            </Button>
          </div>
        </div>
      </CardHeader>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'on-counts' | 'in-building')}
        className='gap-0'
      >
        {/* Tab triggers in their own band beneath the header. The band
            stays a fixed height across all tabs so swapping doesn't
            cause a vertical content shift. */}
        <div className='border-border/30 flex items-center justify-between border-b px-4 py-2'>
          <TabsList className='h-8'>
            <TabsTrigger value='on-counts' className='text-xs'>
              On Counts
              <span className='text-muted-foreground/80 ml-1 tabular-nums'>
                · {activeWorkers.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value='in-building' className='text-xs'>
              In Building
              <span className='text-muted-foreground/80 ml-1 tabular-nums'>
                · {inBuildingUsers.length}
              </span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1 — On Counts (existing behaviour) */}
        <TabsContent value='on-counts' className='mt-0'>
          <CardContent className='px-4 py-3'>
            {/* Status summary tiles (work-engine semantics) */}
            <div className='mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-5'>
              <SummaryTile
                label='Busy'
                value={busyCount}
                icon={Activity}
                status='busy'
                isActive={busyCount > 0}
              />
              <SummaryTile
                label='Online'
                value={onlineCount}
                icon={Users}
                status='online'
                isActive={onlineCount > 0}
              />
              <SummaryTile
                label='Idle'
                value={idleCount}
                icon={Pause}
                status='idle'
                isActive={idleCount > 0}
              />
              <SummaryTile
                label='Break'
                value={breakCount}
                icon={Coffee}
                status='break'
                isActive={breakCount > 0}
              />
              <SummaryTile
                label='Offline'
                value={offlineCount}
                icon={WifiOff}
                status='offline'
              />
            </div>

            {activeWorkers.length === 0 ? (
              <div className='border-border/50 bg-muted/20 flex items-center justify-center gap-3 rounded-xl border border-dashed py-8'>
                <div className='bg-muted/60 flex h-10 w-10 items-center justify-center rounded-full'>
                  <Users className='text-muted-foreground/60 h-5 w-5' />
                </div>
                <div>
                  <p className='text-foreground text-sm font-medium'>
                    No active operators
                  </p>
                  <p className='text-muted-foreground text-[11px]'>
                    Operators will appear when they sign in to RF Interface
                  </p>
                </div>
              </div>
            ) : (
              <div className='grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3'>
                {activeWorkers.map((worker) => {
                  const userPresence = presence?.getUserPresence(worker.user_id)
                  return (
                    <OperatorCard
                      key={worker.user_id}
                      worker={worker}
                      currentPage={userPresence?.current_page ?? null}
                      rfActivity={userPresence?.rf_activity ?? null}
                      onSelect={() => setOpenOperatorId(worker.user_id)}
                    />
                  )
                })}
              </div>
            )}
          </CardContent>
        </TabsContent>

        {/* Tab 2 — In Building (new) */}
        <TabsContent value='in-building' className='mt-0'>
          <CardContent className='px-4 py-3'>
            {/* Status summary tiles (presence semantics — Option A,
                per-tab. The strip mirrors PRESENCE_STATUS_CONFIG so a
                supervisor toggling tabs sees the colour palette change
                in lock-step with the data semantics.) */}
            <div className='mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4'>
              <PresenceSummaryTile
                label='Available'
                value={inBuildingCounts.online}
                icon={CircleDot}
                bucket='online'
                isActive={inBuildingCounts.online > 0}
              />
              <PresenceSummaryTile
                label='Away'
                value={inBuildingCounts.away}
                icon={Clock}
                bucket='away'
                isActive={inBuildingCounts.away > 0}
              />
              <PresenceSummaryTile
                label='Busy'
                value={inBuildingCounts.busy}
                icon={Bell}
                bucket='busy'
                isActive={inBuildingCounts.busy > 0}
              />
              <PresenceSummaryTile
                label='Offline'
                value={inBuildingCounts.offline}
                icon={WifiOff}
                bucket='offline'
              />
            </div>

            {inBuildingUsers.length === 0 ? (
              <div className='border-border/50 bg-muted/20 flex items-center justify-center gap-3 rounded-xl border border-dashed py-8'>
                <div className='bg-muted/60 flex h-10 w-10 items-center justify-center rounded-full'>
                  <Users className='text-muted-foreground/60 h-5 w-5' />
                </div>
                <div>
                  <p className='text-foreground text-sm font-medium'>
                    No other users online
                  </p>
                  <p className='text-muted-foreground text-[11px]'>
                    Office users will appear here when they sign in
                  </p>
                </div>
              </div>
            ) : (
              <div className='grid grid-cols-1 gap-1.5 md:grid-cols-2 lg:grid-cols-3'>
                {inBuildingUsers.map((user) => (
                  <PresenceUserCard key={user.user_id} user={user} />
                ))}
              </div>
            )}
          </CardContent>
        </TabsContent>
      </Tabs>

      {/*
        Per-operator task queue dialog. Opened by clicking an
        `<OperatorCard>` on Tab 1 ("On Counts"). The body inside
        (`<OperatorTaskQueueBody>`) mounts only while the dialog is
        open, so the WS subscription registered by
        `useWorkerTasks(..., { enableRealtime: true })` cleans up
        automatically on close (see hook's useEffect cleanup).

        We also auto-close if the open operator drops out of the
        live workers list — a worker going offline + getting pruned
        shouldn't leave a stale dialog open against a vanished id.
      */}
      <OperatorTaskQueueDialog
        worker={workers.find((w) => w.user_id === openOperatorId) ?? null}
        open={
          openOperatorId !== null &&
          workers.some((w) => w.user_id === openOperatorId)
        }
        onOpenChange={(o) => {
          if (!o) setOpenOperatorId(null)
        }}
      />
    </Card>
  )
}

// Created and developed by Jai Singh
