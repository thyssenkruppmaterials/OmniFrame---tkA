-- ============================================================================
-- Migration 233: Comprehensive zone-engine hardening (post-multi-agent review)
--
-- Closes the remaining integrity gaps identified in the 2026-04-24 review:
--
--   * Race window in enforce_cycle_count_zone_exclusivity: two concurrent
--     claimers could each see "no holder" before either commit. Fix: take
--     a transaction-scoped advisory lock per (organization_id, zone) inside
--     the trigger before checking holders.
--
--   * Bypass priorities / count types incorrectly bypassed explicit
--     cycle_count_zone_assignments (admin "K1 is Nikki's zone" promises).
--     Fix: zone-assignment check fires FIRST and is never bypassable.
--
--   * Reservation lifetime was tracked via notes-regex + updated_at — both
--     brittle. Fix: durable column rr_cyclecount_data.reservation_started_at,
--     stamped on entry into pending+assigned, cleared on exit. Escalation
--     keys off this column instead of regex.
--
--   * v_cycle_count_active_zones grouped on rcc.zone (first dash segment)
--     even for orgs using a custom zone_pattern, which can disagree with
--     the trigger and produce wrong rollups. Fix: join cycle_count_zone_rules
--     and use cycle_count_zone_of(location, zone_pattern).
--
--   * Index idx_rr_cyclecount_zone_active covered only in_progress / recount.
--     Trigger and Rust prefilter now treat pending+assigned as occupying.
--     Fix: idx_rr_cyclecount_zone_holders covers all three statuses.
--
--   * apply_cycle_count_priority_rules(p_org_id) auth: when p_org_id is set,
--     it bypassed the role check entirely. Fix: require service_role caller
--     OR an authenticated user whose role is admin/manager/etc and whose
--     organization_id matches p_org_id.
--
--   * release_stale_heartbeat_assignments / escalate_stale_zone_reservations
--     were SECURITY INVOKER and granted to authenticated, so any user could
--     call them and silently get partial results. Fix: SECURITY DEFINER,
--     scheduler-only, GRANT to service_role only.
--
--   * RLS admin lists in 201 omitted logistics_coordinator. Fix: extend.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. reservation_started_at column
-- ---------------------------------------------------------------------------
ALTER TABLE rr_cyclecount_data
  ADD COLUMN IF NOT EXISTS reservation_started_at timestamptz;

COMMENT ON COLUMN rr_cyclecount_data.reservation_started_at IS
  'Set when the row enters the soft-released pending+assigned reservation state (auto-release or admin Release). Cleared on claim/complete/hard-unassign. Used by escalate_stale_zone_reservations to age out abandoned reservations without depending on notes regex.';

-- Backfill: best-effort from updated_at for currently-reserved rows.
UPDATE rr_cyclecount_data
SET reservation_started_at = updated_at
WHERE status = 'pending'
  AND assigned_to IS NOT NULL
  AND reservation_started_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Stamping trigger — keeps reservation_started_at in sync with state
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.maintain_cycle_count_reservation_started_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now_reserved boolean :=
    NEW.status = 'pending' AND NEW.assigned_to IS NOT NULL;
  v_was_reserved boolean :=
    TG_OP = 'UPDATE'
    AND OLD.status = 'pending'
    AND OLD.assigned_to IS NOT NULL;
BEGIN
  IF v_now_reserved AND NOT v_was_reserved THEN
    -- Entering reservation state.
    NEW.reservation_started_at := NOW();
  ELSIF NOT v_now_reserved THEN
    -- Leaving reservation state (claim, complete, hard-unassign, etc.).
    NEW.reservation_started_at := NULL;
  END IF;
  -- Else: still reserved — keep existing timestamp untouched.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_maintain_reservation_started_at ON rr_cyclecount_data;
