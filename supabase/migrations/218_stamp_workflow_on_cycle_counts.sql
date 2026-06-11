-- ============================================================================
-- Migration 218: Auto-stamp workflow config on cycle count rows
-- Description: Adds a BEFORE INSERT trigger that populates workflow_config_id,
--              workflow_config_version, workflow_snapshot, and per-row
--              review_threshold_pct / review_threshold_abs from the matching
--              cycle_count_workflow_configs row whenever the caller doesn't
--              provide them. This makes the RF operator flow configurable
--              per-org per-count_type without requiring every caller to
--              remember to stamp the snapshot.
--
--              Also backfills any pending / in_progress rows that never got a
--              snapshot before this trigger existed.
-- ============================================================================

BEGIN;

-- =========================================================================
-- PART 1: Helper function — fetch thresholds from a workflow config's review
-- step. Uses 10 / 10 as the ultimate fallback (matches historical defaults).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.cycle_count_thresholds_from_config(
  p_config_id UUID,
  OUT threshold_pct NUMERIC,
  OUT threshold_abs NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_steps JSONB;
  v_review_step JSONB;
BEGIN
  IF p_config_id IS NULL THEN
    threshold_pct := 10;
    threshold_abs := 10;
    RETURN;
  END IF;

  SELECT steps INTO v_steps
  FROM cycle_count_workflow_configs
  WHERE id = p_config_id;

  IF v_steps IS NULL THEN
    threshold_pct := 10;
    threshold_abs := 10;
    RETURN;
  END IF;

  SELECT elem INTO v_review_step
  FROM jsonb_array_elements(v_steps) AS elem
  WHERE elem ->> 'type' = 'review'
  LIMIT 1;

  threshold_pct := COALESCE(
    NULLIF((v_review_step -> 'config' ->> 'review_threshold_pct'), '')::NUMERIC,
    NULLIF((v_review_step -> 'config' ->> 'variance_threshold_pct'), '')::NUMERIC,
    10
  );
  threshold_abs := COALESCE(
    NULLIF((v_review_step -> 'config' ->> 'review_threshold_abs'), '')::NUMERIC,
    NULLIF((v_review_step -> 'config' ->> 'variance_threshold_abs'), '')::NUMERIC,
    10
  );
END;
$$;

COMMENT ON FUNCTION public.cycle_count_thresholds_from_config(UUID) IS
  'Extracts review threshold pct/abs from a workflow config''s review step, falling back to 10/10.';

-- =========================================================================
-- PART 2: Trigger function — stamp workflow fields on BEFORE INSERT
-- =========================================================================

CREATE OR REPLACE FUNCTION public.stamp_cycle_count_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_config RECORD;
  v_thresholds RECORD;
BEGIN
  -- Nothing to look up without an org + count_type.
  IF NEW.organization_id IS NULL OR NEW.count_type IS NULL THEN
    RETURN NEW;
  END IF;

  -- If the caller already stamped all the workflow fields, respect that.
  IF NEW.workflow_config_id IS NOT NULL
     AND NEW.workflow_config_version IS NOT NULL
     AND NEW.workflow_snapshot IS NOT NULL
     AND NEW.workflow_snapshot <> '{}'::jsonb
     AND NEW.review_threshold_pct IS NOT NULL
     AND NEW.review_threshold_abs IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT id, version, steps
  INTO v_config
  FROM cycle_count_workflow_configs
  WHERE organization_id = NEW.organization_id
    AND count_type = NEW.count_type
    AND is_active = TRUE
  LIMIT 1;

  IF v_config.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.workflow_config_id IS NULL THEN
    NEW.workflow_config_id := v_config.id;
  END IF;

  IF NEW.workflow_config_version IS NULL THEN
    NEW.workflow_config_version := v_config.version;
  END IF;

  IF NEW.workflow_snapshot IS NULL OR NEW.workflow_snapshot = '{}'::jsonb THEN
    NEW.workflow_snapshot := jsonb_build_object(
      'config_id',            v_config.id,
      'config_version',       v_config.version,
      'count_type',           NEW.count_type,
      'steps',                v_config.steps
    );
  END IF;

  IF NEW.review_threshold_pct IS NULL OR NEW.review_threshold_abs IS NULL THEN
    SELECT threshold_pct, threshold_abs INTO v_thresholds
    FROM public.cycle_count_thresholds_from_config(v_config.id);

    IF NEW.review_threshold_pct IS NULL THEN
      NEW.review_threshold_pct := v_thresholds.threshold_pct;
    END IF;

    IF NEW.review_threshold_abs IS NULL THEN
      NEW.review_threshold_abs := v_thresholds.threshold_abs;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.stamp_cycle_count_workflow() IS
  'BEFORE INSERT trigger on rr_cyclecount_data that stamps workflow_config_id, workflow_config_version, workflow_snapshot, and review_threshold_* from the matching active cycle_count_workflow_configs row.';

-- =========================================================================
-- PART 3: Attach the trigger — runs BEFORE the variance trigger so the
-- thresholds are populated before auto_calculate_cycle_count_variance reads
-- them.
-- =========================================================================

DROP TRIGGER IF EXISTS trigger_stamp_workflow ON rr_cyclecount_data;

CREATE TRIGGER trigger_stamp_workflow
  BEFORE INSERT ON rr_cyclecount_data
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_cycle_count_workflow();

-- =========================================================================
-- PART 4: Backfill existing pending / in_progress / recount rows
-- =========================================================================

DO $mig$
DECLARE
  r RECORD;
  v_thresholds RECORD;
BEGIN
  FOR r IN
    SELECT cc.id, cc.organization_id, cc.count_type,
           cc.workflow_config_id, cc.workflow_config_version,
           cc.workflow_snapshot, cc.review_threshold_pct, cc.review_threshold_abs,
           cfg.id AS cfg_id, cfg.version AS cfg_version, cfg.steps AS cfg_steps
    FROM rr_cyclecount_data cc
    LEFT JOIN cycle_count_workflow_configs cfg
      ON cfg.organization_id = cc.organization_id
     AND cfg.count_type = cc.count_type
     AND cfg.is_active = TRUE
    WHERE cc.count_type IS NOT NULL
      AND cc.organization_id IS NOT NULL
      AND (
        cc.workflow_config_id IS NULL
        OR cc.workflow_snapshot IS NULL
        OR cc.workflow_snapshot = '{}'::jsonb
        OR cc.review_threshold_pct IS NULL
        OR cc.review_threshold_abs IS NULL
      )
  LOOP
    IF r.cfg_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT threshold_pct, threshold_abs INTO v_thresholds
    FROM public.cycle_count_thresholds_from_config(r.cfg_id);

    UPDATE rr_cyclecount_data
    SET workflow_config_id      = COALESCE(workflow_config_id, r.cfg_id),
        workflow_config_version = COALESCE(workflow_config_version, r.cfg_version),
        workflow_snapshot       = CASE
          WHEN workflow_snapshot IS NULL OR workflow_snapshot = '{}'::jsonb THEN
            jsonb_build_object(
              'config_id',      r.cfg_id,
              'config_version', r.cfg_version,
              'count_type',     r.count_type,
              'steps',          r.cfg_steps
            )
          ELSE workflow_snapshot
        END,
        review_threshold_pct    = COALESCE(review_threshold_pct, v_thresholds.threshold_pct),
        review_threshold_abs    = COALESCE(review_threshold_abs, v_thresholds.threshold_abs)
    WHERE id = r.id;
  END LOOP;
END $mig$;

COMMIT;
