-- ============================================================================
-- Migration 195: MDM RPC Functions
-- Description: Org-scoped SECURITY DEFINER functions for fleet statistics,
--              device search, compliance summary, and maintenance jobs.
--              All functions use SET search_path = public.
-- ============================================================================

-- =====================================================
-- 1. get_mdm_fleet_statistics
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_mdm_fleet_statistics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_result JSONB;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM user_profiles WHERE id = auth.uid();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No organization context');
  END IF;

  SELECT jsonb_build_object(
    'total_devices', COUNT(*),
    'online_devices', COUNT(*) FILTER (WHERE status = 'Online'),
    'offline_devices', COUNT(*) FILTER (WHERE status = 'Offline'),
    'pending_devices', COUNT(*) FILTER (WHERE status = 'Pending'),
    'lost_devices', COUNT(*) FILTER (WHERE status = 'Lost'),
    'supervised_devices', COUNT(*) FILTER (WHERE supervised = true),
    'average_health_score', COALESCE(ROUND(AVG(health_score)::numeric, 1), 0),
    'average_battery_level', COALESCE(ROUND(AVG(battery_level)::numeric, 1), 0)
  ) INTO v_result
  FROM mdm_devices
  WHERE organization_id = v_org_id
    AND status != 'Retired';

  v_result := v_result || jsonb_build_object(
    'pending_commands', (
      SELECT COUNT(*) FROM mdm_commands
      WHERE organization_id = v_org_id AND status IN ('Queued', 'Approved', 'Sent', 'NotNow')
    ),
    'active_incidents', (
      SELECT COUNT(*) FROM mdm_incidents
      WHERE organization_id = v_org_id AND status IN ('Open', 'Investigating')
    ),
    'pending_approvals', (
      SELECT COUNT(*) FROM mdm_command_approvals ca
      JOIN mdm_commands c ON ca.command_id = c.id
      WHERE c.organization_id = v_org_id AND ca.status = 'Pending'
    ),
    'compliance_rate', (
      SELECT COALESCE(
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE cs.compliant = true) / NULLIF(COUNT(*), 0), 1
        ), 100
      )
      FROM (
        SELECT DISTINCT ON (device_id, policy_id) compliant
        FROM mdm_compliance_snapshots
        WHERE organization_id = v_org_id
        ORDER BY device_id, policy_id, evaluated_at DESC
      ) cs
    )
  );

  RETURN v_result;
END;
$$;

-- =====================================================
-- 2. get_mdm_command_metrics
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_mdm_command_metrics(
  p_days INT DEFAULT 7
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM user_profiles WHERE id = auth.uid();

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No organization context');
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'total_commands', COUNT(*),
      'completed', COUNT(*) FILTER (WHERE status = 'Completed'),
      'failed', COUNT(*) FILTER (WHERE status = 'Failed'),
      'pending', COUNT(*) FILTER (WHERE status IN ('Queued', 'Approved', 'Sent')),
      'expired', COUNT(*) FILTER (WHERE status = 'Expired'),
      'dead_letter', COUNT(*) FILTER (WHERE status = 'DeadLetter'),
      'success_rate', COALESCE(
        ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'Completed') / NULLIF(COUNT(*) FILTER (WHERE status IN ('Completed', 'Failed')), 0), 1),
        100
      ),
      'by_type', (
        SELECT COALESCE(jsonb_object_agg(command_type, cnt), '{}'::jsonb)
        FROM (
          SELECT command_type, COUNT(*) as cnt
          FROM mdm_commands
          WHERE organization_id = v_org_id AND created_at >= NOW() - (p_days || ' days')::interval
          GROUP BY command_type
        ) t
      )
    )
    FROM mdm_commands
    WHERE organization_id = v_org_id
      AND created_at >= NOW() - (p_days || ' days')::interval
  );
END;
$$;

-- =====================================================
-- 3. search_mdm_devices
-- =====================================================

CREATE OR REPLACE FUNCTION public.search_mdm_devices(
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_group_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(
  device JSONB,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM user_profiles WHERE id = auth.uid();

  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT d.*
    FROM mdm_devices d
    WHERE d.organization_id = v_org_id
      AND (p_status IS NULL OR d.status = p_status)
      AND (p_group_id IS NULL OR d.device_group_id = p_group_id)
      AND (p_search IS NULL OR (
        d.device_name ILIKE '%' || p_search || '%' OR
        d.serial_number ILIKE '%' || p_search || '%' OR
        d.model ILIKE '%' || p_search || '%' OR
        d.udid ILIKE '%' || p_search || '%'
      ))
  )
  SELECT
    row_to_json(f)::jsonb AS device,
    (SELECT COUNT(*) FROM filtered)::bigint AS total_count
  FROM filtered f
  ORDER BY f.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- =====================================================
-- 4. expire_stale_commands
-- =====================================================

CREATE OR REPLACE FUNCTION public.expire_stale_commands()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE mdm_commands
  SET status = 'Expired', completed_at = NOW()
  WHERE status IN ('Queued', 'Approved', 'Sent', 'NotNow')
    AND expires_at IS NOT NULL
    AND expires_at < NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- =====================================================
-- 5. recompute_device_health_scores
-- =====================================================

CREATE OR REPLACE FUNCTION public.recompute_device_health_scores()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_device RECORD;
  v_score NUMERIC;
BEGIN
  FOR v_device IN
    SELECT id, battery_level, battery_health,
           total_storage_bytes, available_storage_bytes,
           passcode_compliant, encrypted, os_version,
           last_checkin_at
    FROM mdm_devices
    WHERE status NOT IN ('Retired', 'Wiped')
  LOOP
    v_score := 0;

    IF v_device.battery_level IS NOT NULL THEN
      v_score := v_score + LEAST(v_device.battery_level, 100) * 0.15;
    ELSE
      v_score := v_score + 15;
    END IF;

    IF v_device.total_storage_bytes IS NOT NULL AND v_device.total_storage_bytes > 0 THEN
      v_score := v_score + LEAST(
        (v_device.available_storage_bytes::numeric / v_device.total_storage_bytes * 100), 100
      ) * 0.15;
    ELSE
      v_score := v_score + 15;
    END IF;

    IF v_device.passcode_compliant = true THEN v_score := v_score + 20; END IF;
    IF v_device.encrypted = true THEN v_score := v_score + 20; END IF;

    IF v_device.last_checkin_at IS NOT NULL AND
       v_device.last_checkin_at > NOW() - INTERVAL '24 hours' THEN
      v_score := v_score + 15;
    ELSIF v_device.last_checkin_at IS NOT NULL AND
          v_device.last_checkin_at > NOW() - INTERVAL '72 hours' THEN
      v_score := v_score + 8;
    END IF;

    v_score := v_score + 15;

    UPDATE mdm_devices SET health_score = ROUND(v_score, 1), updated_at = NOW()
    WHERE id = v_device.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