CREATE TRIGGER trigger_maintain_reservation_started_at
BEFORE INSERT OR UPDATE OF status, assigned_to ON rr_cyclecount_data
FOR EACH ROW
EXECUTE FUNCTION public.maintain_cycle_count_reservation_started_at();

-- ---------------------------------------------------------------------------
-- 3. Partial index covering active + reserved holders for fast prefilter
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rr_cyclecount_zone_holders
ON rr_cyclecount_data (organization_id, zone, assigned_to)
WHERE assigned_to IS NOT NULL
  AND status IN ('pending', 'in_progress', 'recount');

-- (Old idx_rr_cyclecount_zone_active is still useful for "actively counting"
-- specific queries — keep it. Holders index supplements.)

-- ---------------------------------------------------------------------------
-- 4. Trigger rewrite: advisory lock + bypass order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_cycle_count_zone_exclusivity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bypass_guc    text;
  v_enabled       boolean;
  v_policy        text;
  v_pattern       text;
  v_bypass_prio   text[];
  v_bypass_types  text[];
  v_zone          text;
  v_owner         uuid;
  v_owner_name    text;
  v_owner_status  text;
  v_assigned_user uuid;
  v_assigned_name text;
  v_should_check  boolean := false;
BEGIN
  -- Session bypass is the absolute escape hatch.
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

  SELECT enabled, policy, zone_pattern, bypass_priorities, bypass_count_types
  INTO v_enabled, v_policy, v_pattern, v_bypass_prio, v_bypass_types
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
  IF v_zone IS NULL THEN RETURN NEW; END IF;

  -- ----------------------------------------------------------------
  -- (a) Zone-to-user assignment check — ALWAYS enforced.
  -- Bypass priorities / count types do NOT override an explicit admin
  -- assignment, since admin intent is "this zone is X's territory."
  -- ----------------------------------------------------------------
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

  -- ----------------------------------------------------------------
  -- (b) Bypass overrides — apply ONLY to active/reserved exclusivity
  --     once the zone-assignment gate has been cleared.
  -- ----------------------------------------------------------------
  IF v_bypass_prio IS NOT NULL AND NEW.priority::text = ANY(v_bypass_prio) THEN
    RETURN NEW;
  END IF;
  IF v_bypass_types IS NOT NULL AND NEW.count_type = ANY(v_bypass_types) THEN
    RETURN NEW;
  END IF;

  -- ----------------------------------------------------------------
  -- (c) Race-safe holder check via transaction-scoped advisory lock
  -- on (organization_id, zone). Concurrent claimers serialize through
  -- the lock and only one wins.
  -- ----------------------------------------------------------------
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
      WHERE id != NEW.id
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
      WHERE id != NEW.id
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
  'Zone mutual exclusion. Order: (a) explicit cycle_count_zone_assignments check (always enforced — admin intent overrides bypass); (b) bypass priorities / count types short-circuit; (c) transaction-scoped advisory lock; (d) holder check across pending+assigned (reserved), in_progress, recount. Migration 233.';

-- ---------------------------------------------------------------------------
-- 5. Rewrite v_cycle_count_active_zones to use pattern-derived zone
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_cycle_count_active_zones;

