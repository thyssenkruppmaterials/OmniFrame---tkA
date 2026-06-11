---
title: Cycle Count Zone Mutual Exclusion
date: 2026-04-21
tags: [cycle-count, zone-exclusivity, rr_cyclecount_data, trigger, enterprise, concurrency, rust-work-service]
status: shipped
---

# Cycle Count Zone Mutual Exclusion

## Problem

Multiple counters could be assigned and actively counting in the same zone (e.g. K1) at the same time, creating safety and accuracy problems (two counters pulling from adjacent locations, walking into each other, double-counting). The user wanted an enterprise-grade policy engine to prevent this — "users cannot be in the same zone, or set them to never be near each other."

## Design

### Zone derivation

A **zone** is the first dash-separated segment of `rr_cyclecount_data.location` (configurable via regex per org):

| Location       | Zone |
|----------------|------|
| `K1-08-02-2`   | `K1` |
| `SC-22-C-01`   | `SC` |
| `R0-19-C-03`   | `R0` |
| `<<empty>>`    | null (no lock) |

Helper: `public.cycle_count_zone_of(location, pattern)` — IMMUTABLE SQL function.

### Policy (per-org)

Table `cycle_count_zone_rules (organization_id PK, enabled, policy, zone_pattern, exclusion_pairs JSONB, notes, …)`.

Current policies:
- `off` — no enforcement
- `one_counter_per_zone` — only one user may hold active counts in a zone at a time (active = assigned_to NOT NULL AND status IN ('in_progress','recount'))

`exclusion_pairs` JSONB is reserved for future pairwise rules (e.g. treat K1 + K2 as a single zone).

### Enforcement

**Layer 1 — Hard block at the DB** (migrations 225 + 226):

BEFORE INSERT OR UPDATE OF (`assigned_to`, `status`) trigger `zzz_trigger_enforce_zone_exclusivity` calls `enforce_cycle_count_zone_exclusivity()`. It fires whenever:
- `assigned_to` changes to a new non-null user (dashboard assign, Rust claim, supervisor push), OR
- `status` transitions into `in_progress`/`recount` (self-claim, acknowledge push).

It reads the org rules, derives the zone, and rejects the write with:

```
ZONE_LOCKED: Zone "K1" is currently being counted by Nikki Mason. Only one counter may work a zone at a time.
```

(Error code `P0001`, HINT `cycle_count_zone_lock`, DETAIL `zone=K1;owner=<uuid>`.)

**Session bypass** (supervisor override): set `app.cycle_count_zone_lock_bypass = 'on'` inside the transaction to skip enforcement. Provided RPC `assign_cycle_count_to_user_force(count_id, user_id)` does exactly this and restricts callers to `superadmin`/`admin`/`manager`/`logistics_coordinator`.

**Layer 2 — Soft filter in Rust** (so operators don't get "zone locked" errors when pulling next):

`rust-work-service/src/db/queries.rs::claim_next_cycle_count` — Phase 2 candidate SELECT now includes a `NOT EXISTS` clause that excludes rows whose zone is held by another active user when the org's policy is `one_counter_per_zone`. Layer 2 is a pre-filter; Layer 1 is still authoritative.

### Client artifacts

- **Service** `src/lib/supabase/zone-rules.service.ts` — `getZoneRules` / `upsertZoneRules` / `listActiveZones` / `subscribeToActiveZones` / `forceAssignCountToUser` / `deriveZone` / `parseZoneLockError`.
- **Hook** `src/hooks/use-zone-rules.ts` — `useZoneRules()`, `useActiveZones()` (throttled realtime sub), `useZonesLockedByOthers(me)`.
- **Settings tab** `src/components/zone-rules-panel.tsx` — enable toggle, policy picker, zone-pattern editor with live preview on sample locations, live "Active Zones" panel. Wired into `count-settings.tsx` as the third section (Workflow Rules · Path Engine · Zone Rules).
- **Dashboard strip** — `manual-counts-search.tsx` header shows compact amber chips ("K1 Nikki", "R0 Erick") for every currently-held zone.
- **RF toast** — `use-unified-cycle-count.ts::handleError` now detects `ZONE_LOCKED` and shows a dedicated toast ("Zone K1 is busy — Nikki Mason is counting there. Try another zone — the queue will route you automatically.").

### View for dashboards

`v_cycle_count_active_zones` (security invoker) groups active rows by (org, zone, counter) with counter name/email, count of held rows, acquired_at, and the IDs of held counts.

### Seed

Migration 225 seeds a row for every organization with `enabled = false`. j.AI OneBox (the caller's org) is enabled by request to solve the K1 overlap incident. Other orgs are opt-in via the settings UI.

## Files changed

- **Migrations**: `225_cycle_count_zone_exclusivity.sql`, `226_zone_exclusivity_expand_trigger.sql`
- **Rust**: `rust-work-service/src/db/queries.rs` (Phase 2 candidate SELECT)
- **Service**: `src/lib/supabase/zone-rules.service.ts` (new)
- **Hook**: `src/hooks/use-zone-rules.ts` (new)
- **UI**: `src/components/zone-rules-panel.tsx` (new), `src/components/count-settings.tsx`, `src/components/manual-counts-search.tsx`
- **RF**: `src/hooks/use-unified-cycle-count.ts` (ZONE_LOCKED toast)
- **Tests**: `src/lib/supabase/__tests__/zone-rules.service.test.ts` (new, 8 tests)

## Live verification

- `DO $$ ... $$` smoke test on prod DB: regular assign into Nikki's K1 zone **rejected** with `ZONE_LOCKED: Zone "K1" is currently being counted by Nikki Mason`.
- Same test with `SET LOCAL app.cycle_count_zone_lock_bypass = 'on'` **succeeded** (rolled back via exception).
- `v_cycle_count_active_zones` returns two rows (K1 → Nikki, R0 → Erick) — matches the actual in-progress counts.
- `cycle_count_zone_of('K1-08-02-2')` → `K1`, `cycle_count_zone_of('<<empty>>')` → `null`.
- `npx tsc -b --noEmit` clean. ESLint clean on all touched files. 53/53 cycle-count + hook tests pass.

## Deployment notes

- **Migrations 225 + 226** are applied to Supabase (via MCP).
- **Rust work-service** must be rebuilt + redeployed for the Phase 2 soft filter to take effect — until then the trigger is the only layer (correct but operators may see occasional ZONE_LOCKED toasts on Pull Next in narrow race conditions). `cargo check` passes locally; push `rust-work-service` to Railway.
- **Frontend**: deploy normally. The Zone Rules tab appears automatically under Inventory Apps → Count Settings. The dashboard strip appears once there's at least one active zone.
- **Opt-in for other orgs**: Count Settings → Zone Rules → flip the enable switch.

## Future work

1. `pairwise_exclusion` policy that reads `exclusion_pairs` and treats the union as one zone (e.g. K1 + K2 are a single zone for locking). Schema already accepts JSON; just needs trigger + UI.
2. `proximity_buffer` policy (require N zones distance between counters). Needs zone-ordering model.
3. Force-assign confirmation UI on the manual counts dashboard that calls `assign_cycle_count_to_user_force` (RPC exists; just needs a dialog).
4. Push-with-override in Rust (mirror `release_cycle_count.allow_override`).
