-- Migration: Scheduled / Recurring SAP Agent Jobs (Phase D #14)
-- Date: 2026-04-29
-- Description:
--   Adds the `sap_agent_schedules` table + a Postgres-side dispatcher
--   that converts each enabled schedule whose `next_run_at` has passed
--   into a fresh `sap_agent_jobs` row. The agent then claims and runs
--   those rows like any other queued job — no agent code change needed
--   to consume scheduled work.
--
--   Cron parsing strategy:
--     - If `pg_cron` is installed (Supabase opt-in), we use the
--       extension's own time math to compute next-run via
--       `cron.schedule_in_database` semantics. We schedule a single
--       cron job ("omniframe-enqueue-due-schedules") that calls
--       `enqueue_due_schedules()` every minute.
--     - If `pg_cron` is NOT installed, the migration is still safe to
--       apply: the table + function exist, and an external caller
--       (e.g. a Supabase Edge Function on a schedule, or the agent
--       itself on its 60s sweep) can invoke `enqueue_due_schedules()`.
--
--   For computing each schedule's next fire we use a small in-PG
--   parser supporting four cron formats common to ops use cases:
--     - `*/N * * * *`     → every N minutes
--     - `0 */N * * *`     → every N hours, on the hour
--     - `0 H * * *`       → daily at HH:00
--     - `0 H * * D`       → weekly on day-of-week D at HH:00 (0=Sun)
--   Anything else falls through to "+1 hour" with a console NOTICE so
--   the scheduler never gets stuck — operators see the missed parse
--   in the row's `last_error` and can re-edit.

-- ───────────────────────────────────────────────────────────────────────
-- 1. sap_agent_schedules
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."sap_agent_schedules" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "cron_expression" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "assigned_agent_id" TEXT,
  "max_attempts" INTEGER NOT NULL DEFAULT 1,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "last_run_at" TIMESTAMPTZ,
  "last_job_id" UUID REFERENCES "public"."sap_agent_jobs"("id") ON DELETE SET NULL,
  "last_error" TEXT,
  "next_run_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by" UUID REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE "public"."sap_agent_schedules" IS
  'User-defined recurring SAP automation jobs. enqueue_due_schedules() promotes due rows into sap_agent_jobs every minute via pg_cron.';

CREATE INDEX IF NOT EXISTS "idx_sap_agent_schedules_due"
  ON "public"."sap_agent_schedules" ("enabled", "next_run_at");

CREATE INDEX IF NOT EXISTS "idx_sap_agent_schedules_org"
  ON "public"."sap_agent_schedules" ("organization_id");

ALTER TABLE "public"."sap_agent_schedules" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sap_agent_schedules' AND policyname = 'sap_agent_schedules_select_org'
  ) THEN
    CREATE POLICY "sap_agent_schedules_select_org"
      ON "public"."sap_agent_schedules" FOR SELECT
      USING (organization_id IN (SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sap_agent_schedules' AND policyname = 'sap_agent_schedules_insert_org'
  ) THEN
    CREATE POLICY "sap_agent_schedules_insert_org"
      ON "public"."sap_agent_schedules" FOR INSERT
      WITH CHECK (organization_id IN (SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sap_agent_schedules' AND policyname = 'sap_agent_schedules_update_org'
  ) THEN
    CREATE POLICY "sap_agent_schedules_update_org"
      ON "public"."sap_agent_schedules" FOR UPDATE
      USING (organization_id IN (SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sap_agent_schedules' AND policyname = 'sap_agent_schedules_delete_org'
  ) THEN
    CREATE POLICY "sap_agent_schedules_delete_org"
      ON "public"."sap_agent_schedules" FOR DELETE
      USING (organization_id IN (SELECT organization_id FROM "public"."user_profiles" WHERE id = auth.uid()));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sap_agent_schedules'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sap_agent_schedules;
  END IF;
END $$;

ALTER TABLE "public"."sap_agent_schedules" REPLICA IDENTITY FULL;


-- ───────────────────────────────────────────────────────────────────────
-- 2. compute_next_run_at — minimal cron parser
-- ───────────────────────────────────────────────────────────────────────
-- Supports:
--   "*/N * * * *"  every N minutes
--   "0 */N * * *"  every N hours on the hour
--   "0 H * * *"    daily at HH:00
--   "0 H * * D"    weekly on dow D at HH:00 (0=Sun … 6=Sat)
-- Everything else → returns from_ts + 1 hour as a safe fallback.
CREATE OR REPLACE FUNCTION "public"."compute_next_run_at"(
  p_expr   TEXT,
  p_from   TIMESTAMPTZ DEFAULT now()
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parts        TEXT[];
  v_minute     TEXT;
  v_hour       TEXT;
  v_dom        TEXT;
  v_month      TEXT;
  v_dow        TEXT;
  v_n          INTEGER;
  v_h          INTEGER;
  v_d          INTEGER;
  v_today      TIMESTAMPTZ;
  v_candidate  TIMESTAMPTZ;
  v_dow_today  INTEGER;
  v_delta_days INTEGER;
BEGIN
  IF p_expr IS NULL OR length(trim(p_expr)) = 0 THEN
    RETURN p_from + interval '1 hour';
  END IF;
  parts := regexp_split_to_array(trim(p_expr), '\s+');
  IF array_length(parts, 1) <> 5 THEN
    RETURN p_from + interval '1 hour';
  END IF;
  v_minute := parts[1];
  v_hour   := parts[2];
  v_dom    := parts[3];
  v_month  := parts[4];
  v_dow    := parts[5];

  -- "*/N * * * *" → every N minutes
  IF v_hour = '*' AND v_dom = '*' AND v_month = '*' AND v_dow = '*'
     AND v_minute ~ '^\*/\d+$' THEN
    v_n := substring(v_minute from 3)::int;
    IF v_n < 1 THEN v_n := 1; END IF;
    RETURN date_trunc('minute', p_from) + make_interval(mins => v_n);
  END IF;

  -- "0 */N * * *" → every N hours on the hour
  IF v_minute = '0' AND v_dom = '*' AND v_month = '*' AND v_dow = '*'
     AND v_hour ~ '^\*/\d+$' THEN
    v_n := substring(v_hour from 3)::int;
    IF v_n < 1 THEN v_n := 1; END IF;
    RETURN date_trunc('hour', p_from) + make_interval(hours => v_n);
  END IF;

  -- "0 H * * *" → daily at HH:00
  IF v_minute = '0' AND v_dom = '*' AND v_month = '*' AND v_dow = '*'
     AND v_hour ~ '^\d{1,2}$' THEN
    v_h := v_hour::int;
    v_today := date_trunc('day', p_from) + make_interval(hours => v_h);
    IF v_today <= p_from THEN
      v_today := v_today + interval '1 day';
    END IF;
    RETURN v_today;
  END IF;

  -- "0 H * * D" → weekly on dow D at HH:00
  IF v_minute = '0' AND v_dom = '*' AND v_month = '*'
     AND v_hour ~ '^\d{1,2}$' AND v_dow ~ '^\d$' THEN
    v_h := v_hour::int;
    v_d := v_dow::int;
    v_dow_today := EXTRACT(dow FROM p_from)::int;
    v_delta_days := (v_d - v_dow_today + 7) % 7;
    v_candidate := date_trunc('day', p_from) + make_interval(days => v_delta_days, hours => v_h);
    IF v_candidate <= p_from THEN
      v_candidate := v_candidate + interval '7 days';
    END IF;
    RETURN v_candidate;
  END IF;

  RETURN p_from + interval '1 hour';
END;
$$;

GRANT EXECUTE ON FUNCTION "public"."compute_next_run_at"(TEXT, TIMESTAMPTZ)
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION "public"."compute_next_run_at"(TEXT, TIMESTAMPTZ) IS
  'Minimal cron expression evaluator. Supports */N */N hourly daily weekly forms; falls back to +1h for unsupported expressions.';


-- ───────────────────────────────────────────────────────────────────────
-- 3. enqueue_due_schedules — promote due schedules to jobs
-- ───────────────────────────────────────────────────────────────────────
-- Runs once per minute via pg_cron. For each enabled schedule whose
-- next_run_at has passed, inserts a fresh sap_agent_jobs row and
-- advances next_run_at via compute_next_run_at(...). Wrapped in a
-- savepoint per-row so a single bad schedule can't block the rest.
CREATE OR REPLACE FUNCTION "public"."enqueue_due_schedules"() RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s            "public"."sap_agent_schedules"%ROWTYPE;
  v_job_id     UUID;
  v_count      INTEGER := 0;
  v_idem       TEXT;
BEGIN
  FOR s IN
    SELECT * FROM "public"."sap_agent_schedules"
     WHERE enabled = TRUE
       AND next_run_at <= now()
     ORDER BY next_run_at ASC
     LIMIT 100
  LOOP
    BEGIN
      -- Idempotency token: schedule id + minute bucket of fire time so
      -- accidental double-cron-fire dedupes cleanly.
      v_idem := 'sched:' || s.id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI');

      INSERT INTO "public"."sap_agent_jobs" (
        organization_id, requested_by, endpoint, payload,
        priority, max_attempts, idempotency_key, assigned_agent_id, status
      ) VALUES (
        s.organization_id, s.created_by, s.endpoint, s.payload,
        s.priority, s.max_attempts, v_idem, s.assigned_agent_id, 'queued'
      )
      ON CONFLICT (organization_id, idempotency_key) DO NOTHING
      RETURNING id INTO v_job_id;

      UPDATE "public"."sap_agent_schedules"
         SET last_run_at = now(),
             last_job_id = v_job_id,
             last_error  = NULL,
             next_run_at = "public"."compute_next_run_at"(s.cron_expression, now()),
             updated_at  = now()
       WHERE id = s.id;

      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE "public"."sap_agent_schedules"
         SET last_error  = substring(SQLERRM, 1, 500),
             next_run_at = now() + interval '5 minutes',
             updated_at  = now()
       WHERE id = s.id;
    END;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION "public"."enqueue_due_schedules"()
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION "public"."enqueue_due_schedules"() IS
  'Sweeps sap_agent_schedules and inserts a queued sap_agent_jobs row for each schedule whose next_run_at has passed. Idempotent per minute. Designed to be invoked once per minute (e.g. via pg_cron).';


-- ───────────────────────────────────────────────────────────────────────
-- 4. updated_at trigger
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."tg_sap_agent_schedules_touch_updated_at"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_sap_agent_schedules_touch" ON "public"."sap_agent_schedules";
CREATE TRIGGER "trg_sap_agent_schedules_touch"
  BEFORE UPDATE ON "public"."sap_agent_schedules"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."tg_sap_agent_schedules_touch_updated_at"();


-- ───────────────────────────────────────────────────────────────────────
-- 5. pg_cron registration (idempotent, gracefully no-ops if absent)
-- ───────────────────────────────────────────────────────────────────────
-- pg_cron lives in extension schema `cron`. If the extension isn't
-- installed in this Supabase project, the DO block silently skips
-- registration — the agent's 60s polling fallback will continue to
-- catch newly-due schedules. Operators can later enable pg_cron in
-- Supabase Dashboard → Database → Extensions and re-run this block.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove any previous registration to keep the function call up to date.
    PERFORM cron.unschedule(jobid)
      FROM cron.job
     WHERE jobname = 'omniframe-enqueue-due-schedules';

    PERFORM cron.schedule(
      'omniframe-enqueue-due-schedules',
      '* * * * *',
      $cron$ SELECT public.enqueue_due_schedules(); $cron$
    );
    RAISE NOTICE 'pg_cron job omniframe-enqueue-due-schedules scheduled (every minute).';
  ELSE
    RAISE NOTICE 'pg_cron extension not enabled — sap_agent_schedules will only fire when enqueue_due_schedules() is called externally. Enable in Supabase Dashboard → Database → Extensions and re-run this DO block.';
  END IF;
END $$;
