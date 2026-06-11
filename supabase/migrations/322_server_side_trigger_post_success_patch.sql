-- ============================================================================
-- Migration 322 — Server-side application of post_success_patch when
--                 sap_agent_jobs transitions to status='completed'
--                 (close the silent-skip when the agent is missing a
--                 valid Supabase user token)
-- ============================================================================
--
-- Problem (production, 2026-05-19/20, org c9d89a74…):
--   After migration 321 rescued the 41 stuck putaway TO confirms, the
--   agent successfully fired LT12 in SAP and marked the corresponding
--   `sap_agent_jobs` rows `status='completed'`. But the FE Pending
--   Confirms card still showed 21 of those 41 rows as stuck because the
--   agent's post-success patch back to `rf_putaway_operations` silently
--   never ran — `state.supabase_token` was empty (operator hadn't run
--   `/supabase/login` recently / token expired).
--
--   The agent at `omni_agent/agent.py:6827` has:
--     def _apply_trigger_post_patch(post_patch: dict, job_id: str) -> None:
--         if not state.supabase_url or not state.supabase_token:
--             return
--         …
--   And at line 7349 (`_update_putaway_status`):
--     if not state.supabase_token:
--         print("[lt12]  WARN _update_putaway_status skipped: no Supabase token…")
--         return
--   So the agent confirms in SAP, calls the rust-work-service
--   `/jobs/:id/complete` (which is service-key authed and works
--   regardless of the agent's user-token state), then silently fails
--   to patch the source row. The TO is genuinely confirmed in SAP but
--   the OmniFrame "Putaway Log" view keeps showing it as pending.
--
--   Concrete evidence:
--     SELECT j.status, count(*) FILTER (WHERE r.confirmed_source IS NULL)
--     FROM sap_agent_jobs j JOIN agent_triggers t … JOIN rf_putaway_operations r
--     WHERE j.organization_id = 'c9d89a74…'
--       AND j.created_at > now() - interval '24h'
--       AND r.is_mca_workflow IS NOT TRUE
--     → status='completed': 305 jobs (284 patched + 21 NOT patched)
--     A representative job's `result` blob: `{"ok": true, "message":
--     "Transfer order 0003684783 confirmed"}` — SAP says yes, FE says
--     no.
--
-- Root cause:
--   Two independent patch paths gated on the SAME failing precondition
--   (`state.supabase_token`). Both silently no-op when the token is
--   missing. The post_success_patch envelope is RIGHT THERE in the job
--   payload (the trigger evaluator put it there at INSERT time), so we
--   have everything we need server-side; the agent just isn't able to
--   relay it back to the source row.
--
-- Fix:
--   1. Add a Postgres `AFTER UPDATE` trigger on `sap_agent_jobs` that
--      fires when `status` transitions from a non-completed value to
--      `'completed'`. The trigger reads
--      `payload->'__omni_trigger_meta'->'post_success_patch'`, validates
--      the target table is on a small allowlist (`rf_putaway_operations`
--      today), and applies the patch using a column allowlist
--      (`confirmed_source`, `confirmed_by_label`, `confirmed_by_agent_id`)
--      PLUS the legacy 3 fields (`to_status='TO Confirmed'`,
--      `confirmed_at=now()`) when the row is currently in `Completed`.
--
--      The trigger is idempotent (the WHERE clause requires
--      `confirmed_source IS NULL` so a duplicate fire is a no-op) AND
--      doesn't fail the sap_agent_jobs UPDATE if anything goes wrong
--      (`EXCEPTION WHEN others THEN RAISE WARNING …` in the body so
--      the job-state machine never blocks on patch trouble).
--
--   2. One-time reconciliation pass: scan every `sap_agent_jobs` row
--      with `status='completed'` in the last 24h whose source
--      `rf_putaway_operations` row still has `confirmed_source IS NULL`,
--      and apply the patch retroactively. Resolves the 21 currently-
--      visible stuck rows immediately rather than waiting for a fresh
--      job transition.
--
-- Why a database trigger (vs adding the patch to rust-work-service):
--   * Lifts the dependency on the agent's expiring user token entirely.
--   * Service-key write context is implicit — Postgres just runs the
--     UPDATE with table owner privileges (matching the existing
--     `claim_sap_agent_job` SECURITY DEFINER pattern).
--   * Atomic with the status transition — no race window where the
--     job is `completed` but the source row hasn't been patched yet.
--   * Works for any job-completion path (rust-work-service-driven,
--     a future direct-RPC path, manual /complete calls in admin tools,
--     etc.) without per-callsite repetition.
--
-- Why allowlist columns + tables (vs blindly applying the JSON patch):
--   * The trigger evaluator builds the `post_success_patch` from a
--     row in `agent_triggers` editable from the FE admin panel. An
--     attacker with FE admin access could otherwise use the patch as
--     a SQL injection vector by setting `patch.<col>` to anything
--     they want. The allowlist matches what the agent's
--     `_apply_trigger_post_patch` already filters on
--     (omni_agent/agent.py:6884) so the trust boundary stays the same.
--
-- Compatibility:
--   * The agent's `_apply_trigger_post_patch` and
--     `_update_putaway_status` continue to work when the operator is
--     logged in. They write to a row that's already been patched
--     server-side; the WHERE clauses there gate on
--     `to_status != 'TO Confirmed'` / `confirmed_source IS NULL` so a
--     server-side pre-patch silently makes the agent's PATCH a no-op
--     (the RETURN counts will read 0 rows on the warn lines, which
--     is fine). No agent code change required.
--   * Existing manual paths (admin curl to /sap/confirm-to without
--     trigger meta) don't carry post_success_patch in payload, so
--     the trigger is a no-op for them.
--
-- Related:
--   * `[[Debug/Fix-Agent-Dual-Patcher-Race]]` — earlier history of
--     the agent-side patcher.
--   * `[[Patterns/Agent-Self-Attribution]]` — the overlay-pattern
--     this server-side fix preserves.
--   * `[[supabase/migrations/321_backfill_resets_claim_count.sql]]`
--     — the upstream rescue this migration completes.
-- ============================================================================

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1. Trigger function — apply post_success_patch on completion.
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_sap_agent_job_post_success_patch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_meta jsonb;
  v_patch jsonb;
  v_table text;
  v_row_id uuid;
  v_patch_body jsonb;
  v_confirmed_source text;
  v_confirmed_by_label text;
  v_confirmed_by_agent_id text;
  v_rows_patched int := 0;
BEGIN
  -- Only fire on a real transition to 'completed' (not no-op UPDATEs or
  -- transitions between other statuses).
  IF NEW.status IS NULL OR NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT NULL AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Read the patch envelope. Bail quietly if the job didn't carry one
  -- (manual /complete calls, non-trigger-driven jobs, etc.).
  v_meta := NEW.payload -> '__omni_trigger_meta';
  IF v_meta IS NULL OR jsonb_typeof(v_meta) <> 'object' THEN
    RETURN NEW;
  END IF;
  v_patch := v_meta -> 'post_success_patch';
  IF v_patch IS NULL OR jsonb_typeof(v_patch) <> 'object' THEN
    RETURN NEW;
  END IF;

  v_table := v_patch ->> 'table';
  v_row_id := NULLIF(v_patch ->> 'row_id', '')::uuid;
  v_patch_body := v_patch -> 'patch';

  IF v_table IS NULL OR v_row_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_patch_body IS NULL OR jsonb_typeof(v_patch_body) <> 'object' THEN
    RETURN NEW;
  END IF;

  -- Allowlist target tables. Add cases here as new triggers ship; do
  -- NOT branch on a generic dynamic SQL path — the column allowlist
  -- below is per-table.
  IF v_table = 'rf_putaway_operations' THEN
    -- Allowlisted overlay columns (mirrors agent.py:6884).
    v_confirmed_source     := v_patch_body ->> 'confirmed_source';
    v_confirmed_by_label   := v_patch_body ->> 'confirmed_by_label';
    v_confirmed_by_agent_id := v_patch_body ->> 'confirmed_by_agent_id';

    -- Don't fight an already-confirmed row (idempotent on duplicate
    -- fires + safe co-existence with the agent's own PATCH path when
    -- the operator IS logged in). We also flip `to_status` and
    -- `confirmed_at` here as the legacy 3-field equivalent so the FE's
    -- "Pending Confirms" filter stops matching the row.
    UPDATE public.rf_putaway_operations r
       SET confirmed_source      = COALESCE(r.confirmed_source, v_confirmed_source),
           confirmed_by_label    = COALESCE(r.confirmed_by_label, v_confirmed_by_label),
           confirmed_by_agent_id = COALESCE(r.confirmed_by_agent_id, v_confirmed_by_agent_id),
           confirmed_at          = COALESCE(r.confirmed_at, now()),
           to_status             = CASE
                                     WHEN r.to_status = 'Completed' THEN 'TO Confirmed'
                                     ELSE r.to_status
                                   END,
           updated_at            = now()
     WHERE r.id = v_row_id
       AND r.organization_id = NEW.organization_id
       AND r.confirmed_source IS NULL;

    GET DIAGNOSTICS v_rows_patched = ROW_COUNT;
    IF v_rows_patched > 0 THEN
      RAISE NOTICE
        'apply_sap_agent_job_post_success_patch: patched rf_putaway_operations id=% from job=% (org=%, source=%)',
        v_row_id, NEW.id, NEW.organization_id, v_confirmed_source;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the sap_agent_jobs status transition on a patch
  -- failure. Worst case: the row stays unpatched and the next
  -- backfill / reconciliation pass picks it up. We log loudly so a
  -- chronic regression is observable in the Postgres logs.
  RAISE WARNING
    'apply_sap_agent_job_post_success_patch: SUPPRESSED error on job=% (org=%): % / %',
    NEW.id, NEW.organization_id, SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.apply_sap_agent_job_post_success_patch() IS
  'Migration 322 — Server-side replacement for the agent''s '
  '_apply_trigger_post_patch + _update_putaway_status PATCH paths when '
  'state.supabase_token is missing/expired. Fires AFTER UPDATE on '
  'sap_agent_jobs when status transitions to ''completed''; reads '
  'payload.__omni_trigger_meta.post_success_patch and applies the '
  'allowlisted column updates to the target row. Idempotent (gated on '
  'confirmed_source IS NULL). Failure-suppressing (job state machine '
  'never blocks on patch trouble).';

DROP TRIGGER IF EXISTS sap_agent_jobs_apply_post_success_patch
  ON public.sap_agent_jobs;

CREATE TRIGGER sap_agent_jobs_apply_post_success_patch
  AFTER UPDATE OF status ON public.sap_agent_jobs
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM NEW.status))
  EXECUTE FUNCTION public.apply_sap_agent_job_post_success_patch();

-- ───────────────────────────────────────────────────────────────────────
-- 2. One-time reconciliation of completed-but-unpatched rows.
--
--    Same logic as the trigger but applied retroactively to the
--    backlog of jobs that completed before this trigger existed and
--    whose patches were silently skipped on the agent side.
-- ───────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_total int := 0;
  v_patched int;
  rec record;
BEGIN
  FOR rec IN
    SELECT j.id AS job_id,
           j.organization_id,
           j.payload -> '__omni_trigger_meta' -> 'post_success_patch' AS patch_envelope
    FROM public.sap_agent_jobs j
    JOIN public.agent_triggers t
      ON t.organization_id = j.organization_id
     AND t.source_table = 'rf_putaway_operations'
    WHERE j.status = 'completed'
      AND j.created_at > now() - interval '24 hours'
      AND j.payload -> '__omni_trigger_meta' -> 'post_success_patch' IS NOT NULL
      AND j.idempotency_key LIKE 'trig:' || t.id::text || ':%'
  LOOP
    DECLARE
      v_table text := rec.patch_envelope ->> 'table';
      v_row_id uuid := NULLIF(rec.patch_envelope ->> 'row_id', '')::uuid;
      v_body jsonb := rec.patch_envelope -> 'patch';
      v_src text;
      v_label text;
      v_agent_id text;
    BEGIN
      IF v_table <> 'rf_putaway_operations' OR v_row_id IS NULL OR v_body IS NULL THEN
        CONTINUE;
      END IF;

      v_src := v_body ->> 'confirmed_source';
      v_label := v_body ->> 'confirmed_by_label';
      v_agent_id := v_body ->> 'confirmed_by_agent_id';

      UPDATE public.rf_putaway_operations r
         SET confirmed_source      = COALESCE(r.confirmed_source, v_src),
             confirmed_by_label    = COALESCE(r.confirmed_by_label, v_label),
             confirmed_by_agent_id = COALESCE(r.confirmed_by_agent_id, v_agent_id),
             confirmed_at          = COALESCE(r.confirmed_at, now()),
             to_status             = CASE
                                       WHEN r.to_status = 'Completed' THEN 'TO Confirmed'
                                       ELSE r.to_status
                                     END,
             updated_at            = now()
       WHERE r.id = v_row_id
         AND r.organization_id = rec.organization_id
         AND r.confirmed_source IS NULL;

      GET DIAGNOSTICS v_patched = ROW_COUNT;
      v_total := v_total + v_patched;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        'migration 322 reconcile: SUPPRESSED error on job=%: % / %',
        rec.job_id, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE
    'migration 322 reconciliation: patched % previously-orphaned rf_putaway_operations rows.',
    v_total;
END $$;

COMMIT;
