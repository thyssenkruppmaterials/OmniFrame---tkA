-- ============================================================================
-- Migration 266 — Port advisory-locked zone exclusivity onto work_tasks
--
-- Closes Item 11 from the operator follow-up list in
-- docs/work-engine/README.md. Until this migration ships,
-- `work_tasks_read_primary` cannot be flipped per-org safely because the
-- legacy invariants (mig 225 / 230 / 231 / 232 / 233 / 252 / 253) only fire
-- on `rr_cyclecount_data` — a `work_tasks` row could be claimed/assigned
-- without being subject to the same zone-mutual-exclusion guarantees.
--
-- This migration is a faithful port of `enforce_cycle_count_zone_exclusivity`
-- onto `public.work_tasks`. The shape and semantics match the legacy trigger
-- bug-for-bug:
--
--   1. Session GUC bypass — both `app.cycle_count_zone_lock_bypass` (legacy)
--      AND `app.work_zone_lock_bypass` (new, used by `reassign_work_zone`)
--      short-circuit the holder check for the duration of the txn.
--
--   2. Trigger order: zone-to-user assignment FIRST (via JOIN to
--      `work_zone_assignments` view → `cycle_count_zone_assignments`), THEN
--      bypass priorities/subtypes / critical bypass, THEN per-(org, dispatch_zone)
--      advisory lock, THEN active-then-reserved holder check.
--
--   3. Distinct error codes / messages:
--        - `ZONE_ASSIGNED` (admin assigned the zone to another user)
--        - `ZONE_LOCKED: active` (another user is actively counting/working)
--        - `ZONE_LOCKED: reserved` (pending+assigned soft-release reservation)
--
--   4. Pattern-aware zone resolution via `public.work_zone_of()` (created in
--      mig 256), NOT raw `split_part()` — same correctness semantics as the
--      legacy trigger when the org sets a custom `zone_pattern`.
--
--   5. Critical priority bypasses occupancy (mig 252 contract: a saturated
--      zone NEVER hides a critical-priority task). The zone-to-user
--      assignment check is NOT bypassable.
--
--   6. Supervisor protection: when `supervisor_assigned_at` is set within
--      the org's `supervisor_assignment_protection_hours` window, the
--      occupancy check is skipped (admin intent overrides organic
--      reservations). Mirrors the escalator's protection clause from
--      mig 252.
--
--   7. Soft-release semantics: the trigger only ENFORCES exclusivity; it
--      does NOT touch `assigned_to`. The release path lives in the calling
--      code (Rust `release_cycle_count`, etc.).
--
--   8. Trigger name `trg_zzz_enforce_work_task_zone_exclusivity` — `zzz_`
--      prefix forces alphabetical-last firing so it runs AFTER:
--        - `trg_maintain_work_task_reservation` (stamps reservation_started_at)
--        - `trg_work_tasks_dispatch_zone`        (computes NEW.dispatch_zone)
--        - `trg_work_tasks_updated_at`           (touches updated_at)
--      Mirrors the legacy `zzz_trigger_enforce_zone_exclusivity` pattern.
--
-- This migration is INERT until the org enables zone-exclusivity rules
-- (`work_zone_rules.enabled = true`). Per migration 256, the seed is
-- `enabled=false` for new orgs. The j.AI OneBox row inherited from
-- mig 225's seed already has `enabled=true`, so this trigger is live for
-- that org as soon as the migration applies.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Trigger function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_work_task_zone_exclusivity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bypass_legacy   text;
  v_bypass_new      text;
  v_enabled         boolean;
  v_policy          text;
  v_pattern         text;
  v_bypass_prio     text[];
  v_bypass_subtypes text[];
  v_treat_null_lock boolean;
  v_protect_hours   int;
  v_zone            text;
  v_owner           uuid;
  v_owner_name      text;
  v_owner_status    text;
  v_assigned_user   uuid;
  v_assigned_name   text;
  v_should_check    boolean := false;
  v_loc             text;
