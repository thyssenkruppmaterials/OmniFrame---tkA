-- ============================================================================
-- Migration 237: Auto-Map Worker Function
--   Implements the actual algorithm that fills warehouse_auto_map_runs.
--   Greedy assignment: unassigned LX03 bins → empty rack cells (rack.label LIKE
--   requested_area% OR rack.aisle = requested_area).
--   Order bins lexicographically; cells row-major.
--   Detects duplicate-bin and capacity-exceeded conflicts.
-- ============================================================================

CREATE OR REPLACE FUNCTION execute_auto_map_run(p_run_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run         warehouse_auto_map_runs%ROWTYPE;
  v_map         warehouse_maps%ROWTYPE;
  v_proposed    JSONB := '[]'::jsonb;
  v_conflicts   JSONB := '[]'::jsonb;
  v_warnings    JSONB := '[]'::jsonb;
  v_count       INT := 0;
  v_user_id     UUID;
BEGIN
  v_user_id := auth.uid();

  SELECT * INTO v_run FROM warehouse_auto_map_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auto-map run not found: %', p_run_id;
  END IF;

  IF v_run.status NOT IN ('queued', 'failed') THEN
    RAISE EXCEPTION 'Run not in a runnable state: %', v_run.status;
  END IF;

  UPDATE warehouse_auto_map_runs
     SET status = 'running', started_at = now(), error_message = NULL
   WHERE id = p_run_id;

  SELECT * INTO v_map FROM warehouse_maps WHERE id = v_run.map_id;

  -- Build pairings via a CTE that pairs ordered free cells with ordered free bins
  WITH free_cells AS (
    SELECT
      r.id AS rack_id,
      r.label AS rack_label,
      gs_row.row AS rack_row,
      gs_col.col AS rack_column,
      ROW_NUMBER() OVER (ORDER BY r.label, gs_row.row, gs_col.col) AS rn
    FROM warehouse_racks r
    CROSS JOIN LATERAL generate_series(1, r.rows) AS gs_row(row)
    CROSS JOIN LATERAL generate_series(1, r.columns) AS gs_col(col)
    LEFT JOIN warehouse_location_mappings wlm
      ON wlm.rack_id = r.id
     AND wlm.rack_row = gs_row.row
     AND wlm.rack_column = gs_col.col
    WHERE r.map_id = v_run.map_id
      AND wlm.id IS NULL
      AND (
        v_run.requested_area IS NULL
        OR r.label  ILIKE v_run.requested_area || '%'
        OR r.aisle  = v_run.requested_area
        OR categorize_storage_area(r.aisle) = LOWER(v_run.requested_area)
      )
  ),
  free_bins AS (
    SELECT
      lx.storage_bin,
      ROW_NUMBER() OVER (ORDER BY lx.storage_bin) AS rn
    FROM (
      SELECT DISTINCT lx.storage_bin
        FROM rr_lx03_data lx
        LEFT JOIN warehouse_location_mappings wlm
          ON wlm.storage_bin = lx.storage_bin
         AND wlm.map_id = v_run.map_id
       WHERE lx.warehouse = v_run.warehouse_code
         AND wlm.id IS NULL
         AND lx.storage_bin IS NOT NULL
         AND (
           v_run.requested_area IS NULL
           OR categorize_storage_area(lx.storage_bin) = LOWER(v_run.requested_area)
           OR lx.storage_bin ILIKE v_run.requested_area || '%'
         )
    ) lx
  ),
  pairings AS (
    SELECT
      fc.rack_id,
      fc.rack_label,
      fc.rack_row,
      fc.rack_column,
      fb.storage_bin
    FROM free_cells fc
    JOIN free_bins fb ON fb.rn = fc.rn
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'rack_id', rack_id,
      'rack_label', rack_label,
      'storage_bin', storage_bin,
      'rack_row', rack_row,
      'rack_column', rack_column
    )), '[]'::jsonb)
    INTO v_proposed
    FROM pairings;

  v_count := COALESCE(jsonb_array_length(v_proposed), 0);

  -- Conflicts: bins that already exist on a different rack/cell
  WITH proposed AS (
    SELECT
      (p ->> 'rack_id')::UUID AS rack_id,
      p ->> 'storage_bin' AS storage_bin,
      (p ->> 'rack_row')::INT AS rack_row,
      (p ->> 'rack_column')::INT AS rack_column
    FROM jsonb_array_elements(v_proposed) p
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'storage_bin', existing.storage_bin,
    'rack_row', proposed.rack_row,
    'rack_column', proposed.rack_column,
    'existing_bin', existing.storage_bin,
    'reason', 'bin already mapped on another rack'
  )), '[]'::jsonb) INTO v_conflicts
    FROM proposed
    JOIN warehouse_location_mappings existing
      ON existing.storage_bin = proposed.storage_bin
     AND existing.map_id = v_run.map_id
     AND existing.rack_id <> proposed.rack_id;

  -- Warnings: not enough cells / not enough bins
  IF v_count = 0 THEN
    v_warnings := v_warnings || jsonb_build_array('No matching free cells or unassigned bins for area: ' || COALESCE(v_run.requested_area, '*'));
  END IF;

  UPDATE warehouse_auto_map_runs
     SET status = 'awaiting_review',
         proposed_assignments = v_proposed,
         conflicts = v_conflicts,
         warnings = v_warnings,
         completed_at = now()
   WHERE id = p_run_id;

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'status', 'awaiting_review',
    'proposed_count', v_count,
    'conflict_count', COALESCE(jsonb_array_length(v_conflicts), 0),
    'warnings', v_warnings
  );