CREATE VIEW v_cycle_count_active_zones
WITH (security_invoker = true)
AS
WITH latest_hb AS (
  SELECT user_id, max(last_heartbeat) AS last_heartbeat
  FROM worker_heartbeats
  GROUP BY user_id
),
zone_rows AS (
  SELECT
    rcc.organization_id,
    -- Use pattern-aware zone when configured, else the materialized column.
    COALESCE(
      public.cycle_count_zone_of(rcc.location, r.zone_pattern),
      rcc.zone
    ) AS zone,
    rcc.assigned_to AS locked_by,
    up.full_name    AS locked_by_name,
    up.email        AS locked_by_email,
    rcc.id          AS count_id,
    rcc.status::text AS status,
    rcc.assigned_at AS acquired_at,
    rcc.reservation_started_at AS reservation_started_at,
    latest_hb.last_heartbeat AS owner_last_heartbeat
  FROM rr_cyclecount_data rcc
  LEFT JOIN cycle_count_zone_rules r ON r.organization_id = rcc.organization_id
  LEFT JOIN user_profiles up ON up.id = rcc.assigned_to
  LEFT JOIN latest_hb ON latest_hb.user_id = rcc.assigned_to
  WHERE rcc.assigned_to IS NOT NULL
    AND rcc.status IN ('pending','in_progress','recount')
)
SELECT
  organization_id,
  zone,
  locked_by,
  locked_by_name,
  locked_by_email,
  count(*) AS active_count_count,
  count(*) FILTER (WHERE status IN ('in_progress','recount')) AS actively_counting,
  count(*) FILTER (WHERE status = 'pending') AS reserved_count,
  min(acquired_at) AS acquired_at,
  array_agg(count_id) AS active_count_ids,
  array_agg(count_id) FILTER (WHERE status IN ('in_progress','recount')) AS active_ids,
  array_agg(count_id) FILTER (WHERE status = 'pending') AS reserved_ids,
  min(reservation_started_at) AS earliest_reservation_at,
  max(owner_last_heartbeat) AS owner_last_heartbeat,
  (max(owner_last_heartbeat) IS NOT NULL AND max(owner_last_heartbeat) >= NOW() - INTERVAL '5 minutes') AS owner_online,
  CASE WHEN max(owner_last_heartbeat) IS NULL THEN NULL
       ELSE EXTRACT(EPOCH FROM (NOW() - max(owner_last_heartbeat))) / 60.0
  END AS minutes_since_seen,
  (max(owner_last_heartbeat) IS NULL OR max(owner_last_heartbeat) < NOW() - INTERVAL '10 minutes') AS is_stuck,
  bool_or(status = 'pending') AS has_reservation,
  bool_or(status IN ('in_progress','recount')) AS has_active
FROM zone_rows
WHERE zone IS NOT NULL
GROUP BY organization_id, zone, locked_by, locked_by_name, locked_by_email;

COMMENT ON VIEW v_cycle_count_active_zones IS
  'Per (org, zone, user) rollup. zone is pattern-aware (cycle_count_zone_rules.zone_pattern when set, else first dash segment via rr_cyclecount_data.zone). actively_counting = in_progress/recount; reserved_count = pending+assigned; earliest_reservation_at uses durable column. (migration 233)';

