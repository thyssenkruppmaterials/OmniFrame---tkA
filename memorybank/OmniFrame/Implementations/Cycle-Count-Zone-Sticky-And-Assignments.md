---
title: Cycle Count Sticky Zone + Zone Assignments
date: 2026-04-21
tags: [cycle-count, zone-exclusivity, sticky-zone, zone-assignments, rust-work-service, enterprise]
status: shipped
---

# Sticky Zone + Zone Assignments

Extends the 225/226 zone-exclusivity foundation with two features the customer asked for:

1. **Sticky zone** — an optional toggle that makes Rust's pull-next route an operator back to zones they already hold, so they finish one zone before being sent to a new one.
2. **Zone Assignments** — admins can dedicate specific zones to specific counters ("K1 is Nikki's zone"). When an assignment exists, only that user can claim / be assigned / start counts in that zone.

## DB (migration 227)

- `cycle_count_zone_rules.sticky_zone` boolean, default `false`.
- `cycle_count_zone_assignments (organization_id, zone) PK, user_id, notes, …` with RLS (admins/managers/logistics_coordinator write; all org members read). CHECK that `zone = upper(zone) AND zone <> ''`.
- Indices on `user_id` and `organization_id` for fast lookups.
- `v_cycle_count_zone_assignments` view joins `user_profiles` for display.
- `enforce_cycle_count_zone_exclusivity` trigger rewritten to run the assignment check FIRST (raises `ZONE_ASSIGNED` with DETAIL `zone=X;assigned_to=<uuid>`), then the original active-lock check (`ZONE_LOCKED`). Session bypass GUC `app.cycle_count_zone_lock_bypass` still works for supervisor overrides on either path.

## Rust (`claim_next_cycle_count` Phase 2 SELECT)

- Added `NOT EXISTS` filter that excludes rows whose zone is assigned to a different user when the org has zone rules enabled.
- Added two new `ORDER BY` terms that run BEFORE priority:
  - **Sticky zone**: when `sticky_zone = true`, rows in zones the current operator already holds come first.
  - **Dedicated zones**: rows in zones explicitly assigned to the current operator come next (routes their "territory" to them even when they're idle and the zone is quiet).
- `cargo check` clean. Needs redeploy for the new ORDER BY + NOT EXISTS to take effect in the queue ranker (DB trigger already enforces correctness regardless).

## Service / hook

- `zone-rules.service.ts`: added `listZoneAssignments`, `upsertZoneAssignment`, `deleteZoneAssignment`, `listOrgUsersForZoneAssignment`, `ZoneAssignment` type. `ZoneRules.sticky_zone` + `ZoneRulesUpdate.sticky_zone`. Rewrote `parseZoneLockError` → returns `{ isZoneBlocked, kind: 'locked'|'assigned', zone, ownerName, ownerId }` so the UI can render the right message.
- `use-zone-rules.ts`: added `useZoneAssignments()` + `useOrgUsersForZoneAssignment()` hooks. Zone-rules save still invalidates active-zones view.

## UI

- **Zone Rules panel** (`zone-rules-panel.tsx`):
  - New "Sticky zone assignment" toggle inside the main card, disabled when enforcement is off.
  - New **Zone Assignments** card on the right column with a list, per-row Edit/Remove buttons, and an Add dialog (zone input + operator picker pulled from the org).
- **RF interface** (`use-unified-cycle-count.ts`): `handleError` now detects both `ZONE_LOCKED` and `ZONE_ASSIGNED` and shows tailored toasts:
  - `ZONE_ASSIGNED`: *"Zone K1 is assigned. This zone is dedicated to Nikki Mason. Try a different zone — the queue will route you to your available work."*
  - `ZONE_LOCKED`: *"Zone K1 is busy. Nikki Mason is counting there. Try another zone — the queue will route you automatically."*

## Tests

- `zone-rules.service.test.ts` extended with a new case covering `ZONE_ASSIGNED` parsing. All 9 tests pass.
- Typecheck + ESLint clean across all touched files.
- Live-DB verification: creating an assignment K2 → Erick and trying to assign Nikki to a K2 row returns:
  ```
  ERROR:  P0001: ZONE_ASSIGNED: Zone "K2" is assigned to Erick Robinson.
          Only that counter may work this zone.
  DETAIL:  zone=K2;assigned_to=c049b42a-…
  HINT:    cycle_count_zone_assigned
  ```

## Deployment

- **Supabase migration 227** applied via MCP.
- **Rust** must be rebuilt + redeployed for sticky-zone ranking and the soft assignment filter in pull-next to take effect (trigger already enforces hard correctness).
- **Frontend** deploy: the sticky toggle and Zone Assignments card appear in Count Settings → Zone Rules.
- Works immediately on j.AI OneBox without new seeding; other orgs pick it up via the existing Zone Rules UI.

## Example operator flow

1. Admin opens Count Settings → Zone Rules.
2. Flips on "Sticky zone assignment" (optional — global behavior change).
3. Clicks "Add" under Zone Assignments, types `K1`, picks **Nikki**, saves.
4. Any operator who taps Pull Next in the RF app will never be routed to a K1 count — unless they're Nikki.
5. Nikki's Pull Next prefers K1 counts (sticky), plus her assigned K1 queue, before moving her elsewhere.
6. If Nikki goes off-shift and an urgent K1 count needs attention, an admin hits the Zone Assignments Edit (or Remove) button; or uses the existing supervisor override (`assign_cycle_count_to_user_force`, or transaction-scoped `app.cycle_count_zone_lock_bypass = on`).

## Future work hooks

- Multi-user zones (many user rows per zone) — schema doesn't support it today; would require PK change to `(org, zone, user_id)` and trigger check that ANY assignee matches.
- Shift-aware assignments (start/end time windows).
- Auto-rotation of dedicated zones across shifts.
- Bulk assignment UI (assign all RL/RM/RN to Erick in one click).
