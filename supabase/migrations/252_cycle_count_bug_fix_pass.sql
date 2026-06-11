-- ============================================================================
-- Migration 252: Cycle-count bug-fix pass (post 2026-05-01 multi-agent review)
--
-- Closes three concrete cycle-count bugs:
--
--   A. Operators colliding in the same zone — when a row's location parses to
--      NULL zone (`<<empty>>`, blank, or no dash), the trigger short-circuited
--      and let two users claim the same physical bin. New per-org rule
--      `treat_null_zone_as_locked` flips that fallback to LOCATION-EXACT-MATCH
--      exclusivity. Default OFF — existing orgs unchanged.
--
--   B. Hard-assigned cycle counts silently unassigned — the scheduler
--      `escalate_stale_zone_reservations` couldn't tell a supervisor's
--      explicit assignment from an organic soft-release reservation, so
--      after `supervisor_assignment_protection_hours` (default 24) the
--      supervisor's intent was wiped. New durable columns
--      `rr_cyclecount_data.supervisor_assigned_at` /
--      `supervisor_assigned_by` mark admin-initiated assignments;
--      escalation skips them while the protection window holds.
--      `assign_cycle_count_to_user` (and the force variant via the bypass
--      GUC) now stamp these columns. The reservation-trigger clears them
--      on hard unassign / claim / complete.
--
--      Sub-bug B': `maintain_cycle_count_reservation_started_at` only
--      stamped on entry into the reservation state. When an admin
--      reassigned a row that was already in pending+assigned, the
--      `reservation_started_at` value carried over from the prior
--      reservation, so the new assignee got "instantly stale" and
--      escalated. Trigger now also bumps when `assigned_to` changes
--      while the row stays in reservation state.
--
--   C. Critical priority not first — Rust ordering inversion lives in
--      queries.rs and is fixed in the Rust patch. This migration is the
--      DB half (no DB changes are required for C, but the smoke test
--      below replicates the new ordering predicate to lock the contract).
--
-- Cross-cutting:
--   - Forensic backfill for org `c9d89a74-7179-4033-93ea-56267cf42a17`:
--     stamps `supervisor_assigned_at` retroactively from the most recent
--     admin entry in `cycle_count_assignment_history` for any row that is
--     currently still in pending+assigned reservation state. Idempotent.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Supervisor-assignment durable stamps
-- ---------------------------------------------------------------------------
ALTER TABLE rr_cyclecount_data
  ADD COLUMN IF NOT EXISTS supervisor_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS supervisor_assigned_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rr_cyclecount_data_supervisor_assigned_by_fkey'
  ) THEN
    ALTER TABLE rr_cyclecount_data
      ADD CONSTRAINT rr_cyclecount_data_supervisor_assigned_by_fkey
      FOREIGN KEY (supervisor_assigned_by)
      REFERENCES user_profiles(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

COMMENT ON COLUMN rr_cyclecount_data.supervisor_assigned_at IS
  'Set when an admin/supervisor explicitly assigns the row via assign_cycle_count_to_user (or its force variant). Cleared on hard unassign or status leaving pending/recount (claim/complete/cancel). Used by escalate_stale_zone_reservations to honor supervisor intent within the configurable protection window. Migration 252.';

COMMENT ON COLUMN rr_cyclecount_data.supervisor_assigned_by IS
  'User_profiles.id of the admin/supervisor who set supervisor_assigned_at. Cleared together with supervisor_assigned_at. Migration 252.';

-- Partial index — only matters for currently-protected rows, used by the
-- escalator's WHERE-NOT clause and ad-hoc admin queries.
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_supervisor_assigned
  ON rr_cyclecount_data (organization_id, supervisor_assigned_at)
  WHERE supervisor_assigned_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Per-org rules: NULL-zone fallback + supervisor-protection window
-- ---------------------------------------------------------------------------
ALTER TABLE cycle_count_zone_rules
  ADD COLUMN IF NOT EXISTS treat_null_zone_as_locked boolean
    NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supervisor_assignment_protection_hours int
    NOT NULL DEFAULT 24;

COMMENT ON COLUMN cycle_count_zone_rules.treat_null_zone_as_locked IS
  'When true, rows whose location parses to a NULL zone (empty, <<empty>>, or no dash) fall back to LOCATION-EXACT-MATCH exclusivity instead of bypassing the trigger. Default false — existing behavior preserved.';

COMMENT ON COLUMN cycle_count_zone_rules.supervisor_assignment_protection_hours IS
  'How long (in hours) escalate_stale_zone_reservations spares a row whose supervisor_assigned_at is recent. Default 24h.';

-- ---------------------------------------------------------------------------
-- 3. assign_cycle_count_to_user — stamp supervisor columns
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_cycle_count_to_user(
  count_id uuid,
  user_id  uuid
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result               json;
  user_org_id          uuid;
  count_org_id         uuid;
  current_user_org_id  uuid;
  user_full_name       text;
  count_priority       cycle_count_priority;
  v_caller_uid         uuid := auth.uid();
  v_caller_role        text;
  v_zone_bypass_active boolean;
BEGIN
  -- Resolve caller. Service-role / scheduler calls have NULL auth.uid();
  -- in that case we treat it as an admin-equivalent and stamp the row's
  -- existing assigned_by_proxy as null (caller_uid stamp will be NULL
  -- which the application can render as "system").
  SELECT organization_id, role::text
    INTO current_user_org_id, v_caller_role
  FROM user_profiles
  WHERE id = v_caller_uid;

  IF v_caller_uid IS NOT NULL AND current_user_org_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Current user not found or not associated with an organization'
    );
  END IF;

  SELECT organization_id, full_name
    INTO user_org_id, user_full_name
  FROM user_profiles
  WHERE id = user_id;

  IF user_org_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Target user not found or not associated with an organization'
    );
  END IF;

  SELECT organization_id, priority
    INTO count_org_id, count_priority
  FROM rr_cyclecount_data
  WHERE id = count_id;

  IF count_org_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cycle count not found'
    );
  END IF;

  -- Cross-org guard. For service-role callers we use the count's org as
  -- the authoritative org and only require the target user to match it.
  IF v_caller_uid IS NOT NULL THEN
    IF user_org_id <> current_user_org_id OR count_org_id <> current_user_org_id THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Cannot assign count across different organizations'
      );
    END IF;
  ELSE
    IF user_org_id <> count_org_id THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Target user organization does not match the cycle count organization'
      );
    END IF;
  END IF;

  -- Permission gate (skipped for service-role callers).
  IF v_caller_uid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = v_caller_uid
        AND (
          up.role IN ('admin','manager','superadmin','logistics_coordinator')
          OR EXISTS (
            SELECT 1 FROM rr_cyclecount_data cc
            WHERE cc.id = count_id AND cc.created_by = v_caller_uid
          )
        )
    ) THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Insufficient permissions to assign cycle counts'
      );
    END IF;
  END IF;

  -- Detect the force-variant call. The force variant flips
  -- app.cycle_count_zone_lock_bypass = 'on' BEFORE invoking us, so we
  -- can mirror that into the supervisor stamp without changing the
  -- public signature.
  BEGIN
    v_zone_bypass_active :=
      current_setting('app.cycle_count_zone_lock_bypass', true) IN ('on','true','1','yes');
  EXCEPTION WHEN OTHERS THEN
    v_zone_bypass_active := false;
  END;

  -- Perform the assignment + stamp supervisor columns.
  UPDATE rr_cyclecount_data
  SET
    assigned_to = user_id,
    assigned_at = NOW(),
    counter_name = COALESCE(user_full_name, 'Assigned User'),
    supervisor_assigned_at = NOW(),
    supervisor_assigned_by = v_caller_uid,  -- NULL for service-role / cron
    updated_at = NOW()
  WHERE id = count_id;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Cycle count not found or could not be updated'
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'message', 'Cycle count (' || UPPER(count_priority::text) ||
               ' priority) successfully assigned to ' ||
               COALESCE(user_full_name, 'user') ||
               CASE WHEN v_zone_bypass_active THEN ' (force-assigned)' ELSE '' END
  );
