---
tags: [type/pattern, status/active, domain/database, domain/backend, zone-exclusivity, work-engine]
created: 2026-05-02
---
# Pattern: work_tasks zone exclusivity (mig 266)

## Purpose / Context

Mirrors the legacy `enforce_cycle_count_zone_exclusivity` (mig 225/230/232/233/252/253) bug-for-bug onto `public.work_tasks`. Required to make `work_tasks_read_primary` per-org cutover safe — until this trigger exists, the new table accepts writes that violate the same invariants the legacy trigger holds on `rr_cyclecount_data`.

The legacy trigger stays authoritative on `rr_cyclecount_data` because the engine is shadow-only today. Once an org flips `work_tasks_read_primary`, this trigger becomes the source of truth for that org's zone semantics.

## Details

### Trigger naming + ordering

- Trigger: `trg_zzz_enforce_work_task_zone_exclusivity`. The `zzz_` prefix forces alphabetical-last firing so it runs AFTER all maintenance triggers from mig 256.
- PostgreSQL fires BEFORE-row triggers in alphabetical name order. Verified order on `work_tasks`:
  1. `trg_maintain_work_task_reservation` — stamps `reservation_started_at`.
  2. `trg_sync_work_task_to_cycle_count` (AFTER trigger — doesn't affect BEFORE order).
  3. `trg_work_tasks_dispatch_zone` — computes `NEW.dispatch_zone` from `primary_location` + org pattern.
  4. `trg_work_tasks_updated_at` — touches `updated_at`.
  5. `trg_zzz_enforce_work_task_zone_exclusivity` — reads the post-stamp NEW row.
- An in-migration `pg_trigger` row-number assertion catches any future rename that breaks this ordering.

### Trigger function order of operations

1. **GUC bypass** — `app.cycle_count_zone_lock_bypass=on` (legacy) OR `app.work_zone_lock_bypass=on` (new) short-circuits. SECURITY DEFINER RPCs that already hold the invariants (e.g. `reassign_work_zone`) set the new GUC.
2. **Terminal-status short-circuit** — `completed`, `cancelled`, `paused` never hold zone.
3. **Unassigned short-circuit** — `assigned_to IS NULL` never holds zone.
4. **Should-check decision** — INSERT always checks; UPDATE checks only on assignee change, status flip into `claimed`/`in_progress`, or dispatch_zone change.
5. **Org rules lookup** — `work_zone_rules` view (mig 256 §12 passthrough of `cycle_count_zone_rules`). If missing, disabled, or `policy='off'`, return.
6. **NULL-zone fallback** — governed by `treat_null_zone_as_locked` (mig 252 column). When on, falls back to LOCATION-EXACT-MATCH exclusivity with its own per-(org, location) advisory lock.
7. **Zone-to-user assignment check** — ALWAYS enforced (never bypassable). Reads `work_zone_assignments` view (mig 256 §12 passthrough of `cycle_count_zone_assignments`). Raises `ZONE_ASSIGNED` if a different user owns the zone.
8. **Critical priority bypass** — `priority='critical'` short-circuits the occupancy check. Mig 252 contract: saturated zones never hide critical work.
9. **Bypass priorities + subtypes** — reads `work_zone_rules.bypass_priorities` and `bypass_count_types` (semantically `bypass_subtypes` for work_tasks since `task_subtype` is the moral equivalent of `count_type`).
10. **Supervisor protection** — `supervisor_assigned_at` within `supervisor_assignment_protection_hours` (default 24h) short-circuits the occupancy check. Mirrors the escalator's protection clause.
11. **Per-(org, dispatch_zone) advisory lock** — `pg_advisory_xact_lock(hashtextextended('worktask_zone:'||org||':'||dispatch_zone, 0))`. Same hash recipe as `reassign_work_zone` (mig 256 §14) so all writers serialize through the same key.
12. **Active-then-reserved holder check** — pattern-aware via `work_zone_of()`. Active holders sort first so the error message reflects the most useful truth ("being counted by X" beats "reserved for X"). Distinct error codes / hints:
    - `ZONE_LOCKED: active` — SQLSTATE P0001, HINT `work_task_zone_lock`, DETAIL `state=active`.
    - `ZONE_LOCKED: reserved` — SQLSTATE P0001, HINT `work_task_zone_reserved`, DETAIL `state=reserved`.

### Bypass-list source

The plan said "read `work_zone_rules.bypass_priorities` and `bypass_subtypes`". The view passes through `cycle_count_zone_rules` columns verbatim, so the function reads `bypass_priorities` (text[]) and `bypass_count_types` (text[]). For work_tasks the `task_subtype` column is the moral equivalent of `count_type` — same array compared against `NEW.task_subtype`.

The alternative (read from `work_type_settings.bypass_subtypes`) is per-task-type and could be added in a follow-on; per the plan this trigger uses the legacy view so there's a single source of bypass truth across both engines.

### Soft-release semantics

The trigger ONLY enforces exclusivity. It never modifies `assigned_to` or `status`. The release path (claim → pending) lives in calling code (Rust `release_cycle_count`, OmniAgent triggers, etc.), and `trg_maintain_work_task_reservation` handles the `reservation_started_at` lifecycle.

## Related

- [[_Index/Patterns]]
- [[Patterns/Cycle-Count-Zone-Exclusivity]] (legacy `rr_cyclecount_data` version)
- [[Implement-Work-Engine-Foundation]]
- [[Sessions/2026-05-02]] (cutover-invariants addendum)
- [[Components/Work-Engine - Foundation]]
