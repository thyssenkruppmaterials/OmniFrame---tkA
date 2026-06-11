# Follow-on Plan — Zoning Work Type

**Status:** v1 shipped (additive, fully gated). Engine remains in shadow-write
for j.AI OneBox; the LT22 dispatch path will not insert any `work_tasks` rows
until an operator flips `work_engine_settings.feature_flags.work_engine_enabled`
to `true`.

**Migration:** `supabase/migrations/267_zone_audit_workflow_seed.sql`
**Frontend:** `src/lib/work-engine/work-types/zone-audit.tsx` +
`zone-audit-runner.tsx`
**OmniAgent:** `omni_agent/lt22_import.py` (`dispatch_zoning_tasks` +
helpers)
**Tests:** `src/lib/work-engine/__tests__/zone-audit.test.ts` +
`omni_agent/tests/test_zoning_dispatch.py`

---

## What Zoning Work Type does (operator-facing)

A **zone audit** is a sweep through every location in a logical SAP zone
(today: storage type 916 in PDC) where the operator verifies that the
on-hand inventory matches what SAP says it should be. Distinct from a
cycle count, which targets one location at a time:

| Work Type    | Scope                       | Trigger                          |
| ------------ | --------------------------- | -------------------------------- |
| Cycle Count  | One (location, material)    | Variance review / scheduled wave |
| Zone Audit   | Every (location, material)  | LT22 transfer-order pull         |
|              | within a zone               | (storage type 916 sweep)         |

Each LT22 row that touches a zoning-eligible storage type becomes one
`work_tasks` row with `task_type='zone_audit'`. Operators claim them
through the dock just like cycle counts; the four-step workflow
(`confirm` → `location_scan` → `quantity_entry` → `review`) reuses the
same `STEP_REGISTRY` components the cycle-count engine drives, so no
new RF UI is required.

## The 4-step default workflow

Migration 267 seeds one default `work_workflow_configs` row per org
keyed off `(work_kind='zone_audit', task_subtype='standard_audit')`:

| # | Step ID    | Step Type        | Label            | Required |
| - | ---------- | ---------------- | ---------------- | -------- |
| 1 | `confirm`  | `confirm`        | Confirm Zone     | yes      |
| 2 | `location` | `location_scan`  | Scan Location    | yes      |
| 3 | `quantity` | `quantity_entry` | Enter Quantity   | yes      |
| 4 | `review`   | `review`         | Review           | yes      |

The `review` step config carries the v1 thresholds:

```json
{ "review_threshold_pct": 10, "review_threshold_abs": 5 }
```

i.e. variance ≥ 10% **or** ≥ 5 EA flips the row into supervisor review.
Operators can amend per-org via the existing Count Settings tab; the
seeded row is just the starting baseline.

## The LT22 dispatch path

`omni_agent/lt22_import.py` runs the SAP LT22 transaction, parses the
result via the `%pc` bulk-export path, and bulk-INSERTs into
`public.sap_outbound_to_imports`. The zoning follow-on adds a **second
pass** after that legacy INSERT succeeds:

```
SAP LT22 result rows
        │
        ▼
normalize_lt22_row()              ← unchanged, primary path
        │
        ├──► sap_outbound_to_imports (bulk INSERT, chunks of 500)
        │
        └──► dispatch_zoning_tasks()
                 │
                 ├─ feature flag check                  ← skip-if-false
                 │  (work_engine_settings.feature_flags
                 │   ->>'work_engine_enabled')
                 │
                 ├─ filter rows by ZONING_STORAGE_TYPES (default ['916'])
                 │
                 └─ POST one work_tasks row per eligible row, with
                    Prefer: resolution=ignore-duplicates so a re-played
                    LT22 import is a clean no-op.
```

### Per-row mapping

| `work_tasks` field   | Source                                                        |
| -------------------- | ------------------------------------------------------------- |
| `task_type`          | `'zone_audit'`                                                |
| `task_subtype`       | `'standard_audit'`                                            |
| `primary_location`   | `source_storage_bin` (fallback: `dest_storage_bin`)           |
| `subject_material`   | `material`                                                    |
| `warehouse`          | `req.warehouse`                                               |
| `unit_of_measure`    | `unit_of_measure`                                             |
| `priority`           | `'normal'`                                                    |
| `payload.zone_id`    | first hyphen/slash segment of the bin (fallback storage type) |
| `payload.expected_count`  | `quantity`                                               |
| `payload.lt22_to_number`  | `to_number`                                              |
| `idempotency_key`    | `lt22:{to_number}:{item}` (or `lt22:{to_number}` if no item)  |
| `payload_version`    | `1`                                                           |
| `source_table`       | `'sap_outbound_to_imports'`                                   |

The unique index `(organization_id, task_type, idempotency_key)` from
migration 256 owns dedup, so re-importing the same LT22 result is
silent.

### Feature gating

`dispatch_zoning_tasks` short-circuits and returns `0` if **any** of:

- `state.supabase_token` / `state.supabase_url` is empty (agent not
  signed in)