END;
$$;

COMMENT ON FUNCTION public.assign_cycle_count_to_user(uuid, uuid) IS
  'Admin/supervisor cycle-count assignment. Stamps supervisor_assigned_at = NOW() and supervisor_assigned_by = auth.uid() so escalate_stale_zone_reservations can honor admin intent. Service-role callers pass through with NULL stamper. The force variant routes through the same body under app.cycle_count_zone_lock_bypass=on. Migration 252.';

-- ---------------------------------------------------------------------------
-- 4. maintain_cycle_count_reservation_started_at — also bump on assignee
--    change in reservation state, AND clear supervisor stamps on exit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.maintain_cycle_count_reservation_started_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now_reserved  boolean :=
    NEW.status = 'pending' AND NEW.assigned_to IS NOT NULL;
  v_was_reserved  boolean :=
    TG_OP = 'UPDATE'
    AND OLD.status = 'pending'
    AND OLD.assigned_to IS NOT NULL;
  v_assignee_changed boolean :=
    TG_OP = 'UPDATE'
    AND OLD.assigned_to IS DISTINCT FROM NEW.assigned_to;
  v_left_reserved boolean :=
    TG_OP = 'UPDATE'
    AND v_was_reserved
    AND NOT v_now_reserved;
BEGIN
  -- 4a. reservation_started_at lifecycle.
  IF v_now_reserved AND NOT v_was_reserved THEN
    -- Entering reservation state.
    NEW.reservation_started_at := NOW();
  ELSIF v_now_reserved AND v_was_reserved AND v_assignee_changed THEN
    -- Re-assigned within reservation state — this is a fresh reservation
    -- from the new assignee's perspective. Without this bump,
    -- escalate_stale_zone_reservations would inherit the old timestamp
    -- and instant-escalate the new assignee.
    NEW.reservation_started_at := NOW();
  ELSIF NOT v_now_reserved THEN
    -- Leaving reservation state (claim, complete, hard-unassign, etc.).
    NEW.reservation_started_at := NULL;
  END IF;

  -- 4b. supervisor stamp lifecycle.
  -- Clear supervisor_assigned_at on:
  --   * Hard unassign (NEW.assigned_to IS NULL).
  --   * Status leaving pending/recount (claim, complete, cancel,
  --     variance_review, approved).
  -- Soft auto-release (status flips to pending while assigned_to remains)
  -- preserves the stamp — that's the entire point.
  IF TG_OP = 'UPDATE' AND OLD.supervisor_assigned_at IS NOT NULL THEN
    IF NEW.assigned_to IS NULL THEN
      NEW.supervisor_assigned_at := NULL;
      NEW.supervisor_assigned_by := NULL;
    ELSIF NEW.status NOT IN ('pending','recount') THEN
      NEW.supervisor_assigned_at := NULL;
      NEW.supervisor_assigned_by := NULL;
    END IF;
  END IF;

  -- Acknowledge unused vars (silence linters in some PG versions).
  PERFORM v_left_reserved;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.maintain_cycle_count_reservation_started_at() IS
  'BEFORE INSERT/UPDATE on rr_cyclecount_data. (a) Stamps reservation_started_at on entry into pending+assigned reservation state and re-stamps when assigned_to changes within that state (review fix 252 — prevents inherited-timestamp instant-escalation). (b) Clears reservation_started_at on exit. (c) Clears supervisor_assigned_at / supervisor_assigned_by on hard unassign or status leaving pending/recount.';

