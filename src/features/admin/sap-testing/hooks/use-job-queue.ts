// Created and developed by Jai Singh
import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentOrgId } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import type { WsEvent, WsEventHandler } from '@/lib/work-service'
import { workServiceWs } from '@/lib/work-service/websocket'

/**
 * Phase A1 — useJobQueue
 *
 * Submits a SAP automation job to `sap_agent_jobs` and observes its
 * row's status transitions so the caller can `await`-ish on the
 * `queued → running → completed/failed` lifecycle.
 *
 * Queue mode is opt-in. The browser still drives direct-fire flows by
 * default — the queue is only used when the caller wants:
 *   - Reload-tolerant batches
 *   - Multi-agent fan-out
 *   - Server-side audit linkage (sap_audit_log.job_id)
 *
 * 2026-05-06 — Tier 1 deferred-channel migration. The previous
 * implementation spun up one `supabase.channel('sap-agent-job-{id}')`
 * per submitted job, then tore it down 250ms after terminal status.
 * That per-job channel churn was the wart this migration retires:
 *
 *   - DB:   migration 271 adds `notify_sap_agent_job_changed()` +
 *           `sap_agent_jobs_notify_changed` AFTER trigger.
 *   - Rust: `sap_jobs_listener` consumes `LISTEN sap_agent_job_changed`
 *           and broadcasts `WsEvent::SapJobStatusChanged` via the
 *           existing `WorkServiceWebSocket` per-org fan-out.
 *   - FE:   THIS hook registers ONE handler on the singleton (covering
 *           every in-flight job for the user's org) and filters by
 *           `event.job_id ∈ watchedJobs`. No more channel churn.
 *
 * The 5-min safety-net poll catches the case where a terminal `UPDATE`
 * is missed (Rust WS down, lagged broadcast, etc.) — guarded on
 * `workServiceWs.getConnectionState() !== 'connected'` so the happy
 * path costs zero Postgres round-trips.
 *
 * Each call returns a handle the caller can `await`-ish on via the
 * `result` state. The hook tears down its WS handler automatically
 * when the consumer unmounts (the singleton's `removeHandler` only
 * disconnects the underlying socket if no other consumers remain).
 */

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'

export interface SapAgentJobRow {
  id: string
  organization_id: string
  requested_by: string | null
  endpoint: string
  payload: Record<string, unknown>
  status: JobStatus
  claimed_by: string | null
  claimed_at: string | null
  attempts: number
  max_attempts: number
  priority: number
  result: Record<string, unknown> | null
  error: string | null
  step: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  heartbeat_at: string | null
  idempotency_key: string | null
  /** Phase D #13 — optional pin to a specific agent (sap_agents.id). */
  assigned_agent_id?: string | null
  /** Phase D #13 — extends each heartbeat from the running agent. */
  claim_lease_until?: string | null
  /** Phase D #13 — reclaim counter; >1 indicates a stuck/recovered job. */
  claim_count?: number
}

export interface SubmitJobInput {
  endpoint: string
  payload: Record<string, unknown>
  priority?: number
  idempotencyKey?: string
  maxAttempts?: number
  /** Phase D #13 — pin the job to a specific agent (sap_agents.id).
   *  When omitted, any agent in the org may claim. */
  assignedAgentId?: string | null
}

export interface ActiveJob {
  id: string
  status: JobStatus
  row: SapAgentJobRow | null
}

interface UseJobQueueResult {
  /** Submit one job and return the inserted row. */
  submit: (input: SubmitJobInput) => Promise<SapAgentJobRow>
  /** Submit a job and resolve when it terminates (completed/failed/canceled). */
  submitAndWait: (
    input: SubmitJobInput,
    opts?: { timeoutMs?: number }
  ) => Promise<SapAgentJobRow>
  /**
   * Phase 5 — observe a job row that was INSERTed by *another* path
   * (e.g. the rust-work-service `/api/v1/sap-mutations/material-master`
   * endpoint) and resolve when it reaches a terminal status. Reuses the
   * same WS subscription + safety-net poll path as `submitAndWait` so
   * concurrent in-flight jobs share one subscription, no per-job
   * channel churn.
   */
  waitForJob: (
    jobId: string,
    opts?: { timeoutMs?: number }
  ) => Promise<SapAgentJobRow>
  /** All jobs currently being watched by this hook instance. */
  watchedJobs: Record<string, ActiveJob>
}

/** 5-min safety-net poll cadence. Only fires when the Rust WS isn't
 *  in `connected` state — the happy path is zero Postgres load between
 *  WS pushes. */
const SAFETY_NET_INTERVAL_MS = 5 * 60_000

function isTerminalStatus(s: JobStatus): boolean {
  return s === 'completed' || s === 'failed' || s === 'canceled'
}

