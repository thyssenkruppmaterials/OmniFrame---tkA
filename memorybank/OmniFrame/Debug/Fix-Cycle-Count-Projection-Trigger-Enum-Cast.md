---
tags:
  - cycle-count
  - domain/backend
  - domain/database
  - status/active
  - status/resolved
  - type/debug
  - work-engine
created: 2026-05-02
---

# Fix Cycle Count Projection Trigger Enum Cast (Phase 11.1 P0 blocker)

## Purpose / Context

First execution of Phase 11.1 canary kickoff (enable `work_tasks_shadow_write` for `j.AI OneBox` / `c9d89a74-7179-4033-93ea-56267cf42a17`) surfaced a P0 trigger defect that would actively break live cycle-count UPDATEs the moment the flag flips on. Flag was rolled back to `false`; this note captures the bug, the surface trace, the recommended fix, and the secondary backfill-mechanics issue that the same patch should also resolve.

## Surface trace

```sql
UPDATE public.rr_cyclecount_data
   SET notes = COALESCE(notes,'') || ' [shadow test]'
 WHERE id = 'e7532d59-54e5-466c-95ce-984f2854268d';
-- ERROR:  42804: COALESCE types cycle_count_priority and text cannot be matched
-- CONTEXT: PL/pgSQL function sync_cycle_count_to_work_task() line 70 at SQL statement
```

The failing line in `public.sync_cycle_count_to_work_task` UPDATE branch:

```sql
priority = COALESCE(NEW.priority, priority),
```

## Root cause

| Side | Column | Type |
| ---- | ------ | ---- |
| LEGACY | `rr_cyclecount_data.priority` | `cycle_count_priority` (enum) |
| LEGACY | `rr_cyclecount_data.status` | `cycle_count_status` (enum) |
| SHADOW | `work_tasks.priority` | `text` |
| SHADOW | `work_tasks.status` | `text` |

PostgreSQL has no implicit common type between an `enum` and `text` in `COALESCE`. Both arguments must resolve to the same concrete type. The expression `COALESCE(NEW.priority::cycle_count_priority, work_tasks.priority::text)` cannot be unified, so the trigger throws `42804` on every UPDATE.

The INSERT branch is fine because `COALESCE(NEW.priority, 'normal')` resolves the unknown literal to enum, then the implicit enum→text *assignment* cast at the column boundary handles the conversion.

## Why it wasn't caught earlier

Migration 261 had the same bug class in the `work_engine_drift` view (`wt.priority = rcc.priority`). Operator patched it during apply (Pass 3 — `rcc.priority::text`). Migration 257's trigger function carried the same defect but was never exercised because `work_tasks_shadow_write=false` everywhere. Phase 11.1 kickoff is the first time the flag flipped on, so this run is the first run to hit the COALESCE. The migration test suite passed because none of the Phase 9 probes UPDATE a real legacy row with shadow_write enabled.

## Recommended fix

Follow-up migration `264_patch_cycle_count_projection_priority_cast.sql`:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.sync_cycle_count_to_work_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_skip text := current_setting('app.skip_sync', true);
  v_status text;
  v_legacy_status text;