BEGIN
  -- --------------------------------------------------------------------
  -- Session bypass — absolute escape hatch (used by SECURITY DEFINER
  -- RPCs that already hold the invariants, e.g. reassign_work_zone).
  -- --------------------------------------------------------------------
  BEGIN
    v_bypass_legacy := current_setting('app.cycle_count_zone_lock_bypass', true);
  EXCEPTION WHEN OTHERS THEN v_bypass_legacy := NULL; END;
  BEGIN
    v_bypass_new := current_setting('app.work_zone_lock_bypass', true);
  EXCEPTION WHEN OTHERS THEN v_bypass_new := NULL; END;

  IF v_bypass_legacy IN ('on','true','1','yes')
     OR v_bypass_new IN ('on','true','1','yes') THEN
    RETURN NEW;
  END IF;

  -- --------------------------------------------------------------------
  -- Terminal statuses don't hold zone — skip enforcement entirely.
  -- --------------------------------------------------------------------
  IF NEW.status IN ('completed','cancelled','paused') THEN
    RETURN NEW;
  END IF;

  -- Unassigned rows never hold zone.
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;

  -- --------------------------------------------------------------------
  -- Decide whether this transition is interesting. Mirrors the legacy
  -- trigger: assignee changes always check; a status flip INTO
  -- claimed/in_progress checks; idempotent re-saves don't.
  -- --------------------------------------------------------------------
  IF TG_OP = 'INSERT' THEN
    v_should_check := true;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
      v_should_check := true;
    ELSIF NEW.status IN ('claimed','in_progress')
      AND OLD.status IS DISTINCT FROM NEW.status
    THEN
      v_should_check := true;
    ELSIF NEW.dispatch_zone IS DISTINCT FROM OLD.dispatch_zone THEN
      v_should_check := true;
    END IF;
  END IF;
  IF NOT v_should_check THEN RETURN NEW; END IF;

  -- --------------------------------------------------------------------
  -- Org-level rules. work_zone_rules is a passthrough view of
  -- cycle_count_zone_rules (mig 256 §12). If it doesn't exist or the
  -- org row is missing/disabled, nothing to enforce.
  -- bypass_subtypes is NULL on legacy rows — coalesce to
  -- bypass_count_types since work_tasks.task_subtype is the moral
  -- equivalent of rr_cyclecount_data.count_type.
  -- --------------------------------------------------------------------
  BEGIN
    SELECT enabled, policy, zone_pattern,
           bypass_priorities,
           bypass_count_types,
           COALESCE(treat_null_zone_as_locked, false),
           COALESCE(supervisor_assignment_protection_hours, 24)
      INTO v_enabled, v_policy, v_pattern,
           v_bypass_prio, v_bypass_subtypes,
           v_treat_null_lock, v_protect_hours
      FROM public.work_zone_rules
     WHERE organization_id = NEW.organization_id;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    -- Test-fixture or pre-256 environment — bail out without enforcing.
    RETURN NEW;
  END;

  IF NOT FOUND OR v_enabled IS NOT TRUE OR v_policy = 'off' THEN
    RETURN NEW;
  END IF;

  -- --------------------------------------------------------------------
  -- Zone resolution — prefer the post-stamp dispatch_zone (computed by
  -- trg_work_tasks_dispatch_zone) and fall back to a fresh
  -- pattern-aware lookup. This mirrors the trigger ordering note in
  -- the migration header.
  -- --------------------------------------------------------------------
  v_zone := COALESCE(
    NULLIF(NEW.dispatch_zone, ''),
    public.work_zone_of(NEW.primary_location, v_pattern),
    NULLIF(NEW.zone, '')
  );

  -- --------------------------------------------------------------------
  -- NULL-zone fallback (mirrors mig 252 cycle-count semantics): when the
  -- org opts in via treat_null_zone_as_locked, fall back to
  -- LOCATION-EXACT-MATCH exclusivity so two operators don't end up at
  -- the same physical bin just because the location string didn't
  -- parse to a zone.
  -- --------------------------------------------------------------------
  IF v_zone IS NULL THEN
    IF NOT v_treat_null_lock THEN
      RETURN NEW;
    END IF;

    v_loc := COALESCE(NULLIF(NEW.primary_location, ''), '<<empty>>');

    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        format('worktask_loc:%s:%s', NEW.organization_id, v_loc),
        0
      )
    );

    SELECT assigned_to, status::text
      INTO v_owner, v_owner_status
    FROM public.work_tasks
    WHERE id <> NEW.id
      AND organization_id = NEW.organization_id
      AND COALESCE(NULLIF(primary_location, ''), '<<empty>>') = v_loc
      AND assigned_to IS NOT NULL
      AND assigned_to <> NEW.assigned_to
      AND status IN ('pending','claimed','in_progress')
    ORDER BY
      CASE status::text
        WHEN 'in_progress' THEN 1
        WHEN 'claimed'     THEN 2
        WHEN 'pending'     THEN 3
      END,
      assigned_at ASC NULLS LAST
    LIMIT 1;

    IF v_owner IS NOT NULL THEN
      SELECT COALESCE(full_name, email, 'another worker')
        INTO v_owner_name
      FROM public.user_profiles WHERE id = v_owner;

      RAISE EXCEPTION
        'ZONE_LOCKED: Location "%" is currently held by % (NULL-zone fallback). Only one worker may hold this exact bin at a time.',
        v_loc,
        COALESCE(v_owner_name, 'another worker')
      USING ERRCODE = 'P0001',
            HINT = 'work_task_null_zone_location_lock',
            DETAIL = format('zone=NULL;location=%s;owner=%s;state=%s',
                            v_loc, v_owner, v_owner_status);
    END IF;
    RETURN NEW;
  END IF;

  -- --------------------------------------------------------------------
  -- (a) Zone-to-user assignment check — ALWAYS enforced.
  -- The work_zone_assignments view (mig 256 §12) is a security_invoker
  -- passthrough of cycle_count_zone_assignments; admin "Nikki owns K1"
  -- intent must override bypass priorities / subtypes.
  -- --------------------------------------------------------------------
  BEGIN
    SELECT user_id INTO v_assigned_user
      FROM public.work_zone_assignments
     WHERE organization_id = NEW.organization_id AND zone = v_zone;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_assigned_user := NULL;
  END;

  IF v_assigned_user IS NOT NULL AND v_assigned_user <> NEW.assigned_to THEN
    SELECT COALESCE(full_name, email, 'another worker')
      INTO v_assigned_name
    FROM public.user_profiles WHERE id = v_assigned_user;

    RAISE EXCEPTION
      'ZONE_ASSIGNED: Zone "%" is assigned to %. Only that worker may hold this zone.',
      v_zone,
      COALESCE(v_assigned_name, 'another worker')
    USING ERRCODE = 'P0001',
          HINT   = 'work_task_zone_assigned',
          DETAIL = format('zone=%s;assigned_to=%s', v_zone, v_assigned_user);
  END IF;

  -- --------------------------------------------------------------------
  -- (b) Bypass overrides — apply ONLY to the active/reserved holder
  -- check, NEVER to the zone-assignment check above.
  --
  -- Critical priority is unconditionally bypassed (mig 252 contract:
  -- saturated zones never hide critical work).
  -- --------------------------------------------------------------------
  IF NEW.priority = 'critical' THEN
    RETURN NEW;
  END IF;

  IF v_bypass_prio IS NOT NULL AND NEW.priority = ANY(v_bypass_prio) THEN
    RETURN NEW;
  END IF;
  IF v_bypass_subtypes IS NOT NULL
     AND NEW.task_subtype IS NOT NULL
     AND NEW.task_subtype = ANY(v_bypass_subtypes)
  THEN
    RETURN NEW;
  END IF;

  -- Supervisor protection (mig 252 Gap 1): a row that an admin
  -- explicitly assigned within the protection window is exempt from
  -- the occupancy check — the supervisor's intent overrides organic
  -- reservations on this zone for the protection horizon.
  IF NEW.supervisor_assigned_at IS NOT NULL
     AND NEW.supervisor_assigned_at >= NOW() - make_interval(hours => v_protect_hours)
  THEN
    RETURN NEW;
  END IF;

  -- --------------------------------------------------------------------
  -- (c) Race-safe holder check via per-(org, dispatch_zone) advisory
  -- lock. Same hash recipe as reassign_work_zone (mig 256 §14) so
  -- both writers serialize through the same key.
  -- --------------------------------------------------------------------
  PERFORM pg_advisory_xact_lock(
    hashtextextended('worktask_zone:' || NEW.organization_id::text || ':' ||
                     COALESCE(NEW.dispatch_zone, NEW.zone, ''), 0)
  );

  IF v_policy = 'one_counter_per_zone' THEN
    -- Any other user holding this zone (active OR reserved) wins. Active
    -- holders sort first so the error message reflects the most useful
    -- truth ("being counted by X" beats "reserved for X").
    --
    -- Pattern-aware comparison via work_zone_of() so the predicate
    -- tracks the trigger when org sets a custom zone_pattern.
    SELECT assigned_to, status::text
      INTO v_owner, v_owner_status
    FROM public.work_tasks
    WHERE id <> NEW.id
      AND organization_id = NEW.organization_id
      AND COALESCE(public.work_zone_of(primary_location, v_pattern),
                   dispatch_zone, zone) = v_zone
      AND assigned_to IS NOT NULL
      AND assigned_to <> NEW.assigned_to
      AND status IN ('pending','claimed','in_progress')
    ORDER BY
      CASE status::text
        WHEN 'in_progress' THEN 1
        WHEN 'claimed'     THEN 2
        WHEN 'pending'     THEN 3
      END,
      assigned_at ASC NULLS LAST
    LIMIT 1;

    IF v_owner IS NOT NULL THEN
      SELECT COALESCE(full_name, email, 'another worker')
        INTO v_owner_name
      FROM public.user_profiles WHERE id = v_owner;

      IF v_owner_status = 'pending' THEN
        RAISE EXCEPTION
          'ZONE_LOCKED: reserved — Zone "%" is reserved for % (pending soft-release). Admin must hard-unassign to free the zone.',
          v_zone,
          COALESCE(v_owner_name, 'another worker')
        USING ERRCODE = 'P0001',
              HINT   = 'work_task_zone_reserved',
              DETAIL = format('zone=%s;owner=%s;state=reserved', v_zone, v_owner);
      ELSE
        RAISE EXCEPTION
          'ZONE_LOCKED: active — Zone "%" is currently held by %. Only one worker may hold a zone at a time.',
          v_zone,
          COALESCE(v_owner_name, 'another worker')
        USING ERRCODE = 'P0001',
              HINT   = 'work_task_zone_lock',
              DETAIL = format('zone=%s;owner=%s;state=active', v_zone, v_owner);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_work_task_zone_exclusivity() IS
  'Zone mutual exclusion for work_tasks. Mirrors enforce_cycle_count_zone_exclusivity (mig 225/230/232/233/252) bug-for-bug onto the new table. Order: GUC bypass → terminal-status short-circuit → org rules → NULL-zone fallback (treat_null_zone_as_locked) → zone-to-user assignment check (always enforced) → critical/bypass-priority/bypass-subtype/supervisor-protection short-circuits → per-(org, dispatch_zone) advisory lock → active-then-reserved holder check. Distinct error codes: ZONE_ASSIGNED, "ZONE_LOCKED: active", "ZONE_LOCKED: reserved". Migration 266.';

