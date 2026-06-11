-- ============================================================================
-- Migration 291 — claim_sap_agent_job enforces max_attempts (stop runaway
--                 re-claim cycles on long-running jobs whose lease expires)
-- ============================================================================
--
-- Problem (production, 2026-05-09, org c9d89a74…):
--   The user kicked off a single fleet-mode LT10 query from the new
--   Inventory Management → Execution Mode toggle with payload
--   {material:'*', warehouse:'WH5', storage_type:'*'} — i.e. every bin
--   for every material in WH5. That handler (omni_agent.handler_lt10)
--   takes many minutes against a fully-stocked warehouse, well beyond
--   the 90-second default lease that `rust-work-service`'s
--   `POST /api/v1/sap-agents/jobs/claim` requests
--   (`DEFAULT_LEASE_SECONDS = 90`, see
--   `rust-work-service/src/api/routes/sap_agents.rs`).
--
--   What we observed in `sap_agent_jobs`:
--     id = badbc9fe-…
--     endpoint = '/sap/query'  (handler='lt10')
--     status = 'running'
--     max_attempts = 1
--     attempts = 18
--     claim_count = 18
--     created_at = 18:18:23
--     last claimed_at = 19:02:18  (45 min after creation)
--
--   The agent re-fired LT10 in SAP eighteen times for one user click.
--   Each cycle: agent claims → starts LT10 → SAP COM call blocks the
--   heartbeat thread long enough for the 90s lease to lapse → next
--   `claim_sap_agent_job(...)` call from the same agent's 5s claim
--   poller picks the SAME row up because its predicate is
--
--     status = 'queued'
--      OR (status = 'running'
--          AND COALESCE(claim_lease_until, claimed_at + interval '5 minutes') < now())
--
--   with NO check on `attempts < max_attempts`. So `max_attempts=1` is
--   advisory only — the lease-expiry branch ignores it entirely and
--   the job churns forever.
--
--   The user reports seeing "LT10 jobs get executed by the agent
--   multiple times without the user initiating them". This migration
--   fixes the bug: that single click should fire LT10 at most
--   `max_attempts` times, then terminate as `status='failed'`.
--
-- Why the cap was missing originally:
--   The lease-expiry branch was added in migration 247 to handle the
--   "agent crashed mid-job" case — operator unplugs Citrix, lease
--   expires, another agent (or the same agent restarted) reclaims and
--   completes. That intent is correct; the bug is that the same branch
--   had no upper bound, so a job that legitimately *cannot* be
--   completed within `max_attempts` lease windows (because the SAP
--   work itself takes longer than the lease) recycles forever instead
--   of failing fast.
--
-- Fix:
--   1. Add a CTE `terminate_zombies` that flips over-attempted
--      `running` rows to `failed` with a descriptive `error` /
--      `step='watchdog_max_attempts'` breadcrumb. Runs as the first
--      statement of every `claim_sap_agent_job` call so the cleanup
--      cost is amortised across the existing 5s claim poll cadence —
--      no separate scheduler needed.
--
--   2. Tighten the `running`-branch predicate so over-attempted rows
--      are NEVER picked up again, even between the cleanup pass and
--      the SELECT. Belt-and-braces: even if the cleanup UPDATE got
--      rolled back somehow (it won't, single transaction), the SELECT
--      can't pick up a row whose attempts have been spent.
--
--   3. One-time row cleanup at migration apply: terminate any
--      currently-stuck rows so the user gets immediate relief without
--      waiting for the next claim cycle. The very next claim attempt
--      would do this anyway via the new function body, but doing it
--      explicitly here keeps the migration's effect observable in the
--      apply log and avoids a 5–90s "phantom LT10 still firing"
--      window after deploy.
--
-- Org-scope safety:
--   The `terminate_zombies` UPDATE inside the function is scoped to
--   `organization_id = p_organization_id`, matching the existing
--   org-scoped behaviour of the rest of the function. Cross-org
--   reaping is intentionally NOT attempted here — a per-org agent
--   can only fix its own queue.
--
-- Compatibility:
--   * Same signature: `claim_sap_agent_job(p_organization_id uuid,
--     p_agent_id text, p_lease_seconds int DEFAULT 300)`
--     RETURNS sap_agent_jobs.
--   * Same return semantics: row of matching shape on success;
--     all-NULL row when the queue is empty (the
--     `rust-work-service` claim handler relies on detecting NULL `id`
--     for "no claim").
--   * Idempotent on apply: `CREATE OR REPLACE` + the one-time
--     cleanup uses the same predicate as the in-function cleanup so
--     re-applying is a no-op once the queue is healthy.
--
-- Related notes:
--   * `[[Decisions/ADR-Trigger-DSL-Evaluator-Phase9]]` — the trigger
--     evaluator that produces queue rows. NOT the source of this bug
--     — phantom executions are server-side claim cycling, not
--     duplicate INSERTs.
--   * `[[Components/Omni-Agent - Headless SAP Agent]]` — claim/
--     heartbeat/complete protocol on the agent side.
--   * `[[Implementations/Implement-Inventory-Management-Fleet-Routing]]`
--     — the FE fleet-mode toggle whose first real-user use surfaced
--     this latent bug.
--   * `[[Debug/Fix-LT10-Phantom-Re-Claims]]` — incident write-up.
-- ============================================================================

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1. Patch the claim function: enforce max_attempts on the lease-expiry
--    branch + auto-terminate over-attempted zombies on every claim.
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_sap_agent_job(
  p_organization_id uuid,
  p_agent_id        text,
  p_lease_seconds   integer DEFAULT 300
)
RETURNS public.sap_agent_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  claimed       public.sap_agent_jobs%ROWTYPE;
  v_lease_until TIMESTAMPTZ := now() + make_interval(secs => p_lease_seconds);
BEGIN
  -- ── Pass 1: terminate over-attempted zombies for this org ───────────
  --
  -- Any row in `status='running'` whose lease has lapsed AND whose
  -- attempts have already been spent (`attempts >= max_attempts`) gets
  -- moved to `failed` with a descriptive breadcrumb. This is what
  -- prevents the runaway re-claim cycle that produced the 18-attempts
  -- LT10 storm in production on 2026-05-09.
  --
  -- We deliberately scope this to the caller's org (matches the
  -- claim's existing org-scope) rather than reaping cross-org
  -- zombies — different agents pick up their own queues, so each
  -- claim cycle keeps its own house in order without reaching
  -- across tenant boundaries.
  UPDATE public.sap_agent_jobs
     SET status       = 'failed',
         completed_at = now(),
         step         = 'watchdog_max_attempts',
         error        = COALESCE(NULLIF(error, ''), '') ||
                        CASE WHEN COALESCE(error, '') = '' THEN '' ELSE ' | ' END ||
                        'watchdog: max_attempts (' ||
                        COALESCE(max_attempts, 1)::text ||
                        ') exhausted with lease expiry; last lease ended at ' ||
                        COALESCE(claim_lease_until, claimed_at + interval '5 minutes')::text ||
                        ' (now=' || now()::text || ')'
   WHERE organization_id = p_organization_id
     AND status = 'running'
     AND COALESCE(claim_lease_until, claimed_at + interval '5 minutes') < now()
     AND COALESCE(attempts, 0) >= COALESCE(max_attempts, 1);

  -- ── Pass 2: claim the next eligible job ────────────────────────────
  --
  -- Same predicate as pre-migration EXCEPT the `running` branch now
  -- additionally requires `attempts < max_attempts`. Belt-and-braces
  -- with Pass 1 above — even if the zombie sweep is somehow rolled
  -- back, this filter keeps over-attempted rows out of the claim set.
  UPDATE public.sap_agent_jobs
     SET status            = 'running',
         claimed_by        = p_agent_id,
         assigned_agent_id = COALESCE(assigned_agent_id, p_agent_id),
         claimed_at        = now(),
         claim_lease_until = v_lease_until,
         claim_count       = claim_count + 1,
         started_at        = COALESCE(started_at, now()),
         heartbeat_at      = now(),
         attempts          = attempts + 1
   WHERE id = (
           SELECT id FROM public.sap_agent_jobs
            WHERE organization_id = p_organization_id
              AND (assigned_agent_id IS NULL OR assigned_agent_id = p_agent_id)
              AND (
                status = 'queued'
                OR (
                  status = 'running'
                  AND COALESCE(claim_lease_until, claimed_at + interval '5 minutes') < now()
                  AND COALESCE(attempts, 0) < COALESCE(max_attempts, 1)
                )
              )
            ORDER BY priority ASC, created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
   RETURNING * INTO claimed;

  RETURN claimed;
END;
$function$;

COMMENT ON FUNCTION public.claim_sap_agent_job(uuid, text, integer) IS
  'v0.1.36 — atomic claim of the next eligible sap_agent_jobs row for '
  '`p_agent_id` in `p_organization_id`. Honours `assigned_agent_id` '
  'pinning + lease expiry. Migration 291 added max_attempts enforcement '
  'on the lease-expiry branch (previously the cap was advisory only and '
  'long-running jobs whose lease lapsed mid-execution would be re-claimed '
  'forever — root cause of the 2026-05-09 LT10 phantom-execution '
  'incident). Now: over-attempted rows are auto-failed with a '
  '`watchdog_max_attempts` breadcrumb on every claim, AND the SELECT '
  'predicate filters them out belt-and-braces.';

-- ───────────────────────────────────────────────────────────────────────
-- 2. One-time cleanup of currently-stuck rows
-- ───────────────────────────────────────────────────────────────────────
--
-- Runs the same UPDATE as Pass 1 of the new function body, but
-- unscoped (every org). The very next claim cycle would fix each
-- org's queue anyway, but doing it here:
--   * gives the user immediate relief (no 5–90s window where LT10
--     keeps firing while the next claim happens),
--   * makes the migration's effect observable in the apply log
--     (RAISE NOTICE below),
--   * matches the same predicate so re-applying the migration on a
--     healthy queue is a no-op.
DO $$
DECLARE
  v_terminated int;
BEGIN
  WITH zombies AS (
    UPDATE public.sap_agent_jobs
       SET status       = 'failed',
           completed_at = now(),
           step         = 'watchdog_max_attempts',
           error        = COALESCE(NULLIF(error, ''), '') ||
                          CASE WHEN COALESCE(error, '') = '' THEN '' ELSE ' | ' END ||
                          'watchdog: max_attempts (' ||
                          COALESCE(max_attempts, 1)::text ||
                          ') exhausted with lease expiry; last lease ended at ' ||
                          COALESCE(claim_lease_until, claimed_at + interval '5 minutes')::text ||
                          ' (now=' || now()::text ||
                          '); terminated by migration 291 cleanup'
     WHERE status = 'running'
       AND COALESCE(claim_lease_until, claimed_at + interval '5 minutes') < now()
       AND COALESCE(attempts, 0) >= COALESCE(max_attempts, 1)
    RETURNING id
  )
  SELECT count(*)::int INTO v_terminated FROM zombies;

  IF v_terminated > 0 THEN
    RAISE NOTICE 'migration 291 cleanup: terminated % stuck running job(s) past max_attempts.', v_terminated;
  ELSE
    RAISE NOTICE 'migration 291 cleanup: no stuck rows found (queue healthy).';
  END IF;
END $$;

COMMIT;