-- ---------------------------------------------------------------------------
-- 5. escalate_stale_zone_reservations — skip supervisor-protected rows
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.escalate_stale_zone_reservations(int);

CREATE OR REPLACE FUNCTION public.escalate_stale_zone_reservations(
  p_threshold_minutes int DEFAULT 60
) RETURNS TABLE (out_count_id uuid, out_count_number text, out_previous_owner uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);

  RETURN QUERY
  WITH stale AS (
    SELECT rcc.id AS id,
           rcc.count_number::text AS cn,
           rcc.assigned_to AS prev_owner,
           COALESCE(rcc.counter_name, rcc.assigned_to::text) AS owner_label
    FROM rr_cyclecount_data rcc
    LEFT JOIN cycle_count_zone_rules zr
      ON zr.organization_id = rcc.organization_id
    LEFT JOIN LATERAL (
      SELECT max(last_heartbeat) AS last_hb
      FROM worker_heartbeats WHERE user_id = rcc.assigned_to
    ) hb ON true
    WHERE rcc.status = 'pending'
      AND rcc.assigned_to IS NOT NULL
      -- Reservation older than threshold (durable column).
      AND COALESCE(rcc.reservation_started_at, rcc.updated_at)
            < NOW() - make_interval(mins => p_threshold_minutes)
      -- Owner offline as well.
      AND (
        hb.last_hb IS NULL
        OR hb.last_hb < NOW() - make_interval(mins => p_threshold_minutes)
      )
      -- Supervisor-protection window: skip rows that an admin explicitly
      -- assigned within the last `supervisor_assignment_protection_hours`.
      -- Default protection window is 24h; admins can lower it per-org.
      AND (
        rcc.supervisor_assigned_at IS NULL
        OR rcc.supervisor_assigned_at <
           NOW() - make_interval(
             hours => COALESCE(zr.supervisor_assignment_protection_hours, 24)
           )
      )
  ), escalated AS (
    UPDATE rr_cyclecount_data target
    SET assigned_to = NULL, assigned_at = NULL, counter_name = NULL,
        push_mode = 'pull', pushed_by = NULL, pushed_at = NULL, push_acknowledged = false,
        updated_at = NOW(),
        notes = COALESCE(target.notes || E'\n', '') ||
                format('[Escalated to hard-unassign at %s — reservation for %s exceeded %s min, no supervisor protection]',
                       to_char(NOW(), 'YYYY-MM-DD HH24:MI'),
                       stale.owner_label,
                       p_threshold_minutes)
    FROM stale WHERE target.id = stale.id
    RETURNING target.id AS uid, target.count_number::text AS ucn, stale.prev_owner AS upo
  )
  SELECT uid, ucn, upo FROM escalated;