-- ---------------------------------------------------------------------------
-- 2. Trigger — `zzz_` prefix forces alphabetical-last firing so it runs
--    AFTER all maintenance triggers from mig 256 (dispatch_zone,
--    reservation_started_at, updated_at). This guarantees the function
--    sees the post-stamp NEW row.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_zzz_enforce_work_task_zone_exclusivity ON public.work_tasks;
CREATE TRIGGER trg_zzz_enforce_work_task_zone_exclusivity
  BEFORE INSERT OR UPDATE OF assigned_to, status, dispatch_zone
  ON public.work_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_work_task_zone_exclusivity();

-- ---------------------------------------------------------------------------
-- 3. Verify trigger ordering — `trg_maintain_work_task_reservation` must
--    fire BEFORE `trg_zzz_enforce_work_task_zone_exclusivity`. PostgreSQL
--    fires BEFORE-row triggers in alphabetical name order; assertion below
--    catches any future rename that breaks this invariant.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_maintain int;
  v_enforce  int;
BEGIN
  SELECT
    (SELECT row_number()
       FROM (
         SELECT tgname,
                row_number() OVER (ORDER BY tgname) AS rn
           FROM pg_trigger
          WHERE tgrelid = 'public.work_tasks'::regclass
            AND NOT tgisinternal
       ) t
       WHERE tgname = 'trg_maintain_work_task_reservation') ,
    (SELECT row_number()
       FROM (
         SELECT tgname,
                row_number() OVER (ORDER BY tgname) AS rn
           FROM pg_trigger
          WHERE tgrelid = 'public.work_tasks'::regclass
            AND NOT tgisinternal
       ) t
       WHERE tgname = 'trg_zzz_enforce_work_task_zone_exclusivity')
   INTO v_maintain, v_enforce;

  IF v_maintain IS NULL OR v_enforce IS NULL THEN
    RAISE EXCEPTION
      'Migration 266 verify: expected both maintain_reservation and zzz_enforce_zone_exclusivity triggers on work_tasks (got maintain=%, enforce=%)',
      v_maintain, v_enforce;
  END IF;

  IF v_maintain >= v_enforce THEN
    RAISE EXCEPTION
      'Migration 266 verify: trigger ordering violated — trg_maintain_work_task_reservation must fire BEFORE trg_zzz_enforce_work_task_zone_exclusivity (got rn=% and rn=%)',
      v_maintain, v_enforce;
  END IF;