export function useJobQueue(): UseJobQueueResult {
  const [watchedJobs, setWatchedJobs] = useState<Record<string, ActiveJob>>({})
  const watchedIdsRef = useRef<Set<string>>(new Set())
  const waitersRef = useRef<
    Map<
      string,
      { resolve: (row: SapAgentJobRow) => void; reject: (e: Error) => void }
    >
  >(new Map())
  const wsHandlerRef = useRef<WsEventHandler | null>(null)
  const safetyNetHandleRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const orgIdRef = useRef<string | null>(null)

  /** Apply a row update from EITHER the WS push OR the safety-net
   *  poller, resolve any waiting `submitAndWait` promises on terminal
   *  status, and stop watching the job. */
  const applyRowUpdate = useCallback((next: SapAgentJobRow) => {
    if (!watchedIdsRef.current.has(next.id)) return
    setWatchedJobs((prev) => ({
      ...prev,
      [next.id]: { id: next.id, status: next.status, row: next },
    }))
    if (isTerminalStatus(next.status)) {
      const waiter = waitersRef.current.get(next.id)
      if (waiter) {
        waitersRef.current.delete(next.id)
        waiter.resolve(next)
      }
      // Stop watching on terminal — defer one tick so the final
      // setWatchedJobs flush has time to commit.
      setTimeout(() => {
        watchedIdsRef.current.delete(next.id)
      }, 250)
    }
  }, [])

  /** Re-fetch a single job row (used by the safety-net path + WS push
   *  hand-off). The Rust WS push covers the snappy path; we read the
   *  full row so consumers see `result` / `error` / `step` etc. */
  const refetchJob = useCallback(
    async (jobId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as any
      const { data, error } = await client
        .from('sap_agent_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle()
      if (error || !data) return
      const next = data as SapAgentJobRow
      applyRowUpdate(next)
    },
    [applyRowUpdate]
  )

  /** Lazy-wire the singleton WS handler the first time a job is
   *  submitted. The handler stays registered for the hook's lifetime
   *  so concurrent jobs share one subscription (vs. the previous
   *  one-channel-per-job pattern). */
  const ensureWsHandler = useCallback(() => {
    if (wsHandlerRef.current) return
    const orgId = orgIdRef.current ?? getCurrentOrgId()
    if (!orgId) return
    orgIdRef.current = orgId
    const handler: WsEventHandler = (event: WsEvent) => {
      if (event.type !== 'SapJobStatusChanged') return
      // Belt-and-braces org check (the Rust send loop already filters
      // org-scoped events; defence-in-depth here means a future
      // protocol bug or a misconfigured dev server can never leak
      // cross-org status flips into our local state).
      if (event.organization_id && event.organization_id !== orgId) return
      const jobId = event.job_id
      if (!jobId) return
      if (!watchedIdsRef.current.has(jobId)) return
      // The WS payload only carries `status` + `step` + `op` —
      // re-fetch the full row so consumers see the agent's `result`
      // payload, error string, etc. Cheap when the user has 1–5
      // in-flight jobs at any given moment, which is the typical
      // batch-mode scale.
      void refetchJob(jobId)
    }
    try {
      workServiceWs.connect(orgId, handler)
      wsHandlerRef.current = handler
    } catch {
      // WS setup failure is non-fatal — the safety-net timer keeps
      // the watched-jobs state fresh, just less snappy.
    }
  }, [refetchJob])

  /** Lazy-start the 5-min safety-net poller. Tick body short-circuits
   *  unless the WS is currently NOT in `connected` state — happy path
   *  costs zero round-trips. */
  const ensureSafetyNet = useCallback(() => {
    if (safetyNetHandleRef.current) return
    safetyNetHandleRef.current = setInterval(() => {
      if (workServiceWs.getConnectionState() === 'connected') return
      for (const id of watchedIdsRef.current) {
        void refetchJob(id)
      }
    }, SAFETY_NET_INTERVAL_MS)
  }, [refetchJob])

  // Tear down on unmount. The ref values are intentionally read at
  // cleanup time (not snapshotted on mount) — we want whatever's
  // in-flight when the consumer unmounts to be cleaned up.
  useEffect(() => {
    const watchedIds = watchedIdsRef
    const waiters = waitersRef
    return () => {
      if (wsHandlerRef.current) {
        try {
          workServiceWs.removeHandler(wsHandlerRef.current)
        } catch {
          /* ignore */
        }
        wsHandlerRef.current = null
      }
      if (safetyNetHandleRef.current) {
        clearInterval(safetyNetHandleRef.current)
        safetyNetHandleRef.current = null
      }
      watchedIds.current.clear()
      waiters.current.clear()
    }
  }, [])

  const watch = useCallback(
    (row: SapAgentJobRow) => {
      if (watchedIdsRef.current.has(row.id)) return
      watchedIdsRef.current.add(row.id)
      setWatchedJobs((prev) => ({
        ...prev,
        [row.id]: { id: row.id, status: row.status, row },
      }))
      ensureWsHandler()
      ensureSafetyNet()
    },
    [ensureWsHandler, ensureSafetyNet]
  )

  const submit = useCallback(
    async (input: SubmitJobInput): Promise<SapAgentJobRow> => {
      // v1.7.4 — read user id from the cached Supabase session
      // (localStorage) instead of round-tripping GoTrue via getUser(),
      // and pull org_id from the auth-state cache instead of
      // re-querying `user_profiles`. Every queue-mode batch submit used
      // to cost 1× GoTrue getUser + 1× user_profiles select just to
      // resolve these two IDs.
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData.session?.user?.id ?? null
      if (!userId) {
        throw new Error('Not signed in — cannot submit a SAP agent job.')
      }
      const orgId = getCurrentOrgId()
      if (!orgId) {
        throw new Error('Could not resolve organization_id from user_profiles.')
      }
      orgIdRef.current = orgId
      const insert: Partial<SapAgentJobRow> = {
        organization_id: orgId,
        requested_by: userId,
        endpoint: input.endpoint,
        payload: input.payload,
        priority: input.priority ?? 100,
        max_attempts: input.maxAttempts ?? 1,
        idempotency_key: input.idempotencyKey ?? null,
        status: 'queued',
        assigned_agent_id: input.assignedAgentId ?? null,
      }
      // sap_agent_jobs is added in migration 245 — generated types don't
      // include it yet; cast through to bypass the typed overload.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as any
      const { data, error } = await client
        .from('sap_agent_jobs')
        .insert(insert)
        .select('*')
        .single()
      if (error) throw new Error(`Job submit failed: ${error.message}`)
      const row = data as SapAgentJobRow
      watch(row)
      return row
    },
    [watch]
  )

  const submitAndWait = useCallback(
    async (
      input: SubmitJobInput,
      opts?: { timeoutMs?: number }
    ): Promise<SapAgentJobRow> => {
      const row = await submit(input)
      // If somehow already terminal (e.g. agent claimed + finished
      // before our INSERT…RETURNING resolved), skip the waiter.
      if (isTerminalStatus(row.status)) {
        return row
      }
      return new Promise<SapAgentJobRow>((resolve, reject) => {
        const timeoutMs = opts?.timeoutMs ?? 30 * 60_000
        const timer = setTimeout(() => {
          waitersRef.current.delete(row.id)
          reject(
            new Error(
              `Job ${row.id} did not terminate within ${Math.round(timeoutMs / 1000)}s. ` +
                `Last seen status: ${row.status}.`
            )
          )
        }, timeoutMs)
        waitersRef.current.set(row.id, {
          resolve: (final) => {
            clearTimeout(timer)
            resolve(final)
          },
          reject: (e) => {
            clearTimeout(timer)
            reject(e)
          },
        })
      })
    },
    [submit]
  )

  /**
   * Phase 5 — observe a job row that was INSERTed elsewhere (e.g. via
   * the rust-work-service `/api/v1/sap-mutations/material-master`
   * endpoint) and resolve when it terminates. The job_id must belong
   * to the current user's org or the bootstrap fetch will return
   * nothing (RLS).
   */
  const waitForJob = useCallback(
    async (
      jobId: string,
      opts?: { timeoutMs?: number }
    ): Promise<SapAgentJobRow> => {
      // Bootstrap fetch — gives the caller a meaningful resolution
      // payload AND lets us short-circuit if the agent already
      // finished while the FE was deciding whether to wait.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as any
      const { data, error } = await client
        .from('sap_agent_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle()
      if (error || !data) {
        throw new Error(
          `waitForJob bootstrap fetch failed for ${jobId}: ${error?.message ?? 'no row visible to RLS'}`
        )
      }
      const row = data as SapAgentJobRow
      orgIdRef.current = row.organization_id
      // Make sure the singleton WS handler is wired AND a watch
      // entry exists before we evaluate terminal status — otherwise
      // a near-instant terminal between bootstrap fetch and watch
      // registration would race the WS push.
      watch(row)
      if (isTerminalStatus(row.status)) {
        return row
      }
      return new Promise<SapAgentJobRow>((resolve, reject) => {
        const timeoutMs = opts?.timeoutMs ?? 30 * 60_000
        const timer = setTimeout(() => {
          waitersRef.current.delete(row.id)
          reject(
            new Error(
              `Job ${row.id} did not terminate within ${Math.round(timeoutMs / 1000)}s. ` +
                `Last seen status: ${row.status}.`
            )
          )
        }, timeoutMs)
        waitersRef.current.set(row.id, {
          resolve: (final) => {
            clearTimeout(timer)
            resolve(final)
          },
          reject: (e) => {
            clearTimeout(timer)
            reject(e)
          },
        })
      })
    },
    [watch]
  )

  return { submit, submitAndWait, waitForJob, watchedJobs }
}

// Created and developed by Jai Singh