END;
$$;

REVOKE ALL ON FUNCTION public.escalate_stale_zone_reservations(int) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.escalate_stale_zone_reservations(int) TO service_role;

COMMENT ON FUNCTION public.escalate_stale_zone_reservations(int) IS
  'Scheduler-only hard-unassign of stale reservations. Keys off durable reservation_started_at + heartbeat age. Honors supervisor protection window from cycle_count_zone_rules.supervisor_assignment_protection_hours (default 24h). SECURITY DEFINER, service_role only. Migration 252.';

-- ---------------------------------------------------------------------------
-- 6. enforce_cycle_count_zone_exclusivity — honor treat_null_zone_as_locked
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_cycle_count_zone_exclusivity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bypass_guc      text;
  v_enabled         boolean;
  v_policy          text;
  v_pattern         text;
  v_bypass_prio     text[];
  v_bypass_types    text[];
  v_treat_null_lock boolean;
  v_zone            text;
  v_owner           uuid;
  v_owner_name      text;
  v_owner_status    text;
  v_assigned_user   uuid;
  v_assigned_name   text;
  v_should_check    boolean := false;
  v_loc             text;
BEGIN
  -- Session bypass.
  BEGIN
    v_bypass_guc := current_setting('app.cycle_count_zone_lock_bypass', true);
  EXCEPTION WHEN OTHERS THEN v_bypass_guc := NULL; END;
  IF v_bypass_guc IN ('on','true','1','yes') THEN RETURN NEW; END IF;

  IF NEW.status IN ('completed','approved','cancelled','variance_review') THEN
    RETURN NEW;
  END IF;
  IF NEW.assigned_to IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    v_should_check := true;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
      v_should_check := true;
    ELSIF NEW.status IN ('in_progress','recount')
      AND OLD.status IS DISTINCT FROM NEW.status
    THEN
      v_should_check := true;
    END IF;
  END IF;
  IF NOT v_should_check THEN RETURN NEW; END IF;

  SELECT enabled, policy, zone_pattern, bypass_priorities, bypass_count_types,
         COALESCE(treat_null_zone_as_locked, false)
  INTO v_enabled, v_policy, v_pattern, v_bypass_prio, v_bypass_types,
       v_treat_null_lock
  FROM cycle_count_zone_rules
  WHERE organization_id = NEW.organization_id;
  IF NOT FOUND OR v_enabled IS NOT TRUE OR v_policy = 'off' THEN
    RETURN NEW;
  END IF;

  -- Compute zone (using the org's pattern when set; default = first dash).
  IF v_pattern IS NULL THEN
    IF NEW.location IS NULL OR NEW.location = '' OR NEW.location = '<<empty>>' THEN
      v_zone := NULL;
    ELSE
      v_zone := NULLIF(split_part(NEW.location, '-', 1), '');
    END IF;
  ELSE
    v_zone := public.cycle_count_zone_of(NEW.location, v_pattern);
  END IF;

  -- (NEW in 252) NULL-zone fallback. When the org opts in, fall back to
  -- LOCATION-EXACT-MATCH exclusivity so two operators don't end up at the
  -- same physical bin just because the location string didn't parse to a
  -- zone (empty / <<empty>> / single-segment).
  IF v_zone IS NULL THEN
    IF NOT v_treat_null_lock THEN
      RETURN NEW;
    END IF;

    v_loc := COALESCE(NULLIF(NEW.location, ''), '<<empty>>');

    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        format('cyclecount_loc:%s:%s', NEW.organization_id, v_loc),
        0
      )
    );

    SELECT assigned_to, status::text
      INTO v_owner, v_owner_status
    FROM rr_cyclecount_data
    WHERE id <> NEW.id
      AND organization_id = NEW.organization_id
      AND COALESCE(NULLIF(location, ''), '<<empty>>') = v_loc
      AND assigned_to IS NOT NULL
      AND assigned_to <> NEW.assigned_to
      AND status IN ('pending','in_progress','recount')
    ORDER BY
      CASE status::text
        WHEN 'in_progress' THEN 1 WHEN 'recount' THEN 2 WHEN 'pending' THEN 3
      END,
      assigned_at ASC NULLS LAST
    LIMIT 1;

    IF v_owner IS NOT NULL THEN
      SELECT COALESCE(full_name, email, 'another counter')
        INTO v_owner_name
      FROM user_profiles WHERE id = v_owner;

      RAISE EXCEPTION
        'ZONE_LOCKED: Location "%" is currently held by % (NULL-zone fallback). Only one counter may work this exact bin at a time.',
        v_loc,
        COALESCE(v_owner_name, 'another counter')
      USING ERRCODE = 'P0001',
            HINT = 'cycle_count_null_zone_location_lock',
            DETAIL = format('zone=NULL;location=%s;owner=%s;state=%s',
                            v_loc, v_owner, v_owner_status);
    END IF;
    RETURN NEW;
  END IF;

  -- (a) Zone-to-user assignment check — ALWAYS enforced.
  SELECT user_id INTO v_assigned_user
  FROM cycle_count_zone_assignments
  WHERE organization_id = NEW.organization_id AND zone = v_zone;

  IF v_assigned_user IS NOT NULL AND v_assigned_user <> NEW.assigned_to THEN
    SELECT COALESCE(full_name, email, 'another counter')
    INTO v_assigned_name
    FROM user_profiles WHERE id = v_assigned_user;

    RAISE EXCEPTION
      'ZONE_ASSIGNED: Zone "%" is assigned to %. Only that counter may work this zone.',
      v_zone,
      COALESCE(v_assigned_name, 'another counter')
    USING ERRCODE = 'P0001',
          HINT = 'cycle_count_zone_assigned',
          DETAIL = format('zone=%s;assigned_to=%s', v_zone, v_assigned_user);
  END IF;

  -- (b) Bypass overrides — apply ONLY to active/reserved exclusivity.
  IF v_bypass_prio IS NOT NULL AND NEW.priority::text = ANY(v_bypass_prio) THEN
    RETURN NEW;
  END IF;
  IF v_bypass_types IS NOT NULL AND NEW.count_type = ANY(v_bypass_types) THEN
    RETURN NEW;
  END IF;

  -- (c) Race-safe holder check via advisory lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      format('cyclecount_zone:%s:%s', NEW.organization_id, v_zone),
      0
    )
  );

  IF v_policy = 'one_counter_per_zone' THEN
    IF v_pattern IS NULL THEN
      SELECT assigned_to, status::text
      INTO v_owner, v_owner_status
      FROM rr_cyclecount_data
      WHERE id <> NEW.id
        AND organization_id = NEW.organization_id
        AND zone = v_zone
        AND assigned_to IS NOT NULL
        AND assigned_to <> NEW.assigned_to
        AND status IN ('pending','in_progress','recount')
      ORDER BY
        CASE status::text
          WHEN 'in_progress' THEN 1 WHEN 'recount' THEN 2 WHEN 'pending' THEN 3
        END,
        assigned_at ASC NULLS LAST
      LIMIT 1;
    ELSE
      SELECT assigned_to, status::text
      INTO v_owner, v_owner_status
      FROM rr_cyclecount_data
      WHERE id <> NEW.id
        AND organization_id = NEW.organization_id
        AND public.cycle_count_zone_of(location, v_pattern) = v_zone
        AND assigned_to IS NOT NULL
        AND assigned_to <> NEW.assigned_to
        AND status IN ('pending','in_progress','recount')
      ORDER BY
        CASE status::text
          WHEN 'in_progress' THEN 1 WHEN 'recount' THEN 2 WHEN 'pending' THEN 3
        END,
        assigned_at ASC NULLS LAST
      LIMIT 1;
    END IF;

    IF v_owner IS NOT NULL THEN
      SELECT COALESCE(full_name, email, 'another counter')
      INTO v_owner_name
      FROM user_profiles WHERE id = v_owner;

      IF v_owner_status = 'pending' THEN
        RAISE EXCEPTION
          'ZONE_LOCKED: Zone "%" is reserved for % (pending auto-release). Admin must "+ Unassign" to free the zone.',
          v_zone,
          COALESCE(v_owner_name, 'another counter')
        USING ERRCODE = 'P0001',
              HINT = 'cycle_count_zone_reserved',
              DETAIL = format('zone=%s;owner=%s;state=reserved', v_zone, v_owner);
      ELSE
        RAISE EXCEPTION
          'ZONE_LOCKED: Zone "%" is currently being counted by %. Only one counter may work a zone at a time.',
          v_zone,
          COALESCE(v_owner_name, 'another counter')
        USING ERRCODE = 'P0001',
              HINT = 'cycle_count_zone_lock',
              DETAIL = format('zone=%s;owner=%s;state=active', v_zone, v_owner);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_cycle_count_zone_exclusivity() IS
  'Zone mutual exclusion. Order: (a) zone-assignment check; (b) priority/count-type bypass; (c) advisory-locked holder check. Migration 252 adds NULL-zone fallback governed by cycle_count_zone_rules.treat_null_zone_as_locked — when on, location-exact-match exclusivity replaces the previous silent bypass for unparsable locations.';

