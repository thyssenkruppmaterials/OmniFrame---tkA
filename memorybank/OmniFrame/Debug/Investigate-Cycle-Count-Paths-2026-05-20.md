---
tags: [type/debug, status/active, domain/database, domain/frontend]
created: 2026-05-20
---
# Investigate: Cycle Count Walking Paths — 2026-05-20

## Purpose / Context

User asked to characterise how today's cycle counters actually walked the floor — are they serpentine (linear) or zig-zagging across racks? This investigation was driven by live Supabase data, not the UI.

Analysis surfaced a **silent path-engine regression** that nobody had noticed: the queue-ordering trigger is no longer populating `resolved_zone` / `resolved_aisle` / `resolved_sequence` on insert, so the pull-claim queue is falling back to insertion order. Workers' linearity comes from physical self-routing, not from the engine.

Full breakdown lives in the canvas `cycle-count-paths-2026-05-20.canvas.tsx`. This note captures the diagnosis + repro for the path-engine bug only.

## Live numbers (2026-05-20 EST)

- 517 counts completed today across 5 counters.
- 100% of those rows have `resolution_source = 'unresolved'` and `resolved_zone = 'unresolved'`.
- 100% are `push_mode = 'pull'` (no pushed work), `warehouse_location_mapping_id IS NULL`.
- Per-counter linearity (share of consecutive counts that stayed in the same rack+aisle):
  - Erick Robinson — 223 counts, **82.9%** linear, 18 rack switches, max aisle jump 2.
  - Marvin Berry — 162 counts, **78.3%** linear, 26 rack switches, max aisle jump 6, 3 variance-review flags.
  - David Simmons — 75 counts, **73.0%** linear, 16 rack switches, max aisle jump 7.
  - James Dearman — 42 counts, **65.9%** linear, 10 rack switches.
  - Nikki Mason — 15 counts in 16 min (cameo), **71.4%** linear.

Median inter-count delay 45–110 s across counters — consistent with "walk, scan, count, confirm".

## Root-cause hypothesis — INSERT trigger order

Calling the resolver function directly works:

```sql
SELECT * FROM resolve_cycle_count_location(
  'c9d89a74-7179-4033-93ea-56267cf42a17'::uuid, NULL, 'RM-69-B-02'
);
-- resolved_key=RM-69-B-02, zone=Racks, aisle=RM, seq=6902, source=rule
```

But every row in `rr_cyclecount_data` for today stores `zone='unresolved'`. So the BEFORE-INSERT trigger `trigger_auto_resolve_location` either isn't firing, or another trigger is overwriting its work.

Trigger order on `rr_cyclecount_data` (alphabetical, INSERT):

1. `audit_rr_cyclecount_data_trigger`
2. `rr_cyclecount_data_notify_changed`
3. `trg_sync_cycle_count_to_work_task`
4. `trigger_auto_calculate_variance`
5. `trigger_auto_resolve_location` ← writes `resolved_zone`
6. `trigger_maintain_reservation_started_at`
7. `trigger_stamp_workflow`
8. `zzz_trigger_enforce_zone_exclusivity` ← suspect; the `zzz_` prefix forces it last so it can re-read the NEW resolved values

Leading hypothesis: `enforce_cycle_count_zone_exclusivity()` is either resetting `NEW.resolved_zone := 'unresolved'` defensively, or its SECURITY DEFINER context is masking the resolver's writes when it re-evaluates against an empty `cycle_count_zone_assignments` table (0 rows today). Worth one focused pass on its source.

A second possibility: the BEFORE INSERT trigger uses `STABLE SECURITY DEFINER` resolver; if the session role can't see the active rule rows under RLS the resolver hits its final fallback and writes `'unresolved'` itself. The fact that calling the resolver as a superadmin works doesn't rule this out.

## Why workers still look linear despite the regression

- The Racks zone is geographically organised — RJ → RK → RL → RM → RN → RO are physically adjacent rows.
- Veteran counters memorise the serpentine and walk it themselves; the queue happens to serve insert-order which usually correlates with location ordering for batched counts.
- New counters (James, 66% linearity, 10 rack-switches in 41 steps) look much more chaotic — the canary for what happens when route-memory isn't available.

## Reproduction

```sql
-- 1. Confirm the regression: every recent row is 'unresolved'.
SELECT resolution_source, count(*)
FROM rr_cyclecount_data
WHERE completed_at >= (now() AT TIME ZONE 'America/New_York')::date AT TIME ZONE 'America/New_York'
GROUP BY resolution_source;

-- 2. Confirm the resolver itself works.
SELECT * FROM resolve_cycle_count_location(
  'c9d89a74-7179-4033-93ea-56267cf42a17'::uuid, NULL, 'RM-69-B-02'
);

-- 3. Inspect the suspect trigger source.
SELECT pg_get_functiondef('enforce_cycle_count_zone_exclusivity'::regproc);

-- 4. Targeted INSERT to confirm the after-state.
-- (Wrap in a transaction that ROLLBACKs to avoid polluting prod data.)
BEGIN;
INSERT INTO rr_cyclecount_data (organization_id, count_number, location, status, system_quantity)
VALUES ('c9d89a74-...', 'CC-DBG-001', 'RM-69-B-02', 'pending', 0)
RETURNING resolved_zone, resolved_aisle, resolution_source;
ROLLBACK;
```

## Fix sketch (out of scope for this note)

1. Patch `auto_resolve_cycle_count_location()` (or whatever the zone-exclusivity trigger does) so the resolver's writes survive every subsequent trigger.
2. One-time UPDATE to backfill historical rows:

   ```sql
   UPDATE rr_cyclecount_data t
   SET (resolved_location_key, resolved_zone, resolved_aisle, resolved_sequence, resolution_source, warehouse_location_mapping_id) =
       (r.resolved_key, r.resolved_zone, r.resolved_aisle, r.resolved_seq, r.source, r.mapping_id)
   FROM resolve_cycle_count_location(t.organization_id, t.warehouse, t.location) r
   WHERE t.resolution_source = 'unresolved' AND t.deleted_at IS NULL;
   ```
3. Add a daily "queue-served-in-order %" metric to the Shift Productivity dashboard — same formula as the Same-Aisle% above — so this regression cannot reappear silently.

## Related

- [[Components/RFCycleCountServices - Supabase Service]]
- [[Context/Database-Schema-Overview]]
- [[Debug/Fix-CycleCount-Location-Ordering]]
- [[Debug/Investigate-Work-Tasks-Capacity-Gate-Returning-Existing-Task]] — earlier note that flagged `resolved_zone='unresolved'` on every recent cycle count row; this is the deeper root cause.
- [[Decisions/ADR-Floor-Mapping-Build-vs-Buy]] — context for the existing symbolic Path Engine.
- Canvas: `cycle-count-paths-2026-05-20.canvas.tsx` (per-counter walking-path SVG + full data).
