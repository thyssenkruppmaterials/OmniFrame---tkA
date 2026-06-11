---
tags: [type/debug, status/active, domain/database]
created: 2026-05-20
---
# Fix: Cycle Count Location Resolver — `IF FOUND` vs `IF v_result IS NOT NULL`

## Problem

Every `rr_cyclecount_data` row inserted via the application path landed with
`resolved_zone = 'unresolved'`, `resolved_aisle = 'unresolved'`,
`resolved_sequence = 0`, `resolution_source = 'unresolved'` — even when the
resolver function `resolve_cycle_count_location()` returned correct values
when called directly. As of investigation on 2026-05-20, 17,202 of 18,112
rows (95%) were poisoned, including 8,586 pending cycle counts.

This silently disabled `serpentine_zone` queue ordering in
`rust-work-service` because every ORDER BY in `db/queries.rs` is

```sql
ORDER BY priority_bucket,
         CASE WHEN resolution_source = 'unresolved' OR resolution_source IS NULL THEN 1 ELSE 0 END,
         resolved_zone, resolved_aisle, resolved_sequence,
         location, created_at
```

With every row in bucket `1`, the queue collapsed to lexical sort by
`location`. Veteran counters paper over the chaos by walking serpentine
from muscle memory; new counters (e.g. James Dearman, 66% same-aisle
progression on 2026-05-20) showed the true shape of the regression.

See [[Investigate-Cycle-Count-Paths-2026-05-20]] for the live walking-path
analysis that surfaced this.

## Root cause — plpgsql composite-NULL semantics

The BEFORE INSERT/UPDATE trigger `auto_resolve_cycle_count_location()`,
introduced in migration 204, used the wrong "row found" test:

```sql
SELECT * INTO v_result
FROM resolve_cycle_count_location(NEW.organization_id, NEW.warehouse, NEW.location)
LIMIT 1;

IF v_result IS NOT NULL THEN  -- bug
  -- copy values onto NEW
ELSE
  -- stamp 'unresolved'
END IF;
```