GRANT SELECT ON v_cycle_count_active_zones TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. apply_cycle_count_priority_rules — auth fix
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_cycle_count_priority_rules(
  p_org_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid  uuid := auth.uid();
  v_caller_role text;
  v_caller_org  uuid;
  v_org_id      uuid;
  v_touched     int;
BEGIN
  -- Resolve target org from explicit param or caller profile.
  IF p_org_id IS NULL THEN
    SELECT role::text, organization_id
      INTO v_caller_role, v_caller_org
    FROM user_profiles WHERE id = v_caller_uid;

    IF v_caller_role NOT IN ('superadmin','admin','manager','logistics_coordinator') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Only supervisors and admins may apply priority rules.'
      );
    END IF;
    v_org_id := v_caller_org;
  ELSE
    -- Caller passed an explicit org. Allowed paths:
    --   (1) service_role call (auth.uid() IS NULL — Rust scheduler / cron)
    --   (2) authenticated admin whose own organization_id matches p_org_id
    IF v_caller_uid IS NOT NULL THEN
      SELECT role::text, organization_id
        INTO v_caller_role, v_caller_org
      FROM user_profiles WHERE id = v_caller_uid;

      IF v_caller_role NOT IN ('superadmin','admin','manager','logistics_coordinator')
         OR v_caller_org IS DISTINCT FROM p_org_id
      THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Cannot apply priority rules outside your organization.'
        );
      END IF;
    END IF;
    v_org_id := p_org_id;
  END IF;

  WITH candidates AS (
    SELECT cc.id, cc.priority::text AS current_priority, cc.zone, cc.count_type, cc.warehouse,
           cc.created_at, cc.variance_percentage,
           COALESCE(cc.requires_recount, false) AS requires_recount
    FROM rr_cyclecount_data cc
    WHERE cc.organization_id = v_org_id
      AND cc.status IN ('pending','recount')
  ), matched AS (
    SELECT DISTINCT ON (c.id) c.id, c.current_priority, r.priority_level AS new_priority
    FROM candidates c
    JOIN cycle_count_priority_rules r
      ON r.organization_id = v_org_id AND r.enabled = true
     AND (r.match_zone IS NULL OR r.match_zone = c.zone)
     AND (r.match_count_type IS NULL OR r.match_count_type = c.count_type)
     AND (r.match_warehouse IS NULL OR r.match_warehouse = c.warehouse)
     AND (r.match_requires_recount IS NULL OR r.match_requires_recount = c.requires_recount)
     AND (r.match_age_gte_hours IS NULL OR EXTRACT(EPOCH FROM (NOW() - c.created_at))/3600.0 >= r.match_age_gte_hours)
     AND (r.match_variance_gte_pct IS NULL OR COALESCE(c.variance_percentage, 0) >= r.match_variance_gte_pct)
    ORDER BY c.id, r.sort_order ASC
  ), updated AS (
    UPDATE rr_cyclecount_data target
    SET priority = m.new_priority::cycle_count_priority, updated_at = NOW()
    FROM matched m
    WHERE target.id = m.id AND target.priority::text <> m.new_priority
    RETURNING target.id
  )
  SELECT count(*) INTO v_touched FROM updated;

  RETURN jsonb_build_object('success', true, 'organization_id', v_org_id, 'touched', v_touched);
END;
$$;

COMMENT ON FUNCTION public.apply_cycle_count_priority_rules(uuid) IS
  'Re-scores cycle counts. With p_org_id NULL, runs against caller''s org and requires admin role. With p_org_id, requires service_role OR an authenticated admin whose org matches.';

-- ---------------------------------------------------------------------------
-- 7. Tighten scheduler-only RPCs: SECURITY DEFINER + service_role-only
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.release_stale_heartbeat_assignments(int);

