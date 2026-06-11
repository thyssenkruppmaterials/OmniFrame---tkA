-- ============================================================================
-- Migration 258 — Generalize cycle_count_workflow_configs → work_workflow_configs
-- (Phase 1.4 of Work Engine Foundation; renumbered from plan's 256).
--
-- Renames the table, adds `work_kind` and `task_subtype`, and exposes a
-- writable backwards-compat view at the original name so workflow-config.service.ts
-- and use-workflow-configs.ts keep working until Phase 8 cleanup.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cycle_count_workflow_configs'
  ) THEN
    -- Rename to the generic name.
    ALTER TABLE public.cycle_count_workflow_configs RENAME TO work_workflow_configs;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'work_workflow_configs'
  ) THEN
    -- Add new columns idempotently.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='work_workflow_configs' AND column_name='work_kind'
    ) THEN
      ALTER TABLE public.work_workflow_configs ADD COLUMN work_kind text NOT NULL DEFAULT 'cycle_count';
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='work_workflow_configs' AND column_name='count_type'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='work_workflow_configs' AND column_name='task_subtype'
    ) THEN
      ALTER TABLE public.work_workflow_configs RENAME COLUMN count_type TO task_subtype;
    END IF;

    -- Drop the old per-(org, count_type) uniqueness if present, replace with
    -- per-(org, work_kind, task_subtype).
    DECLARE
      v_constraint text;
    BEGIN
      SELECT conname INTO v_constraint
        FROM pg_constraint
       WHERE conrelid = 'public.work_workflow_configs'::regclass
         AND contype  = 'u'
         AND pg_get_constraintdef(oid) ILIKE '%count_type%';
      IF v_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.work_workflow_configs DROP CONSTRAINT %I', v_constraint);
      END IF;
    EXCEPTION WHEN undefined_object THEN NULL; END;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'work_workflow_configs_org_kind_subtype_key'
    ) THEN
      ALTER TABLE public.work_workflow_configs
        ADD CONSTRAINT work_workflow_configs_org_kind_subtype_key
        UNIQUE (organization_id, work_kind, task_subtype);
    END IF;
  END IF;
END $$;

-- Backwards-compatible writable view exposing `count_type`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'work_workflow_configs'
  ) THEN
    EXECUTE 'CREATE OR REPLACE VIEW public.cycle_count_workflow_configs '
            'WITH (security_invoker = true) AS '
            'SELECT *, task_subtype AS count_type '
            'FROM public.work_workflow_configs '
            'WHERE work_kind = ''cycle_count''';
  END IF;
END $$;

COMMIT;
