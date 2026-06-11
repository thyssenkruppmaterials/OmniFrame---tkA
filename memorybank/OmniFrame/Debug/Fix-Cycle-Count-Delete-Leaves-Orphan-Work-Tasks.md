---
tags:
  - type/debug
  - status/active
  - domain/database
  - cycle-count
  - work-engine
created: 2026-05-19
---
# Fix — Hard DELETE on rr_cyclecount_data Leaves Orphan work_tasks

## Symptom
Fresh bulk imports on the Inventory Counts tab failed at every row with:

```
duplicate key value violates unique constraint "work_tasks_org_type_number_uniq"
```

The progress dialog (per [[Add-Bulk-Import-Progress-Dialog-Inventory-Counts]]) showed the latest failure ("Row 64"), but in reality every row was failing the same way — each `createCycleCount` regenerated the same `CC-YYYYMMDD-0001` number and the projection trigger blew up.

## Root cause
[[Inventory-Counts-Tab-Comprehensive-Redesign|Migration 257]] + [[…|migration 265]] installed the bi-directional projection between `rr_cyclecount_data` and `work_tasks` but **only on `INSERT` and `UPDATE`**. There is no DELETE branch.

When [[Fix-Inventory-Counts-Total-Mismatch|the 2026-05-18 cleanup]] hard-deleted 505 pending cycle counts from `rr_cyclecount_data`, the projection trigger never ran for the DELETE, so 505 rows in `work_tasks` (task numbers `CC-20260519-0001 … 0505`, all `status='pending'`, all pointing at now-missing `source_id`s) survived. Because `work_tasks_org_type_number_uniq (organization_id, task_type, task_number) WHERE deleted_at IS NULL` enforces task-number uniqueness across **all** non-soft-deleted rows in an org, any new cycle count whose generator hands out a colliding number is rejected, and the AFTER INSERT trigger error rolls the `rr_cyclecount_data` insert back too.

The `generate_count_number()` advisory-locked generator queries `MAX(count_number) FROM rr_cyclecount_data` — it knows nothing about `work_tasks`, so as long as `rr_cyclecount_data` had zero rows for the date prefix it kept handing out `CC-YYYYMMDD-0001` even though `work_tasks` had 505 rows starting from `0001`.

A contributing detail: `generate_count_number()` uses `CURRENT_DATE` (server-local), not EDT, so rows created at ~2026-05-18 20:50 EDT were stamped with the **2026-05-19** date prefix because that was UTC's current date at the time — which is why orphan numbers were `CC-20260519-XXXX` not `CC-20260518-XXXX`.

## Fix
### 1. Immediate cleanup
Hard-deleted the 505 orphan `work_tasks` rows. Belt-and-braces predicates: `task_type='cycle_count' AND source_table='rr_cyclecount_data' AND task_number LIKE 'CC-20260519-%' AND status='pending' AND deleted_at IS NULL AND source_id` resolves to no `rr_cyclecount_data` row.

Pre-flight checks: 0 `work_events` and 0 `task_artifacts` referenced the orphans (the `work_events` FK is `RESTRICT`, so this had to be verified before deleting).

### 2. Migration `316_cycle_count_to_work_tasks_delete_projection.sql`
Added a DELETE projection trigger that mirrors the shape of the existing forward trigger:

- Gated by `work_engine_feature_flag(OLD.organization_id, 'work_tasks_shadow_write')` so dormant orgs are no-ops.
- Sets `app.skip_sync='true'` for the duration so the reverse trigger (`trg_sync_work_task_to_cycle_count`) doesn't try to write back into the source row that's mid-delete.
- Sets `app.work_zone_lock_bypass='on'` for GUC symmetry with the forward triggers (harmless for DELETE).
- Targets `(source_table='rr_cyclecount_data', source_id=OLD.id, task_type='cycle_count', organization_id=OLD.organization_id)` so it can never delete a `work_tasks` row that came from a different pipeline (SAP agent, etc.).

## Verification
- `apply_migration` succeeded; `pg_trigger` confirms `trg_sync_cycle_count_delete_to_work_task` is bound to `rr_cyclecount_data` for `AFTER DELETE`.
- Post-cleanup orphan count = 0; `MAX(count_number)` and `MAX(task_number)` both NULL for the day prefix, so the next `generate_count_number()` call resets to `CC-20260519-0001` cleanly.

## Lessons / related guard rails
- Any future cleanup of `rr_cyclecount_data` should always be paired with a check on `work_tasks` orphans — even though migration 316 now auto-cleans, ad-hoc fixes via `service_role` that go through the trigger will be covered, but bulk operations that disable triggers (`ALTER TABLE … DISABLE TRIGGER`) would not.
- `generate_count_number()` queries only `rr_cyclecount_data`. If the work-engine cutover ever flips the canonical store to `work_tasks`, the generator must be widened to `GREATEST(MAX(rr_cyclecount_data.count_number), MAX(work_tasks.task_number))` or the generator must move to a sequence keyed off `work_tasks`.

## Related
- [[Fix-Inventory-Counts-Total-Mismatch]] — the prior 505-row delete that created the orphans.
- [[Add-Bulk-Import-Progress-Dialog-Inventory-Counts]] — the progress dialog that surfaced the per-row failure messages.
- [[ManualCountsSearch - Inventory Tab]]