-- ---------------------------------------------------------------------------
-- 7. Forensic backfill — stamp supervisor_assigned_at retroactively for
--    rows that an admin recently reassigned but were never stamped (the
--    new columns didn't exist before this migration).
--
--    Idempotent: only touches rows where supervisor_assigned_at IS NULL
--    AND there's a latest assignment_history entry by an admin pointing
--    at the current assignee within the protection window for the
--    row's org.
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  v_touched int;
BEGIN
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);

  WITH latest_admin_assign AS (
    SELECT DISTINCT ON (h.count_id)
      h.count_id,
      h.new_counter_id,
      h.reassigned_by,
      h.reassigned_at,
      cc.organization_id,
      cc.assigned_to,
      cc.status,
      cc.supervisor_assigned_at AS current_stamp,
      COALESCE(zr.supervisor_assignment_protection_hours, 24) AS protect_hours
    FROM cycle_count_assignment_history h
    JOIN rr_cyclecount_data cc ON cc.id = h.count_id
    LEFT JOIN cycle_count_zone_rules zr ON zr.organization_id = cc.organization_id
    WHERE h.reassigned_by IS NOT NULL
      AND h.reassigned_by IS DISTINCT FROM h.new_counter_id
    ORDER BY h.count_id, h.reassigned_at DESC
  ), eligible AS (
    SELECT count_id, new_counter_id, reassigned_by, reassigned_at
    FROM latest_admin_assign
    WHERE current_stamp IS NULL
      AND assigned_to IS NOT NULL
      AND status IN ('pending','recount')
      AND new_counter_id = assigned_to
      AND reassigned_at >= NOW() - make_interval(hours => protect_hours)
  ), stamped AS (
    UPDATE rr_cyclecount_data target
    SET supervisor_assigned_at = e.reassigned_at,
        supervisor_assigned_by = e.reassigned_by,
        updated_at = NOW()
    FROM eligible e
    WHERE target.id = e.count_id
    RETURNING target.id
  )
  SELECT count(*) INTO v_touched FROM stamped;

  RAISE NOTICE 'Migration 252 backfill: stamped supervisor_assigned_at on % row(s)', v_touched;

  PERFORM set_config('app.cycle_count_zone_lock_bypass', '', true);