CREATE OR REPLACE FUNCTION public.release_stale_heartbeat_assignments(
  p_threshold_minutes int DEFAULT 10
) RETURNS TABLE (out_count_id uuid, out_count_number text, out_previous_owner uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.cycle_count_zone_lock_bypass', 'on', true);

  RETURN QUERY
  WITH stuck AS (
    SELECT rcc.id AS id, rcc.count_number::text AS cn, rcc.assigned_to AS prev_owner,
           COALESCE(rcc.counter_name, rcc.assigned_to::text) AS owner_label
    FROM rr_cyclecount_data rcc
    LEFT JOIN LATERAL (
      SELECT max(last_heartbeat) AS last_hb
      FROM worker_heartbeats WHERE user_id = rcc.assigned_to
    ) hb ON true
    WHERE rcc.assigned_to IS NOT NULL
      AND rcc.status IN ('in_progress','recount')
      AND (
        hb.last_hb IS NULL
        OR hb.last_hb < NOW() - make_interval(mins => p_threshold_minutes)
      )
  ), updated AS (
    UPDATE rr_cyclecount_data target
    SET status = 'pending',
        push_mode = 'pull', pushed_by = NULL, pushed_at = NULL, push_acknowledged = false,
        updated_at = NOW(),
        notes = COALESCE(target.notes || E'\n', '') ||
                format('[Auto-released (reserved for %s) at %s — heartbeat stale > %s min]',
                       stuck.owner_label,
                       to_char(NOW(), 'YYYY-MM-DD HH24:MI'),
                       p_threshold_minutes)
    FROM stuck WHERE target.id = stuck.id
    RETURNING target.id AS uid, target.count_number::text AS ucn, stuck.prev_owner AS upo
  )
  SELECT uid, ucn, upo FROM updated;
END;
$$;

REVOKE ALL ON FUNCTION public.release_stale_heartbeat_assignments(int) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.release_stale_heartbeat_assignments(int) TO service_role;

COMMENT ON FUNCTION public.release_stale_heartbeat_assignments(int) IS
  'Scheduler-only soft release. SECURITY DEFINER, granted to service_role only. Migration 233.';

-- escalate_stale_zone_reservations: drop notes-regex, key off the
-- durable reservation_started_at column.
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
    LEFT JOIN LATERAL (
      SELECT max(last_heartbeat) AS last_hb
      FROM worker_heartbeats WHERE user_id = rcc.assigned_to
    ) hb ON true
    WHERE rcc.status = 'pending'
      AND rcc.assigned_to IS NOT NULL
      -- Durable reservation age: column set by maintain_cycle_count_reservation_started_at.
      -- Falls back to updated_at if backfill missed any pre-233 rows.
      AND COALESCE(rcc.reservation_started_at, rcc.updated_at)
            < NOW() - make_interval(mins => p_threshold_minutes)
      AND (
        hb.last_hb IS NULL
        OR hb.last_hb < NOW() - make_interval(mins => p_threshold_minutes)
      )
  ), escalated AS (
    UPDATE rr_cyclecount_data target
    SET assigned_to = NULL, assigned_at = NULL, counter_name = NULL,
        push_mode = 'pull', pushed_by = NULL, pushed_at = NULL, push_acknowledged = false,
        updated_at = NOW(),
        notes = COALESCE(target.notes || E'\n', '') ||
                format('[Escalated to hard-unassign at %s — reservation for %s exceeded %s min]',
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
  'Scheduler-only hard-unassign of stale reservations. Keys off durable reservation_started_at + heartbeat age, no notes regex. SECURITY DEFINER, service_role only. Migration 233.';

-- ---------------------------------------------------------------------------
-- 8. Extend RLS admin lists in 201 to include logistics_coordinator
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view cycle counts in their organization" ON rr_cyclecount_data;
CREATE POLICY "Users can view cycle counts in their organization" ON rr_cyclecount_data
  FOR SELECT USING (
    organization_id IN (
      SELECT user_profiles.organization_id FROM user_profiles WHERE user_profiles.id = auth.uid()
    )
    AND (
      assigned_to IS NULL
      OR assigned_to = auth.uid()
      OR created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM user_profiles up
        WHERE up.id = auth.uid()
          AND up.role IN ('admin','manager','superadmin','logistics_coordinator')
      )
    )
  );

DROP POLICY IF EXISTS "Users can update cycle count data in their organization" ON rr_cyclecount_data;
CREATE POLICY "Users can update cycle count data in their organization" ON rr_cyclecount_data
  FOR UPDATE USING (
    organization_id IN (
      SELECT user_profiles.organization_id FROM user_profiles WHERE user_profiles.id = auth.uid()
    )
    AND (
      assigned_to = auth.uid()
      OR created_by = auth.uid()
      OR status = 'pending'
      OR EXISTS (
        SELECT 1 FROM user_profiles up
        WHERE up.id = auth.uid()
          AND up.role IN ('admin','manager','superadmin','logistics_coordinator')
      )
    )
  );

DROP POLICY IF EXISTS "Users can delete cycle counts in their organization" ON rr_cyclecount_data;
CREATE POLICY "Users can delete cycle counts in their organization" ON rr_cyclecount_data
  FOR DELETE USING (
    organization_id IN (
      SELECT user_profiles.organization_id FROM user_profiles WHERE user_profiles.id = auth.uid()
    )
    AND (
      created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM user_profiles up
        WHERE up.id = auth.uid()
          AND up.role IN ('admin','manager','superadmin','logistics_coordinator')
      )
    )
  );

COMMIT;
