---
title: Priority Rules + Heartbeat Auto-Release + Zone Bypass
date: 2026-04-22
tags: [cycle-count, priority-rules, zone-exclusivity, scheduler, work-engine, enterprise]
status: shipped
---

# Priority Rules engine, Zone Bypass overrides, Scheduler heartbeat release

Three additions on top of the 225/227/228/229 zone engine, all composable.

## 1. Rust scheduler — auto-release on stale heartbeat

`rust-work-service/src/scheduler/mod.rs::detect_and_release_abandoned` now calls `release_stale_heartbeat_assignments(10)` alongside the existing `updated_at > 30 min` check on every 5-minute tick. Both sets of released rows flow through the same `TaskStatusChanged` websocket emission so the UI refreshes consistently.

SQL side: `release_stale_heartbeat_assignments(p_threshold_minutes int)` returns one row per released count (`out_count_id`, `out_count_number`, `out_previous_owner`). Internally calls `set_config('app.cycle_count_zone_lock_bypass', 'on', true)` so the zone trigger doesn't reject our own release writes.

Result: admin-assigned-to-offline-user situations (the Angela → Alessandro scenario) self-heal within 5–15 minutes without manual intervention.

## 2. Zone Bypass Overrides (dynamic overrides)

Two new columns on `cycle_count_zone_rules`:
- `bypass_priorities  TEXT[]` — priority values (e.g. `{'critical','hot'}`) that cut through an active zone lock.
- `bypass_count_types TEXT[]` — count-type slugs (e.g. `{'part_verification','audit'}`) exempt from zone mutual exclusion.

The trigger checks these BEFORE raising `ZONE_LOCKED`/`ZONE_ASSIGNED`. This is the dynamic-override surface: emergency recounts skip the queue, and non-disruptive inspections (like part verification) don't count toward zone occupancy.

Exposed in the Zone Rules panel as a new "Dynamic overrides" card under the policy selector — priority toggles + free-form count-type chip editor.

## 3. Priority Rules Engine

New table `cycle_count_priority_rules`:

| Column | Type | Notes |
|-------|------|------|
| `id` | uuid | PK |
| `organization_id` | uuid | FK, RLS-scoped |
| `name` | text | human label |
| `enabled` | bool | pause without deleting |
| `priority_level` | text | critical/hot/normal/low — what this rule assigns |
| `match_zone` | text | nullable match: `K1`, `SC`, … |
| `match_count_type` | text | nullable match: `999_count`, `part_verification`, … |
| `match_warehouse` | text | nullable match |
| `match_age_gte_hours` | int | nullable match: row created ≥ N hours ago |
| `match_variance_gte_pct` | numeric(6,2) | nullable match: variance ≥ pct |
| `match_requires_recount` | bool | nullable match |
| `sort_order` | int | lower = higher precedence (CSS-specificity model) |
| `notes` | text | admin notes |

All set fields must match AND-style. First rule hit (by `sort_order` ASC) wins — no cascading updates.

### Evaluator

`apply_cycle_count_priority_rules(p_org_id uuid DEFAULT NULL) → jsonb` re-scores every pending / recount row in the org. Idempotent: only issues UPDATEs for rows whose priority actually changes. Returns `{ success, organization_id, touched }`.

Live smoke test on j.AI OneBox: inserted a "K1 is critical" rule → 943 K1 rows flipped from `normal` to `critical` in one call, K2 untouched. Test rule removed + rows reverted after verification.

### UI

New **Priority Rules** tab in Count Settings (fourth section, Zap icon) with:
- List of rules showing precedence (`#10`), priority badge (`→ critical`), and matched conditions as chips.
- "New Rule" dialog with fields for all match conditions + priority + sort_order + notes.
- **"Evaluate Now"** button that runs the evaluator and toasts the row count.
- Disabled rules are muted; delete requires `confirm()`.

## Live verification

- `SELECT * FROM release_stale_heartbeat_assignments(10)` — returned 1 stuck row (`CC-20260413-0073`) that had been reassigned to an offline user. Released cleanly.
- Priority evaluator — 943 K1 rows correctly re-scored; revert SQL returned them to `normal`.
- `tsc -b --noEmit` clean; ESLint clean on all touched files; 54/54 cycle-count service/hook tests pass.
- Rust `cargo check` clean.

## Deployment

- Migration 230 applied via Supabase MCP.
- **Rust work-service redeploy required** for the scheduler heartbeat release to run every 5 min; existing `updated_at > 30 min` path keeps working without the redeploy.
- Frontend: `Priority Rules` tab + "Dynamic overrides" section on the Zone Rules card appear on next bundle deploy.

## Files touched

- `supabase/migrations/230_priority_rules_and_zone_bypass.sql` (new)
- `rust-work-service/src/scheduler/mod.rs` (heartbeat release)
- `src/lib/supabase/priority-rules.service.ts` (new)
- `src/lib/supabase/zone-rules.service.ts` (bypass fields)
- `src/hooks/use-priority-rules.ts` (new)
- `src/components/priority-rules-panel.tsx` (new)
- `src/components/zone-rules-panel.tsx` (Dynamic overrides card)
- `src/components/count-settings.tsx` (4th tab)