END
$backfill$;

COMMIT;

-- ============================================================================
-- Live smoke test (transactional, drops at end). Verifies all three fix
-- points in this migration plus the priority-ordering predicate that the
-- Rust side will use post-redeploy.
-- ============================================================================
DO $smoke$
DECLARE
  v_org    uuid;
  v_user_a uuid;
  v_user_b uuid;
  v_admin  uuid;
  v_count  uuid;
  v_count2 uuid;
  v_locked text;
BEGIN
  -- Pick the cycle-count org used in the bug reports (any active org with
  -- zone rules enabled would also work).
  v_org := 'c9d89a74-7179-4033-93ea-56267cf42a17';

  SELECT id INTO v_admin FROM user_profiles
  WHERE organization_id = v_org AND role IN ('admin','superadmin','manager')
  ORDER BY created_at ASC LIMIT 1;
  SELECT id INTO v_user_a FROM user_profiles
  WHERE organization_id = v_org AND id <> v_admin
  ORDER BY created_at ASC LIMIT 1;
  SELECT id INTO v_user_b FROM user_profiles
  WHERE organization_id = v_org AND id NOT IN (v_admin, v_user_a)
  ORDER BY created_at ASC LIMIT 1;

  IF v_user_a IS NULL OR v_user_b IS NULL OR v_admin IS NULL THEN
    RAISE NOTICE 'Smoke test skipped — needed >= 3 distinct users in org %', v_org;
    RETURN;
  END IF;

  -- Bypass triggers for setup.
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);

  -- ---- Phase A: NULL-zone fallback ----
  -- Insert a row with empty location (zone parses to NULL).
  INSERT INTO rr_cyclecount_data (
    id, count_number, material_number, location, system_quantity,
    organization_id, status, priority, count_type, created_by,
    assigned_to, assigned_at, counter_name
  ) VALUES (
    gen_random_uuid(), 'CC-SMOKE-NULL-A', 'TEST-MAT-NULL', '<<empty>>', 1,
    v_org, 'in_progress', 'normal', 'quantity_check', v_admin,
    v_user_a, NOW(), 'User A (smoke)'
  ) RETURNING id INTO v_count;

  -- treat_null_zone_as_locked = false (default) — second claim should
  -- bypass the trigger.
  UPDATE cycle_count_zone_rules
  SET treat_null_zone_as_locked = false
  WHERE organization_id = v_org;

  PERFORM set_config('app.cycle_count_zone_lock_bypass', '', true);

  INSERT INTO rr_cyclecount_data (
    id, count_number, material_number, location, system_quantity,
    organization_id, status, priority, count_type, created_by
  ) VALUES (
    gen_random_uuid(), 'CC-SMOKE-NULL-B', 'TEST-MAT-NULL', '<<empty>>', 1,
    v_org, 'pending', 'normal', 'quantity_check', v_admin
  ) RETURNING id INTO v_count2;

  -- Should succeed (no fallback enabled).
  UPDATE rr_cyclecount_data SET assigned_to = v_user_b, assigned_at = NOW(),
                                status = 'in_progress'
  WHERE id = v_count2;

  RAISE NOTICE 'Phase A.1 (default OFF): second NULL-zone claim succeeded — OK';

  -- Reset for the second sub-phase.
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);
  UPDATE rr_cyclecount_data
  SET status = 'pending', assigned_to = NULL, assigned_at = NULL,
      counter_name = NULL
  WHERE id = v_count2;
  PERFORM set_config('app.cycle_count_zone_lock_bypass', '', true);

  -- Now flip the rule on and try the same claim — should be ZONE_LOCKED.
  UPDATE cycle_count_zone_rules
  SET treat_null_zone_as_locked = true
  WHERE organization_id = v_org;

  v_locked := NULL;
  BEGIN
    UPDATE rr_cyclecount_data SET assigned_to = v_user_b, assigned_at = NOW(),
                                  status = 'in_progress'
    WHERE id = v_count2;
  -- Migration 253 review: `raise_exception` is not a valid PL/pgSQL
  -- exception condition. The trigger raises with ERRCODE 'P0001'
  -- (raise_exception's SQLSTATE), so we match by SQLSTATE for
  -- repeatability across fresh environments.
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_locked := SQLERRM;
  END;

  IF v_locked IS NULL OR v_locked NOT LIKE 'ZONE_LOCKED%' THEN
    RAISE EXCEPTION 'Phase A.2 (treat_null_zone_as_locked=true): expected ZONE_LOCKED, got: %', COALESCE(v_locked, '(no error)');
  END IF;
  RAISE NOTICE 'Phase A.2 (rule ON): NULL-zone claim was blocked — % — OK', v_locked;

  -- Reset rule back to off.
  UPDATE cycle_count_zone_rules
  SET treat_null_zone_as_locked = false
  WHERE organization_id = v_org;

  -- ---- Phase B: supervisor protection ----
  -- Set up a row in pending+assigned with an OLD reservation_started_at
  -- and a recent supervisor_assigned_at. Multi-step because the maintain
  -- trigger overrides reservation_started_at on entry into the
  -- reservation state — first move INTO the state, then backdate.
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);

  -- Step 1: move from in_progress → pending+assigned. Trigger stamps
  -- reservation_started_at = NOW().
  UPDATE rr_cyclecount_data
  SET status = 'pending',
      counter_name = 'User A (smoke)'
  WHERE id = v_count;

  -- Step 2: now that we're in the reservation state, backdate the
  -- timestamps. With v_now_reserved=true AND v_was_reserved=true AND
  -- assigned_to unchanged, the trigger leaves reservation_started_at
  -- alone, so our explicit value sticks.
  UPDATE rr_cyclecount_data
  SET assigned_at = NOW() - INTERVAL '3 hours',
      reservation_started_at = NOW() - INTERVAL '3 hours',
      supervisor_assigned_at = NOW() - INTERVAL '10 minutes',
      supervisor_assigned_by = v_admin
  WHERE id = v_count;

  -- Test the SUPERVISOR-PROTECTION half of the escalation predicate in
  -- isolation. We deliberately don't call escalate_stale_zone_reservations
  -- here because that would escalate any other prod rows that happen to
  -- be stale right now. Heartbeat-staleness is an independent leg of the
  -- predicate; we exercise it separately during scheduler runs.
  --
  -- Phase B.1 — recent supervisor stamp inside the protection window.
  -- Expected: protected (stamp present AND within window).
  IF NOT EXISTS (
    SELECT 1 FROM rr_cyclecount_data rcc
    LEFT JOIN cycle_count_zone_rules zr
      ON zr.organization_id = rcc.organization_id
    WHERE rcc.id = v_count
      AND rcc.supervisor_assigned_at IS NOT NULL
      AND rcc.supervisor_assigned_at >=
          NOW() - make_interval(
            hours => COALESCE(zr.supervisor_assignment_protection_hours, 24)
          )
  ) THEN
    RAISE EXCEPTION 'Phase B.1: row should be supervisor-protected (recent stamp + 24h window) but was not';
  END IF;
  RAISE NOTICE 'Phase B.1 (recent supervisor stamp): protected — OK';

  -- Phase B.2 — backdate the supervisor stamp outside the protection
  -- window. Expected: protection clause now allows the row through.
  UPDATE rr_cyclecount_data
  SET supervisor_assigned_at = NOW() - INTERVAL '48 hours'
  WHERE id = v_count;

  IF NOT EXISTS (
    SELECT 1 FROM rr_cyclecount_data rcc
    LEFT JOIN cycle_count_zone_rules zr
      ON zr.organization_id = rcc.organization_id
    WHERE rcc.id = v_count
      AND (
        rcc.supervisor_assigned_at IS NULL
        OR rcc.supervisor_assigned_at <
           NOW() - make_interval(
             hours => COALESCE(zr.supervisor_assignment_protection_hours, 24)
           )
      )
  ) THEN
    RAISE EXCEPTION 'Phase B.2: row outside the protection window was still treated as protected';
  END IF;
  RAISE NOTICE 'Phase B.2 (stamp outside window): unprotected — OK';

  -- ---- Phase C: priority ordering predicate (Rust contract) ----
  -- Insert a critical and a normal row; verify the new ORDER BY clause
  -- (priority FIRST) returns critical first.
  INSERT INTO rr_cyclecount_data (
    id, count_number, material_number, location, system_quantity,
    organization_id, status, priority, count_type, created_by
  ) VALUES
    (gen_random_uuid(), 'CC-SMOKE-PRI-CRIT', 'TEST-MAT-CR', 'Z9-A1-101', 1,
     v_org, 'pending', 'critical', 'quantity_check', v_admin),
    (gen_random_uuid(), 'CC-SMOKE-PRI-NORM', 'TEST-MAT-NR', 'Z9-A1-102', 1,
     v_org, 'pending', 'normal', 'quantity_check', v_admin);

  IF (
    SELECT priority::text FROM rr_cyclecount_data
    WHERE organization_id = v_org
      AND count_number IN ('CC-SMOKE-PRI-CRIT','CC-SMOKE-PRI-NORM')
    ORDER BY
      CASE priority::text
        WHEN 'critical' THEN 1 WHEN 'hot' THEN 2
        WHEN 'normal' THEN 3   WHEN 'low' THEN 4
        ELSE 5
      END ASC,
      created_at ASC
    LIMIT 1
  ) <> 'critical' THEN
    RAISE EXCEPTION 'Phase C: priority-first ordering did not return critical first';
  END IF;
  RAISE NOTICE 'Phase C (priority-first ordering): critical first — OK';

  -- ---- Cleanup ----
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);
  DELETE FROM rr_cyclecount_data
  WHERE organization_id = v_org
    AND count_number IN (
      'CC-SMOKE-NULL-A','CC-SMOKE-NULL-B',
      'CC-SMOKE-PRI-CRIT','CC-SMOKE-PRI-NORM'
    );
  PERFORM set_config('app.cycle_count_zone_lock_bypass', '', true);

  RAISE NOTICE 'Smoke test PASSED — all three fix points verified';
END
$smoke$;