BEGIN
  IF v_skip = 'true' THEN RETURN NEW; END IF;
  IF NOT public.work_engine_feature_flag(NEW.organization_id, 'work_tasks_shadow_write') THEN
    RETURN NEW;
  END IF;

  CASE NEW.status::text
    WHEN 'pending'                     THEN v_status := 'pending';     v_legacy_status := NULL;
    WHEN 'in_progress'                 THEN v_status := 'in_progress'; v_legacy_status := NULL;
    WHEN 'recount'                     THEN v_status := 'in_progress'; v_legacy_status := 'recount';
    WHEN 'awaiting_supervisor_signoff' THEN v_status := 'paused';      v_legacy_status := 'awaiting_supervisor_signoff';
    WHEN 'variance_review'             THEN v_status := 'completed';   v_legacy_status := 'variance_review';
    WHEN 'approved'                    THEN v_status := 'completed';   v_legacy_status := 'approved';
    WHEN 'cancelled'                   THEN v_status := 'cancelled';   v_legacy_status := NULL;
    ELSE                                    v_status := COALESCE(NEW.status::text, 'pending'); v_legacy_status := NULL;
  END CASE;

  PERFORM set_config('app.skip_sync', 'true', true);
  PERFORM set_config('app.work_zone_lock_bypass', 'on', true);

  INSERT INTO public.work_tasks (
    id, organization_id, task_type, task_subtype, task_number,
    source_table, source_id,
    subject_material, subject_description,
    primary_location, warehouse, unit_of_measure,
    priority, status, legacy_status,
    assigned_to, assigned_at, pushed_by, pushed_at, push_mode,
    push_acknowledged, push_acknowledged_at,
    supervisor_assigned_at, supervisor_assigned_by,
    reservation_started_at,
    workflow_config_id, workflow_config_version, workflow_snapshot,
    payload, completed_at, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.organization_id, 'cycle_count', NEW.count_type, NEW.count_number,
    'rr_cyclecount_data', NEW.id,
    NEW.material_number, NEW.material_description,
    NEW.location, NEW.warehouse, NEW.unit_of_measure,
    COALESCE(NEW.priority::text, 'normal'), v_status, v_legacy_status,
    NEW.assigned_to, NEW.assigned_at, NEW.pushed_by, NEW.pushed_at,
    COALESCE(NEW.push_mode, 'pull'),
    COALESCE(NEW.push_acknowledged, false), NEW.push_acknowledged_at,
    NEW.supervisor_assigned_at, NEW.supervisor_assigned_by,
    NEW.reservation_started_at,
    NEW.workflow_config_id, NEW.workflow_config_version, NEW.workflow_snapshot,
    jsonb_build_object(
      'system_quantity', NEW.system_quantity,
      'counted_quantity', NEW.counted_quantity,
      'count_type', NEW.count_type,
      'requires_recount', NEW.requires_recount,
      'recount_completed', NEW.recount_completed,
      'scanned_material_number', NEW.scanned_material_number,
      'scanned_parts', NEW.scanned_parts,
      'evidence_photo_urls', NEW.evidence_photo_urls,
      'transfer_destination_location', NEW.transfer_destination_location,
      'transfer_source_quantity', NEW.transfer_source_quantity,
      'reassignment_count', NEW.reassignment_count
    ),
    NEW.completed_at, NEW.created_at, NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE SET
    status                 = EXCLUDED.status,
    legacy_status          = EXCLUDED.legacy_status,
    assigned_to            = EXCLUDED.assigned_to,
    assigned_at            = EXCLUDED.assigned_at,
    pushed_by              = EXCLUDED.pushed_by,
    pushed_at              = EXCLUDED.pushed_at,
    push_mode              = EXCLUDED.push_mode,
    push_acknowledged      = EXCLUDED.push_acknowledged,
    push_acknowledged_at   = EXCLUDED.push_acknowledged_at,
    supervisor_assigned_at = EXCLUDED.supervisor_assigned_at,
    supervisor_assigned_by = EXCLUDED.supervisor_assigned_by,
    reservation_started_at = EXCLUDED.reservation_started_at,
    priority               = COALESCE(EXCLUDED.priority, work_tasks.priority),
    primary_location       = EXCLUDED.primary_location,
    workflow_config_id     = EXCLUDED.workflow_config_id,
    workflow_config_version= EXCLUDED.workflow_config_version,
    workflow_snapshot      = EXCLUDED.workflow_snapshot,
    payload                = EXCLUDED.payload,
    completed_at           = EXCLUDED.completed_at,
    updated_at             = now();

  PERFORM set_config('app.skip_sync', 'false', true);
  RETURN NEW;
END $$;

COMMIT;
```

Key changes vs migration 257:

1. `NEW.priority::text` cast in both VALUES and ON CONFLICT clauses → fixes 42804.
2. Single UPSERT replaces split INSERT/UPDATE branches → fixes the silent-no-op for missing projections so the backfill driver's `bump updated_at` model actually projects historical rows.
3. `NEW.status::text` cast in the fallback ELSE branch (defensive — only fires for unknown statuses).

## Secondary follow-up — reverse trigger

`public.sync_work_task_to_cycle_count` does:

```sql
UPDATE public.rr_cyclecount_data
   SET status = v_legacy_status,  -- v_legacy_status is text, status is cycle_count_status enum
```

This works for any `v_legacy_status` value that matches an existing enum label (implicit text→enum input cast). It can fail with `22P02` if a non-label string ever lands here. The CASE expression that produces `v_legacy_status` only emits known labels, but if `work_tasks.status` ever takes a value outside the `cycle_count_status` enum domain (e.g. a new shadow-only status), the reverse path will throw. Worth a defensive guard before reads cut over.

## Reproduction

```sql
-- 1. Enable shadow_write for any org.
UPDATE public.work_engine_settings
   SET feature_flags = feature_flags || '{"work_tasks_shadow_write":true}'::jsonb
 WHERE organization_id = '<org-uuid>';

-- 2. Touch any rr_cyclecount_data row for that org.
UPDATE public.rr_cyclecount_data SET notes = notes WHERE id = '<any-row-id>';
--   → ERROR:  42804: COALESCE types cycle_count_priority and text cannot be matched
```

## Mitigation while patch is pending

Keep `work_tasks_shadow_write=false` everywhere. The trigger short-circuits on the flag check (line 30 of mig 257) and the legacy UPDATE proceeds normally. j.AI OneBox is in this state as of `2026-05-02T21:27:22Z`.

## Related

- [[Implement-Work-Engine-Foundation]]
- `supabase/migrations/257_cycle_count_to_work_tasks_projection.sql` (carries the defect)
- `docs/work-engine/baselines/canary-shadow-write-enabled-2026-05-02.json` (full baseline + rollback audit)
- [[Sessions/2026-05-02]] (Phase 11.1 canary kickoff addendum)


## Resolution — landed in migration 265 (2026-05-02 PM)

Fix landed in `supabase/migrations/265_found_part_transfer_projection_safety.sql` rather than the originally suggested `264_*` slot — the cleanup pass that ran in parallel grabbed `264` for the unrelated advisor cleanup (priority_*_to_* search_path + worker_capabilities security_invoker). Migration 265 carries four fixes folded into one `CREATE OR REPLACE FUNCTION` per fix:

- **A. Priority enum→text cast.** Every `NEW.priority` reference now reads `NEW.priority::text`. Resolves the `42804: COALESCE types cycle_count_priority and text cannot be matched` documented above.
- **B. INSERT/UPDATE branching collapsed into UPSERT.** Single `INSERT … ON CONFLICT (id) DO UPDATE SET …` replaces the legacy `IF TG_OP='INSERT' THEN INSERT … ELSE UPDATE …`. Closes the silent-no-op the canary report flagged for the 8908 historical rr_cyclecount_data rows that have no work_tasks twin yet — the backfill driver's `UPDATE rr_cyclecount_data SET updated_at=now()` pattern now actually creates the projection on first touch.
- **C. Reverse trigger defensive `::cycle_count_status` cast.** `sync_work_task_to_cycle_count()` now writes `status = v_legacy_status::cycle_count_status`. Confirmed the reverse trigger does NOT project priority today (so no analogous priority cast needed there).
- **D. found_part_transfer carve-out (Plan §7.9 / mig 224).** `IF NEW.count_type = 'found_part_transfer' THEN v_requires_recount := false; IF v_legacy_status = 'variance_review' THEN v_legacy_status := 'approved'; v_status := 'completed'; END IF; END IF;` — ensures FPT rows never enter variance_review and never require recount on projection.

### Verification (the same canary row this note documents)

1. `shadow_write=false` (post-rollback state) → benign UPDATE on `e7532d59-54e5-466c-95ce-984f2854268d` returns clean (function early-returns on flag check).
2. Flipped `shadow_write=true` for org `c9d89a74-7179-4033-93ea-56267cf42a17`.
3. Repeated the UPDATE — succeeded (no 42804).
4. `work_tasks` row appeared with `status=completed, legacy_status=null, priority='normal' (text), payload.count_type='part_verification', payload.requires_recount=false`. Matches the expected mapping `legacy=completed/normal → wt: completed/null/normal`.
5. Flipped `shadow_write=false` again. Engine inert.
6. Cleaned the verification artifact (`DELETE FROM work_tasks WHERE source_id='e7532d59-…'`) so the next canary worker starts on a clean slate.

### Function-source spot checks (post-apply)

```
has_fpt_branch:    true
has_priority_cast: true   -- NEW.priority::text
has_upsert:        true   -- ON CONFLICT (id) DO UPDATE
has_status_cast:   true   -- v_legacy_status::cycle_count_status (reverse trigger)
```

### Engine state at completion

- All flags FALSE except `push_preflight_zone_check=true` — identical to rollback state captured in this note.
- `work_tasks` rows: 0.
- A new canary worker is scheduled to re-run Phase 11.1 against the patched trigger.

### Status

`status/active` → `status/resolved`. See [[Sessions/2026-05-02]] addendum "Pre-Cutover Cleanup Pass" for the broader context of the pass that landed this fix.


## Resolution — 2026-05-02

Migration `265_found_part_transfer_projection_safety` landed and resolved this issue. The patched `sync_cycle_count_to_work_task` function now contains:

- `COALESCE(NEW.priority::text, 'normal')` in both INSERT and the UPSERT's ON CONFLICT clauses (Fix A — closes 42804).
- A single `INSERT … ON CONFLICT (id) DO UPDATE` UPSERT in place of the prior split INSERT/UPDATE branches (Fix B — the chunked backfill driver's `bump updated_at` model now actually projects historical rows).
- `count_type='found_part_transfer'` exemption (Fix D — forced `requires_recount=false`, clamped `variance_review` → `completed/approved`).

Reverse trigger `sync_work_task_to_cycle_count` writes `status = v_legacy_status::cycle_count_status` defensively (Fix C).

### Verification

Phase 11.1 canary kickoff RETRY against `j.AI OneBox` / `c9d89a74-7179-4033-93ea-56267cf42a17` after the patch:

- The benign `UPDATE rr_cyclecount_data SET notes = … WHERE id='e7532d59-…'` that previously raised `42804` now succeeds; the trigger UPSERT's the projection's `result_payload->>'notes'` to mirror the legacy `notes` column.
- Synthetic 3-row micro-backfill (bump `updated_at` on three pre-picked rows) successfully projected all three rows into `work_tasks` via the UPSERT branch; field-level drift `(assignee_drift, priority_drift, status_drift)` stayed at `(0, 0, 0)` throughout.
- Three-row spot check matched expected mappings exactly: `pending→pending/null/normal`, `completed→completed/null/normal`.
- Migration 266 zone-exclusivity smoke (two-operator-same-zone) raised `ZONE_LOCKED: active` from `enforce_work_task_zone_exclusivity()` line 211 with operator A's identity in DETAIL — exact match to mig 266 contract. Bidirectional reverse-projection sync confirmed working end-to-end.

### Final flag state on canary org

`work_tasks_shadow_write=true` (intentional for the 8h soak window per phase-11-rollout §11.3), all other flags at default.

### Related

- `supabase/migrations/265_found_part_transfer_projection_safety.sql`
- `supabase/migrations/266_work_tasks_zone_exclusivity.sql`
- `docs/work-engine/baselines/canary-shadow-write-enabled-2026-05-02.json` — `retry_2026_05_02_post_mig_265` key
- [[Sessions/2026-05-02]] — "Phase 11.1 RETRY (post-mig 264/265/266) — SUCCESS" addendum