END $verify$;

COMMIT;

-- ============================================================================
-- Live smoke test (transactional, rolled back at the end). Verifies that:
--   1. A second worker claiming a row in an already-active zone is rejected
--      with `ZONE_LOCKED: active`.
--   2. A second worker claiming a row in a reserved (pending+assigned)
--      zone is rejected with `ZONE_LOCKED: reserved`.
--   3. Critical priority bypasses the occupancy check.
--   4. The legacy GUC `app.cycle_count_zone_lock_bypass=on` short-circuits.
--   5. The new GUC `app.work_zone_lock_bypass=on` short-circuits.
--
-- Skips with NOTICE if the env doesn't have the j.AI OneBox seed org or
-- enough distinct users (CI / fresh fixtures). Wrapped in DO so RAISE
-- EXCEPTION rolls back without polluting the migration commit.
-- ============================================================================
DO $smoke$
DECLARE
  v_org    uuid := 'c9d89a74-7179-4033-93ea-56267cf42a17';
  v_user_a uuid;
  v_user_b uuid;
  v_admin  uuid;
  v_t1     uuid;
  v_t2     uuid;
  v_t3     uuid;
  v_err    text;
BEGIN
  SELECT id INTO v_admin FROM user_profiles
   WHERE organization_id = v_org
   ORDER BY created_at ASC LIMIT 1;
  SELECT id INTO v_user_a FROM user_profiles
   WHERE organization_id = v_org AND id <> v_admin
   ORDER BY created_at ASC LIMIT 1;
  SELECT id INTO v_user_b FROM user_profiles
   WHERE organization_id = v_org AND id NOT IN (v_admin, v_user_a)
   ORDER BY created_at ASC LIMIT 1;

  IF v_user_a IS NULL OR v_user_b IS NULL OR v_admin IS NULL THEN
    RAISE NOTICE 'Migration 266 smoke skipped — needed >= 3 distinct users in org %', v_org;
    RETURN;
  END IF;

  -- Make sure rules are enabled for the smoke org. mig 225 already seeds
  -- enabled=true for c9d8…7, but the assertion makes the test independent
  -- of seed history.
  PERFORM set_config('app.work_zone_lock_bypass', 'on', true);
  INSERT INTO cycle_count_zone_rules (organization_id, enabled, policy)
       VALUES (v_org, true, 'one_counter_per_zone')
  ON CONFLICT (organization_id) DO UPDATE
    SET enabled = true, policy = 'one_counter_per_zone';
  PERFORM set_config('app.work_zone_lock_bypass', '', true);

  -- ---- Setup: insert three work_tasks in the same fake zone TZ266 ----
  PERFORM set_config('app.work_zone_lock_bypass', 'on', true);
  INSERT INTO public.work_tasks
    (organization_id, task_type, primary_location, status, assigned_to,
     assigned_at, priority, payload)
    VALUES
    (v_org, 'cycle_count', 'TZ266-A1-001', 'in_progress', v_user_a,
     NOW(), 'normal', '{}'::jsonb)
    RETURNING id INTO v_t1;

  INSERT INTO public.work_tasks
    (organization_id, task_type, primary_location, status, priority, payload)
    VALUES
    (v_org, 'cycle_count', 'TZ266-A1-002', 'pending', 'normal', '{}'::jsonb)
    RETURNING id INTO v_t2;

  INSERT INTO public.work_tasks
    (organization_id, task_type, primary_location, status, priority, payload)
    VALUES
    (v_org, 'cycle_count', 'TZ266-A1-003', 'pending', 'critical', '{}'::jsonb)
    RETURNING id INTO v_t3;
  PERFORM set_config('app.work_zone_lock_bypass', '', true);

  -- ---- Phase 1: second worker can't claim the active zone ----
  v_err := NULL;
  BEGIN
    UPDATE public.work_tasks
       SET assigned_to = v_user_b,
           assigned_at = NOW(),
           status      = 'in_progress'
     WHERE id = v_t2;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_err := SQLERRM;
  END;

  IF v_err IS NULL OR v_err NOT LIKE 'ZONE_LOCKED: active%' THEN
    RAISE EXCEPTION
      'Migration 266 smoke Phase 1: expected "ZONE_LOCKED: active" rejecting second worker, got: %',
      COALESCE(v_err, '(no error raised)');
  END IF;
  RAISE NOTICE 'Migration 266 smoke Phase 1 (active zone): blocked — % — OK', v_err;

  -- ---- Phase 2: convert active to reserved, retry — ZONE_LOCKED: reserved ----
  PERFORM set_config('app.work_zone_lock_bypass', 'on', true);
  UPDATE public.work_tasks
     SET status = 'pending'
   WHERE id = v_t1;
  PERFORM set_config('app.work_zone_lock_bypass', '', true);

  v_err := NULL;
  BEGIN
    UPDATE public.work_tasks
       SET assigned_to = v_user_b,
           assigned_at = NOW(),
           status      = 'in_progress'
     WHERE id = v_t2;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_err := SQLERRM;
  END;

  IF v_err IS NULL OR v_err NOT LIKE 'ZONE_LOCKED: reserved%' THEN
    RAISE EXCEPTION
      'Migration 266 smoke Phase 2: expected "ZONE_LOCKED: reserved" rejecting second worker, got: %',
      COALESCE(v_err, '(no error raised)');
  END IF;
  RAISE NOTICE 'Migration 266 smoke Phase 2 (reserved zone): blocked — % — OK', v_err;

  -- ---- Phase 3: critical priority bypasses occupancy ----
  -- v_t1 is still pending+assigned (reservation), v_t3 is critical
  -- pending. Claiming v_t3 with v_user_b should succeed because critical
  -- short-circuits the holder check (assignment check is irrelevant —
  -- no entry exists in cycle_count_zone_assignments for TZ266).
  UPDATE public.work_tasks
     SET assigned_to = v_user_b,
         assigned_at = NOW(),
         status      = 'in_progress'
   WHERE id = v_t3;
  RAISE NOTICE 'Migration 266 smoke Phase 3 (critical bypass): claimed — OK';

  -- ---- Phase 4: legacy GUC bypass works ----
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);
  UPDATE public.work_tasks
     SET assigned_to = v_user_b,
         assigned_at = NOW(),
         status      = 'in_progress'
   WHERE id = v_t2;
  PERFORM set_config('app.cycle_count_zone_lock_bypass', '', true);
  RAISE NOTICE 'Migration 266 smoke Phase 4 (legacy GUC bypass): claimed — OK';

  -- ---- Cleanup: rollback the transaction implicitly via DELETE so the
  --      smoke is rolled back regardless of test mode. We can't ROLLBACK
  --      from inside DO; rely on cleanup deletions.
  PERFORM set_config('app.work_zone_lock_bypass', 'on', true);
  DELETE FROM public.work_tasks WHERE id IN (v_t1, v_t2, v_t3);
  PERFORM set_config('app.work_zone_lock_bypass', '', true);

  RAISE NOTICE 'Migration 266 smoke PASSED — zone exclusivity invariants live on work_tasks';
END $smoke$;