- `work_engine_settings` has no row for the org
- `work_engine_settings.feature_flags->>'work_engine_enabled'` is
  `false` or null

The default in migration 256 seeds `work_engine_enabled: false` for
every org, so this code path is a guaranteed no-op until an operator
explicitly flips it.

`AGENT_VERSION` in `agent.py` is **not** bumped because the change is
strictly additive — older agent builds keep running unchanged when the
new agent code is still gated off.

## How to enable for a new org

When a new org is ready to graduate from cycle-count-only to also
running zone audits:

```sql
-- 1. (idempotent if mig 267 has already run for the org) seed the
--    default workflow config row.
INSERT INTO public.work_workflow_configs
  (organization_id, work_kind, task_subtype, display_name, description,
   is_active, steps, version, updated_by)
SELECT
  '<ORG_UUID>'::uuid,
  'zone_audit',
  'standard_audit',
  'Zone Audit — Standard Sweep',
  'Default 4-step workflow for zone audits seeded from LT22 transfer orders.',
  true,
  jsonb_build_array(
    jsonb_build_object('id','confirm','type','confirm','label','Confirm Zone','required',true,'order',1,'config','{}'::jsonb),
    jsonb_build_object('id','location','type','location_scan','label','Scan Location','required',true,'order',2,'config','{}'::jsonb),
    jsonb_build_object('id','quantity','type','quantity_entry','label','Enter Quantity','required',true,'order',3,'config','{}'::jsonb),
    jsonb_build_object('id','review','type','review','label','Review','required',true,'order',4,
      'config', jsonb_build_object('review_threshold_pct',10,'review_threshold_abs',5))
  ),
  1,
  (SELECT id FROM public.user_profiles WHERE organization_id = '<ORG_UUID>'::uuid LIMIT 1)
ON CONFLICT ON CONSTRAINT work_workflow_configs_org_kind_subtype_key DO NOTHING;

-- 2. Flip the per-type flag.
UPDATE public.work_type_settings
   SET enabled = true, updated_at = now()
 WHERE organization_id = '<ORG_UUID>'::uuid
   AND task_type = 'zone_audit';

-- 3. Add zone_audit to the engine's enabled-types array.
UPDATE public.work_engine_settings
   SET enabled_work_types = array_append(enabled_work_types, 'zone_audit'),
       updated_at = now()
 WHERE organization_id = '<ORG_UUID>'::uuid
   AND NOT 'zone_audit' = ANY(enabled_work_types);

-- 4. (Optional) Turn the LT22 → work_tasks dispatch ON for this org.
--    Steps 1-3 only make zone_audit available to manual seeders + the
--    dock; the OmniAgent dispatch is still gated on work_engine_enabled.
UPDATE public.work_engine_settings
   SET feature_flags = jsonb_set(feature_flags, '{work_engine_enabled}', 'true'::jsonb),
       updated_at = now()
 WHERE organization_id = '<ORG_UUID>'::uuid;
```

Step 4 is the **trigger** — once flipped, the next LT22 import will
fan rows out into `work_tasks`. Do **not** run step 4 on an org that
hasn't completed shadow-write soak.

## Open items for v2

These are intentionally deferred — none are blockers for the additive
v1 cut.

- **Zone-batch ranking.** Today every zoning-eligible LT22 row becomes
  an independent `work_tasks` row. Operators traversing the same zone
  would benefit from a "zone batch" abstraction (one claim covers all
  rows in a zone) so they're not re-claiming row by row. Lands behind a
  `zone_audit_batch_mode` setting.
- **Zone-completion summary.** A supervisor-facing tile that aggregates
  open + completed `zone_audit` rows by `dispatch_zone` for the active
  shift. Reuses the Operation Control queue panels.
- **Supervisor sign-off variant.** Variance-heavy zones should be able
  to require a supervisor PIN at the `review` step (the
  `complete_task_with_supervisor_pin` RPC from migration 259 already
  supports it; just needs a `task_subtype='supervised_audit'` workflow
  row + a registry entry).
- **Zone-pattern resolution.** Today `derive_zone_id` falls back to the
  first hyphen/slash segment of the bin; orgs with non-standard bin
  schemas will need their zone pattern wired through the existing
  `cycle_count_zone_rules.zone_pattern` regex (the `work_zone_of`
  helper already supports the pattern; just needs to be threaded into
  `dispatch_zoning_tasks`).
- **Worker capability seeding.** `zoneAuditWorkType.capabilityRequired
  = 'zone_audit'`, so a worker without `zone_audit` in
  `worker_profiles.preferred_task_types` cannot claim a zone audit
  task once `worker_capability_required` is on. Operators need a
  one-time bulk-update to seed the capability for the existing
  cycle-count crew.

## Related docs

- [README — Work Engine Foundation](./README.md)
- [Phase 11 rollout](./phase-11-rollout.md)
- [Phase 9 verification](./phase-9-verification.md)
- Authoritative plan (read-only): `.cursor/plans/work_engine_foundation_e9c4a217.plan.md`
