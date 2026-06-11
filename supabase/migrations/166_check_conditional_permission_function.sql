-- Migration: 166_check_conditional_permission_function.sql
-- Description: Database function to check conditional permissions (time-based, day-of-week)
-- Step 13: Wire conditional permissions to the frontend rbacService
-- Created: February 5, 2026

-- ===== CHECK CONDITIONAL PERMISSION FUNCTION =====
-- Checks if a user has a specific permission AND all associated conditions are met.
-- This function:
--   1. Checks basic permission via role_permissions (using user's role_id)
--   2. Falls back to user_permissions if not found in role_permissions
--   3. Evaluates time-based conditions (time-of-day, day-of-week) against NOW()
--   4. Evaluates valid_from / valid_to temporal bounds
--   5. Returns true only if permission is granted AND all conditions pass

CREATE OR REPLACE FUNCTION check_conditional_permission(
  p_user_id UUID,
  p_resource VARCHAR,
  p_action VARCHAR
) RETURNS BOOLEAN AS $$
DECLARE
  v_role_id UUID;
  v_has_basic_permission BOOLEAN := false;
  v_conditions JSONB;
  v_requires_conditions BOOLEAN;
  v_condition_logic TEXT;
  v_valid_from TIMESTAMP;
  v_valid_to TIMESTAMP;
  v_now TIMESTAMP := NOW();
  v_conditions_met BOOLEAN := true;
  v_time_conditions JSONB;
  v_day_ok BOOLEAN := true;
  v_time_ok BOOLEAN := true;
BEGIN
  -- ========================================
  -- Step 1: Get user's role_id
  -- ========================================
  SELECT up.role_id INTO v_role_id
  FROM user_profiles up
  WHERE up.id = p_user_id;

  -- ========================================
  -- Step 2: Check role_permissions for basic permission + conditions
  -- ========================================
  IF v_role_id IS NOT NULL THEN
    SELECT
      true,
      rp.conditions,
      rp.requires_conditions,
      rp.condition_logic,
      rp.valid_from,
      rp.valid_to
    INTO
      v_has_basic_permission,
      v_conditions,
      v_requires_conditions,
      v_condition_logic,
      v_valid_from,
      v_valid_to
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = v_role_id
      AND p.is_active = true
      AND (p.resource = p_resource OR p.resource = '*')
      AND (p.action = p_action OR p.action = '*')
    LIMIT 1;
  END IF;

  -- Also check temporary role assignments
  IF NOT v_has_basic_permission THEN
    SELECT
      true,
      rp.conditions,
      rp.requires_conditions,
      rp.condition_logic,
      rp.valid_from,
      rp.valid_to
    INTO
      v_has_basic_permission,
      v_conditions,
      v_requires_conditions,
      v_condition_logic,
      v_valid_from,
      v_valid_to
    FROM temporary_role_assignments tra
    JOIN role_permissions rp ON rp.role_id = tra.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE tra.user_id = p_user_id
      AND tra.is_active = true
      AND tra.expires_at > v_now
      AND p.is_active = true
      AND (p.resource = p_resource OR p.resource = '*')
      AND (p.action = p_action OR p.action = '*')
    LIMIT 1;
  END IF;

  -- ========================================
  -- Step 3: Fall back to user_permissions (direct grants have no conditions)
  -- ========================================
  IF NOT v_has_basic_permission THEN
    SELECT true INTO v_has_basic_permission
    FROM user_permissions up_perm
    JOIN permissions p ON p.id = up_perm.permission_id
    WHERE up_perm.user_id = p_user_id
      AND up_perm.granted = true
      AND p.is_active = true
      AND (p.resource = p_resource OR p.resource = '*')
      AND (p.action = p_action OR p.action = '*')
      AND (up_perm.expires_at IS NULL OR up_perm.expires_at > v_now)
    LIMIT 1;

    -- Direct user permissions don't have conditions, so return immediately
    IF v_has_basic_permission THEN
      RETURN true;
    ELSE
      RETURN false;
    END IF;
  END IF;

  -- ========================================
  -- Step 4: Evaluate temporal bounds (valid_from / valid_to)
  -- ========================================
  IF v_valid_from IS NOT NULL AND v_now < v_valid_from THEN
    RETURN false;
  END IF;

  IF v_valid_to IS NOT NULL AND v_now > v_valid_to THEN
    RETURN false;
  END IF;

  -- ========================================
  -- Step 5: Evaluate conditions if required
  -- ========================================
  IF v_requires_conditions IS NOT true THEN
    -- No conditions required, basic permission is sufficient
    RETURN true;
  END IF;

  IF v_conditions IS NULL OR v_conditions = '{}'::JSONB THEN
    -- requires_conditions is true but no conditions defined = deny (fail-safe)
    RETURN false;
  END IF;

  -- Extract time conditions
  v_time_conditions := v_conditions->'time';

  IF v_time_conditions IS NOT NULL THEN
    -- Check day-of-week: DOW returns 0=Sunday, 1=Monday, ..., 6=Saturday
    IF v_time_conditions->'allowed_days' IS NOT NULL THEN
      v_day_ok := EXTRACT(DOW FROM v_now)::TEXT = ANY(
        SELECT jsonb_array_elements_text(v_time_conditions->'allowed_days')
      );
    END IF;

    -- Check time-of-day window
    IF v_time_conditions->>'start_time' IS NOT NULL AND v_time_conditions->>'end_time' IS NOT NULL THEN
      v_time_ok := v_now::TIME BETWEEN
        (v_time_conditions->>'start_time')::TIME AND
        (v_time_conditions->>'end_time')::TIME;
    END IF;
  END IF;

  -- Apply condition logic (AND = all must pass, OR = any must pass)
  IF COALESCE(v_condition_logic, 'AND') = 'AND' THEN
    v_conditions_met := v_day_ok AND v_time_ok;
  ELSE
    v_conditions_met := v_day_ok OR v_time_ok;
  END IF;

  -- NOTE: IP-based and location-based condition evaluation is handled server-side
  -- by the Rust Core Service. This function only evaluates time-based conditions.
  -- The Rust service calls check_permission_conditions() from migration 031 for
  -- full condition evaluation including IP/geo restrictions.

  RETURN v_conditions_met;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION check_conditional_permission(UUID, VARCHAR, VARCHAR) TO authenticated, service_role;

-- Add a comment for documentation
COMMENT ON FUNCTION check_conditional_permission IS
  'Checks if a user has a specific permission and all time-based conditions are met. '
  'Evaluates role_permissions, temporary_role_assignments, and user_permissions. '
  'Time-based conditions include day-of-week and time-of-day windows. '
  'IP/location conditions are evaluated server-side by the Rust Core Service.';