`v_result` is a `RECORD`. In PL/pgSQL, `<record> IS NOT NULL` returns TRUE
**only if every column of the record is non-NULL**. The resolver returns
`mapping_id = NULL` whenever a row resolves through a regex rule rather
than a `warehouse_location_mappings` hit (so the row knows its zone/aisle
but isn't pinned to a specific rack in the warehouse map). That single
NULL column made the composite test return FALSE, and the trigger
stamped `'unresolved'` on top of values that had been computed correctly.

The canonical idiom is `IF FOUND` — it asks the right question: "did the
previous `SELECT INTO` return at least one row?"

### Diagnosis trace

The smoking gun came from a debug `DO` block that mirrored the trigger
body:

```sql
DO $$
DECLARE v_result RECORD;
BEGIN
  SELECT * INTO v_result
  FROM resolve_cycle_count_location('c9d89a74...'::uuid, NULL, 'RM-69-B-02')
  LIMIT 1;
  INSERT INTO debug_trace VALUES ('found',                FOUND::text);
  INSERT INTO debug_trace VALUES ('v_result_is_not_null', (v_result IS NOT NULL)::text);
  INSERT INTO debug_trace VALUES ('resolved_zone',        v_result.resolved_zone);
  -- ...
END $$;
```

Result:

| col                    | val   |
| ---------------------- | ----- |
| `found`                | true  |
| `v_result_is_not_null` | **false** |
| `resolved_zone`        | Racks |
| `resolved_aisle`       | RM    |
| `source`               | rule  |

A row was returned, every interesting column was populated, but the test
that gated the assignment said "no row" because `mapping_id` was NULL.

## Fix

Migration `323_fix_cycle_count_resolve_found_check.sql`. Replaces the
trigger function with the `IF FOUND` variant and backfills every poisoned
row in a single transaction.

```sql
CREATE OR REPLACE FUNCTION public.auto_resolve_cycle_count_location()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_result RECORD;
BEGIN
  SELECT * INTO v_result
  FROM public.resolve_cycle_count_location(NEW.organization_id, NEW.warehouse, NEW.location)
  LIMIT 1;

  IF FOUND THEN
    NEW.resolved_location_key         := v_result.resolved_key;
    NEW.resolved_zone                 := v_result.resolved_zone;
    NEW.resolved_aisle                := v_result.resolved_aisle;
    NEW.resolved_sequence             := v_result.resolved_seq;
    NEW.resolution_source             := v_result.source;
    NEW.warehouse_location_mapping_id := v_result.mapping_id;
  ELSE
    NEW.resolved_location_key         := TRIM(NEW.location);
    NEW.resolved_zone                 := 'unresolved';
    NEW.resolved_aisle                := 'unresolved';
    NEW.resolved_sequence             := 0;
    NEW.resolution_source             := 'unresolved';
    NEW.warehouse_location_mapping_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;
```

### Backfill design

The backfill UPDATEs ONLY the `resolved_*` columns; the BEFORE trigger is
scoped `OF location, warehouse`, so the BEFORE pass does **not** refire
and recompute on every poisoned row. To suppress side-effects on the
one-time UPDATE storm:

- `SET LOCAL app.skip_sync = 'true'` — `sync_cycle_count_to_work_task`
  short-circuits. The `work_tasks` projection does not include the
  resolved_* columns, so there is nothing for it to propagate; skipping
  also avoids 17K UPSERTs against `work_tasks`.
- `SET LOCAL app.cycle_count_zone_lock_bypass = 'on'` —
  `enforce_cycle_count_zone_exclusivity` short-circuits. The backfill
  never changes `assigned_to` or `status`, so there is nothing to
  validate.
- The `audit_rr_cyclecount_data` and `notify_cycle_count_data_changed`
  triggers still fire — acceptable: 17K extra audit rows (table is
  already 240K+ rows) and 17K `pg_notify` events for `rust-work-service`
  to consume as cache-invalidation hints.

### Apply / verify trace

| Step                                          | Result                                                            |
| --------------------------------------------- | ----------------------------------------------------------------- |
| Migration applied                             | success                                                           |
| Total rows w/ `resolution_source='unresolved'` before | 17,202                                                     |
| Total rows w/ `resolution_source='rule'` after        | 17,099                                                     |
| Remaining `unresolved` after                  | 103 (genuine format outliers like `RM-75A`, `RP-52-B-1A`)         |
| End-to-end INSERT test — `RM-69-B-02`         | `Racks / RM / 6902 / rule`                                        |
| End-to-end INSERT test — `SP-22-A-04`         | `Shelves / SP / 2204 / rule`                                      |
| End-to-end INSERT test — `K2-15-03-08`        | `Kardex / K2 / 150308 / rule`                                     |
| End-to-end INSERT test — `GIBBERISH`          | `unresolved / unresolved / 0 / unresolved` (correct fallback)     |
| Next 15 tasks served by pull-claim queue      | clean serpentine RK-64-D → E → F across slots 01–03, then RK-65 … |

## Follow-ups

1. The 103 still-unresolved pending rows use non-standard location formats
   (`RM-75A`, `RN-72A`, `RP-52-B-1A`, `RP-52-C-1B`, etc.). These aren't
   handled by the existing three regex rules. Either extend
   `cycle_count_location_resolution_rules` to cover the `R[J-Q]-(\d+)[A-Z]?`
   shape, or scrub the inputs upstream of the cycle-count generator.
2. Add a daily "queue-served-in-order %" metric on the Shift Productivity
   dashboard so a future regression of this trigger cannot go silent for
   weeks. Compute as: of consecutive completed counts per operator, the
   share that stayed in the same `resolved_rack` AND `resolved_aisle` as
   the previous count.
3. Audit every other trigger that does `SELECT * INTO v_record FROM
   set_returning_function(...)` followed by `IF v_record IS NOT NULL` —
   the same gotcha may exist elsewhere. Quick grep target across the
   migrations directory.

## Related

- [[Investigate-Cycle-Count-Paths-2026-05-20]] — walking-path analysis that surfaced the regression.
- [[Investigate-Work-Tasks-Capacity-Gate-Returning-Existing-Task]] — earlier note that flagged `resolved_zone='unresolved'` symptom without identifying the cause.
- [[Components/RFCycleCountServices - Supabase Service]]
- [[Components/Rust-Work-Service]]
- Migration: `supabase/migrations/204_create_cycle_count_path_rules_engine.sql` (original buggy function)
- Migration: `supabase/migrations/323_fix_cycle_count_resolve_found_check.sql` (fix + backfill)
- Rust ORDER BY: `rust-work-service/src/db/queries.rs` lines 122–135, 299–340, 478–530, 1190–… (every pull-claim query)
- Canvas: `cycle-count-paths-2026-05-20.canvas.tsx`
