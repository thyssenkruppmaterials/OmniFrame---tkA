# Phase 11 — Staged Rollout and Soak

This phase is required before Phase 11.5 destructive cleanup or
source-of-truth claims.

## 11.1 Migration-only deploy

```bash
# Apply migrations 256-261 (all reads still legacy-primary).
supabase db push  # or your equivalent migrate command

# Verify all required objects landed.
psql -f supabase/tests/work_engine_migration_range.sql

# Enable shadow writes for ONE non-production org first.
psql -c "UPDATE work_engine_settings
            SET feature_flags = feature_flags || '{\"work_tasks_shadow_write\":true}'::jsonb
          WHERE organization_id = '<staging-org-uuid>';"
```

Leave `work_tasks_read_primary = false` everywhere.

## 11.2 Reconciliation reports

For each enabled org, run nightly:

```bash
node scripts/backfill/work_tasks_from_cycle_count.mjs --org <uuid>
psql -c "SELECT * FROM work_engine_drift WHERE organization_id = '<uuid>';"
```

Acceptance: every metric (`missing_in_shadow`, `assignee_drift`,
`priority_drift`, `status_drift`) MUST be zero before read-cutover.

## 11.3 Canary

- Pick one production org with low cycle-count volume.
- Enable `work_tasks_read_shadow = true` for ≥ 1 full warehouse shift OR 8
  hours, whichever is longer.
- Need ≥ 50 cycle-count lifecycle transitions covering pull-claim,
  supervisor push, complete, release, photo/artifact, and signoff paths
  during the window.
- If volume is low, run the staging replay script to synthesize the
  required shape (operator-driven; not committed to the repo).

After acceptance:

- Flip `work_tasks_read_primary = true` for the canary org only.
- Run RF claim/start/complete/release, supervisor push/batch push, photo
  upload, signoff, and desktop mass operations.
- Run the Phase 0.3 rollback drill while work is in flight.

## 11.4 Production rollout

- Expand org by org.
- Monitor: Rust work-service errors, Supabase postgres/realtime logs,
  storage errors, advisor deltas.
- **Roll back immediately on:** data drift, RLS denial spikes, duplicate
  claims, lost artifacts, failed legacy compatibility routes.

## 11.4a Pre-`work_tasks_read_primary` checklist

Before flipping `work_tasks_read_primary = true` for any org, the
following deferred items MUST be closed (they're non-blockers while
`rr_cyclecount_data` is the read source of truth, but become correctness
issues the moment reads cut over):

- [ ] **Found-part-transfer projection branch** — the cycle-count →
  work_tasks projection (migration 257) currently does NOT emit a
  separate `work_tasks` row for the found-part-transfer side effect.
  Today this is harmless because reads still hit `rr_cyclecount_data`,
  which carries `transfer_destination_location` /
  `transfer_source_quantity` natively. After read cutover, downstream
  consumers reading from `work_tasks` will see the parent count without
  the transfer side effect. Tracked as a follow-on plan; ship before
  read cutover.
- [ ] **`work_tasks` advisory-locked zone exclusivity** — see
  `docs/work-engine/README.md` "Operator follow-up" → "work_tasks
  advisory-locked zone exclusivity" for the deferral rationale. Required
  before reads cut over so the new table holds the same uniqueness
  invariants as `rr_cyclecount_data`.
- [ ] **Strategy registry → `claim_next` wiring** — the Rust
  `crate::strategies::*` registry exists but `claim_next` does not
  consult it (Plan §2 — preserve current dispatcher semantics until
  cutover). Wiring needs to land before reads switch so per-work-type
  ordering / capability filters take effect.
- [ ] **Database types regen** — see README "Operator follow-up" →
  "Database types regeneration". Frontend cast layer must be removed
  before cutover so type errors surface at build time, not at runtime.

## 11.5 Cleanup after soak

Only after a successful soak window (≥ 14 days, zero drift, zero P0/P1):

- Delete deprecated services / components (call sites of
  `rf-cycle-count.service.ts`, `use-cycle-count-draft.ts`,
  `count-resume-prompt.tsx`).
- Remove compatibility route wrappers (`claim_next_cycle_count`,
  `complete_cycle_count`).
- Remove legacy draft migration code from `useTaskWorkflowRuntime`.
- Consider deprecating `work_queue` only after kit Kanban references are
  migrated or removed.
- Final migration marks `rr_cyclecount_data` as projection-only (or
  archived) if the business still needs it for reporting.