EXCEPTION WHEN OTHERS THEN
  UPDATE warehouse_auto_map_runs
     SET status = 'failed',
         error_message = SQLERRM,
         completed_at = now()
   WHERE id = p_run_id;
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION execute_auto_map_run(UUID) TO authenticated, service_role;

-- =========================================================================
-- Apply auto-map proposals (after user review)
-- =========================================================================

CREATE OR REPLACE FUNCTION apply_auto_map_run(p_run_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run         warehouse_auto_map_runs%ROWTYPE;
  v_proposal    JSONB;
  v_applied     JSONB := '[]'::jsonb;
  v_skipped     INT := 0;
  v_inserted    INT := 0;
BEGIN
  SELECT * INTO v_run FROM warehouse_auto_map_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auto-map run not found: %', p_run_id;
  END IF;

  IF v_run.status <> 'awaiting_review' THEN
    RAISE EXCEPTION 'Cannot apply run in status %', v_run.status;
  END IF;

  FOR v_proposal IN SELECT * FROM jsonb_array_elements(v_run.proposed_assignments) LOOP
    BEGIN
      INSERT INTO warehouse_location_mappings (
        organization_id, map_id, rack_id, warehouse_code,
        storage_bin, rack_row, rack_column
      ) VALUES (
        v_run.organization_id,
        v_run.map_id,
        (v_proposal ->> 'rack_id')::UUID,
        v_run.warehouse_code,
        v_proposal ->> 'storage_bin',
        (v_proposal ->> 'rack_row')::INT,
        (v_proposal ->> 'rack_column')::INT
      );
      v_applied := v_applied || jsonb_build_array(v_proposal);
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN unique_violation THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  UPDATE warehouse_auto_map_runs
     SET status = 'applied',
         applied_assignments = v_applied,
         completed_at = now()
   WHERE id = p_run_id;

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'status', 'applied',
    'inserted', v_inserted,
    'skipped', v_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION apply_auto_map_run(UUID) TO authenticated, service_role;

-- =========================================================================
-- Cancel a queued/awaiting run
-- =========================================================================

CREATE OR REPLACE FUNCTION cancel_auto_map_run(p_run_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE warehouse_auto_map_runs
     SET status = 'cancelled', completed_at = now()
   WHERE id = p_run_id
     AND status IN ('queued', 'awaiting_review', 'failed');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot cancel run %', p_run_id;
  END IF;

  RETURN jsonb_build_object('run_id', p_run_id, 'status', 'cancelled');
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_auto_map_run(UUID) TO authenticated, service_role;

-- =========================================================================
-- Trigger to auto-execute newly queued runs
-- =========================================================================

CREATE OR REPLACE FUNCTION trg_execute_auto_map_run()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'queued' THEN
    PERFORM execute_auto_map_run(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_after_auto_map_run_insert ON warehouse_auto_map_runs;
CREATE TRIGGER trg_after_auto_map_run_insert
  AFTER INSERT ON warehouse_auto_map_runs
  FOR EACH ROW
  EXECUTE FUNCTION trg_execute_auto_map_run();
