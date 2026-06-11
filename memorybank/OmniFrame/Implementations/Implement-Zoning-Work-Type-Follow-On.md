---
tags: [type/implementation, status/active, domain/backend, domain/frontend, domain/database]
created: 2026-05-02
---
# Implement Zoning Work Type Follow-On

## Purpose / Context
First follow-on plan that builds on the Work Engine Foundation. Activates the previously-stubbed `zone_audit` WorkType across (a) the frontend registry, (b) Supabase as a default workflow + canary enablement, and (c) the OmniAgent LT22 import path. The change is **fully additive and double-gated**: per-type `enabled` flag + `work_engine_settings.feature_flags.work_engine_enabled` (kept `false` everywhere). The legacy `sap_outbound_to_imports` insert path is untouched.

## Details

### A. Frontend WorkTypeConfig
- Renamed stub `src/lib/work-engine/work-types/zone-audit.ts` → real `zone-audit.tsx` exporting `zoneAuditWorkType: WorkTypeConfig<WorkTask>` with `enabled: true`, `capabilityRequired: 'zone_audit'`, `dockMenuLabel: 'Zone Audit'`, `icon: Map`.
- Default workflow: `confirm` → `location_scan` → `quantity_entry` → `review`. All four step types live in `STEP_REGISTRY` so no new RF UI needed.
- New `zone-audit-runner.tsx` thin wrapper: drives `useTaskWorkflowRuntime` against the registry's step components, projecting `task.payload.{zone_id, expected_count}` onto the cycle-count-shaped `StepProps.taskData`.
- `buildZoneAuditResultPayload(task, state)` returns `{ counted_quantity, notes, variance_quantity }`. Variance is `counted - expected`; missing counted → 0 (operator confirmed empty bin).
- Extended `ZoneAuditTask.payload` in `src/lib/work-service/work-task-types.ts` with optional `counted_quantity`, `lt22_to_number` so the LT22 dispatch can attach SAP TO metadata type-safely.
- Tests: `src/lib/work-engine/__tests__/zone-audit.test.ts` (7 tests). Updated `registry.test.ts` to allow zone_audit + pick enabled. **All 17 vitest tests pass.**
- Drive-by: pick-runner.tsx had pre-existing TS errors (`@/stores/authStore`, step type) — fixed by switching to `useSupabaseAuth` and the same strict-step-type cast used in zone-audit-runner.tsx so the verification loop's `tsc` runs clean.

### B. Migration 267_zone_audit_workflow_seed.sql
- Drops the redundant legacy unique constraint `cycle_count_workflow_configs_organization_id_count_type_key` (carried forward from mig 203b through mig 258's rename) — the work-kind-aware constraint `work_workflow_configs_org_kind_subtype_key` is the right shape and the legacy one would block multi-kind seeding with the same task_subtype.
- Inserts one default `work_workflow_configs` row per org (with at least one user) for `(work_kind='zone_audit', task_subtype='standard_audit', display_name='Zone Audit — Standard Sweep')`. Steps shape mirrors mig 203f's cycle-count seed.
- Flips `work_type_settings.enabled = true` for j.AI OneBox (`c9d89a74-7179-4033-93ea-56267cf42a17`) and appends `'zone_audit'` to `work_engine_settings.enabled_work_types` (idempotent).
- **Does NOT touch** `feature_flags.work_engine_enabled` — stays false so the OmniAgent dispatch is a no-op until an operator turns it on.
- Applied via Supabase MCP — verified 1 zone_audit workflow row created, `enabled_work_types = ['cycle_count', 'zone_audit']`, `work_engine_enabled = false`.

### C. OmniAgent LT22 dispatch (`omni_agent/lt22_import.py`)
- Constants `ZONING_STORAGE_TYPES = ['916']`, `ZONING_TASK_TYPE`, `ZONING_TASK_SUBTYPE`.
- New helpers: `is_zoning_eligible(row)`, `derive_zone_id(row)` (first hyphen/slash segment of bin, fallback to storage type), `_is_work_engine_enabled(state, org_id)` (defensive — any failure → False), `build_zoning_task(row, req)`, `dispatch_zoning_tasks(state, req, normalized)`.
- Wired AFTER the legacy `sap_outbound_to_imports` chunk INSERT loop succeeds. Failures wrapped in try/except — never fail the primary import on a zoning glitch.
- Per-row payload: `task_type='zone_audit'`, `task_subtype='standard_audit'`, `payload={zone_id, expected_count, lt22_to_number}`, `idempotency_key=f"lt22:{to_number}:{item}"`. The unique index `(organization_id, task_type, idempotency_key)` from mig 256 owns dedup.
- POST headers: `Prefer: return=representation,resolution=ignore-duplicates` so a re-played LT22 import is a clean no-op (HTTP 201 with empty body) rather than a 409.
- Per-row stdout log: `[zoning-dispatch] inserted task <uuid> for to_number=… item=…` / `[zoning-dispatch]  duplicate (idempotency hit) ...`.
- **`AGENT_VERSION` NOT bumped** — change is strictly additive.
- Tests: `omni_agent/tests/test_zoning_dispatch.py` — 15 tests, all green. Covers eligibility predicate, zone-id derivation, payload construction, feature-flag short-circuit, happy-path POST, replay idempotency.

### D. Documentation
- New `docs/work-engine/follow-on-zoning.md` — operator-facing description, 4-step workflow table, LT22 dispatch flowchart, per-row mapping table, enable-for-new-org SQL snippet, v2 open items (zone-batch ranking, zone-completion summary, supervisor sign-off variant, zone-pattern resolution, worker capability seeding).
- Cross-link added to `docs/work-engine/README.md` under a new "Follow-on plans" section above the deferred-operator-follow-up section.

## Verification
- `pnpm exec tsc -p tsconfig.app.json --noEmit` → exit 0
- `pnpm exec vitest run --no-coverage src/lib/work-engine/__tests__/` → 17/17 pass (registry ⨯ 4, zone-audit ⨯ 7, pick ⨯ 6)
- `python -m pytest omni_agent/tests/test_zoning_dispatch.py -v` → 15/15 pass
- Supabase spot-check: `enabledWorkTypes('c9d89a74-...')` would resolve to `['cycle_count', 'pick', 'zone_audit']` post-migration (pick enablement is the parallel pick follow-on; zone_audit is mine).

## Related
- [[Implement-Work-Engine-Foundation]]
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Patterns/Work-Tasks-Zone-Exclusivity]]
