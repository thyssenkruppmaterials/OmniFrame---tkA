---
tags: [type/implementation, status/active, domain/backend, domain/database, domain/frontend, domain/infra]
created: 2026-05-18
---

# Implement — Work-distribution NOW bundle (2026-05-18)

## Purpose / Context

Ships the **NOW horizon** from
[[ADR-Work-Distribution-Pipeline-Architecture-Review-2026-05-18]] — eight
discrete changes selected by the user (with the user-confirmed C banner
placement and T-7 release-CTA shape from Open Questions #3 + #4).
Closes the immediate cycle-count cascade class documented in
[[Fix-RF-Cycle-Count-Zone-Soft-Reservation-Cascade-2026-05-18]] and the
five-incident pattern documented in
[[ADR-Cycle-Count-Soft-Reservation-Cascade-Mitigation]].

**Constraint binding the work.** The user's prior architecture-review
request explicitly forbade code edits while the analysis was in flight.
Once the analysis confirmed the path forward the user lifted that
constraint and asked for the NOW bundle to be implemented to **sustain
the pipeline long-term**. The bundle is intentionally tactical — it
closes the bleeding without taking the MEDIUM-horizon bets (M-1/M-2/M-3
reason-coded outcomes + explicit reservations table + leases) which
require their own ADR rounds.

## Scope shipped (NOW bundle, eight items)

| ID | Change | Files touched |
|---|---|---|
| **T-1 (B2)** | Migration 311: `escalate_stale_zone_reservations` idle-aware heartbeat guard + optional org filter | `supabase/migrations/311_cycle_count_reapers_idle_aware_per_org.sql` |
| **T-2 (B3)** | Scheduler wires per-org `reservation_escalation_minutes` from `work_type_settings` (default 60) instead of hardcoded `bind(60_i32)` | `rust-work-service/src/scheduler/mod.rs` |
| **T-4** | `phase0_already_assigned_generic` adds defense-in-depth zone-collision filter — won't resume into a `dispatch_zone` actively claimed by another operator | `rust-work-service/src/db/queries.rs` |
| **T-5** | Scheduler also wires per-org `abandonment_minutes` (default 30) + `heartbeat_release_minutes` (default 10); migration 311 added the org filter to `release_stale_heartbeat_assignments` to enable this | `rust-work-service/src/scheduler/mod.rs` + migration 311 |
| **T-3 (C, Rust)** | New `WsEvent::ClaimBlockedByZone` variant; emitted from `routes::work::claim_next` when claim returns None AND `unassigned_pending > 0` for the org's cycle_count surface; helper `db::count_unassigned_and_stuck_pending` added | `rust-work-service/src/websocket/mod.rs` + `observability/metrics.rs` + `db/queries.rs` + `api/routes/work.rs` |
| **T-3 (FE, ribbon)** | FE `WsEventType` mirror updated; new `<ClaimBlockedRibbon>` component renders a persistent amber ribbon at the top of `AuthenticatedLayout`, gated by `inventory_apps:view` CanAccess wrapper. Auto-dismisses on `TaskAssigned` or 5-minute TTL or manual X | `src/lib/work-service/types.ts` + `src/components/work-distribution/claim-blocked-ribbon.tsx` (new) + `src/components/layout/authenticated-layout.tsx` |
| **T-7 (operator CTA)** | Promote existing Confirm-step header **Release** chip (variant=ghost → outline + visible border); add **Pull-Next landing** affordance that pre-fetches the operator's held row via supabase REST and surfaces Resume/Release buttons | `src/components/ui/rf-cycle-count-unified.tsx` |
| **M-9 (smoke claim)** | `scripts/post-deploy-smoke-claim.mjs` polls deployed `/health` + `/health/detailed` until version matches `rust-work-service/Cargo.toml`; companion `.github/workflows/post-deploy-smoke.yml` for `workflow_dispatch` | `scripts/post-deploy-smoke-claim.mjs` + `.github/workflows/post-deploy-smoke.yml` |
| **O-1 (runbook)** | Updated `docs/runbooks/work-engine/stuck-zone.md` — documents migration 311, the new ribbon, the operator CTAs, and the smoke script | `docs/runbooks/work-engine/stuck-zone.md` |

(Eight items; the user's "NOW bundle" choice covers all eight including
T-7 which is technically SOON in the ADR — the user opted into it
explicitly because it closes the David/James/Marvin self-recovery gap.)

## Details

### Migration 311 — what changed in SQL

Two functions reshaped (DROP + CREATE OR REPLACE):

1. **`escalate_stale_zone_reservations(int, uuid DEFAULT NULL)`** — the
   primary B2 fix. Two changes:
   - The LATERAL on `worker_heartbeats` now reads `status` alongside
     `last_heartbeat`. The reaper predicate adds
     `OR hb.hb_status IS NULL OR hb.hb_status NOT IN ('online','busy')`
     so any status outside the actively-working set — idle, break,
     offline, NULL — counts as inactive even when the heartbeat is
     fresh. This is the exact symmetry break that produced the
     2026-05-18 cascade (James was heartbeating idle).
   - Optional `p_organization_id uuid DEFAULT NULL` parameter. NULL
     keeps the legacy whole-org behavior; non-NULL scopes the run.
     Enables the Rust scheduler's new per-org loop.

2. **`release_stale_heartbeat_assignments(int, uuid DEFAULT NULL)`** —
   adds the same optional org filter (no other change). Heartbeat-
   stale semantics are unchanged because this function fires on
   heartbeat absence, where status-discrimination would not help.

Both functions remain `SECURITY DEFINER`, granted to `service_role`
only. Backward-compat: the new args default to NULL so the rust-work-
service binary can be deployed before or after this migration without
breakage.

### Scheduler refactor (T-2 + T-5)

`scheduler/mod.rs` gained one helper and two function-body rewrites:

- **`fetch_org_reaper_settings`** (new helper) — single round-trip:
  ```
  SELECT DISTINCT
    rcc.organization_id                              AS org_id,
    COALESCE(wts.reservation_escalation_minutes, 60) AS esc_min,
    COALESCE(wts.abandonment_minutes, 30)            AS abandon_min,
    COALESCE(wts.heartbeat_release_minutes, 10)      AS hb_min
  FROM rr_cyclecount_data rcc
  LEFT JOIN work_type_settings wts
    ON wts.organization_id = rcc.organization_id
   AND wts.task_type = 'cycle_count'
  WHERE rcc.organization_id IS NOT NULL
  ```
  Returns one row per org with cycle-count data plus its tunables
  (or defaults if no `work_type_settings` row exists).

- **`escalate_stale_reservations`** — now calls the new helper, loops
  per-org, and invokes the migration-311 function with `(threshold,
  Some(org_id))` per row. Legacy fallback (no orgs have CC data) calls
  once with `(60, None)`.

- **`detect_and_release_abandoned`** — same shape; per-org loop wraps
  both the inline UPDATE (Path 1, stale `assigned_at`) and the call to
  `release_stale_heartbeat_assignments` (Path 2). The inline UPDATE
  now uses `make_interval(mins => $1)` with the per-org
  `abandonment_minutes` and an `OR organization_id = $2::uuid` filter.

The log lines were extended to include `org=...` and the threshold
values so the existing Railway log analysis still works (see
[[ADR-Work-Distribution-Pipeline-Architecture-Review-2026-05-18]] §4
for the established log signatures).

### Phase 0 generic zone filter (T-4)

`db/queries.rs::phase0_already_assigned_generic` gains a single
`NOT EXISTS` clause at READ time:

```sql
AND (
  wt.dispatch_zone IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM public.work_tasks held
    WHERE held.organization_id = wt.organization_id
      AND held.task_type       = wt.task_type
      AND held.dispatch_zone   = wt.dispatch_zone
      AND held.assigned_to IS NOT NULL
      AND held.assigned_to    <> $2
      AND held.status IN ('claimed', 'in_progress')
      AND held.deleted_at IS NULL
  )
)
```

Status set is intentionally narrower than the cycle_count Phase 2
filter (no `'pending'` soft-reservations) — the cycle_count Phase 2
soft-reservation semantics are deliberately scoped to cycle_count's
race-protection invariant; generic types don't need that for resume.

This closes the latent F3 (reframed) latent risk. The mig-266 trigger
remains the primary write-time guard; T-4 is defense-in-depth for the
case where `dispatch_zone` is administratively reassigned post-claim
via the `cycle_count_zone_lock_bypass` GUC.

### ClaimBlockedByZone (T-3)

New `WsEvent` variant carries `(organization_id, user_id, task_type,
unassigned_pending, stuck_pending_assigned)`. Emitted only when:

1. `claim_next_task` returned None, AND
2. `task_type == "cycle_count"` (other types don't share the soft-
   reservation cascade shape — see ADR F5 reframed), AND
3. `count(*) WHERE status='pending' AND assigned_to IS NULL > 0` for
   the org (i.e. real work exists; an empty queue does NOT emit).

The helper `db::count_unassigned_and_stuck_pending` runs a single
two-subquery read keyed by `organization_id` (LIMIT-able by Postgres
index on `(organization_id, status)`).

The route emit is best-effort: any error from the count helper or
broadcast is swallowed so the canary never blocks the empty-claim
response.

FE `WsEventType` and `WsEvent` interface in
`src/lib/work-service/types.ts` extended to mirror the new variant.

### Admin ribbon (T-3 FE)

`ClaimBlockedRibbon` is a new component at
`src/components/work-distribution/claim-blocked-ribbon.tsx`. Mounted in
`AuthenticatedLayout` between the NotificationsPanel row and
AppBreadcrumbs. Subscribes to `workServiceWs` for the new variant,
auto-dismisses on a subsequent `TaskAssigned` (cascade unblocked) or
after a 5-minute TTL.

Permission gate: `<CanAccess action='view' resource='inventory_apps'>`
mirrors the route guard on `/apps/inventory` so the audience is exactly
"people who can act on Stuck Assignments". Non-admins render nothing.

### Operator Release affordance (T-7)

Two pieces inside `rf-cycle-count-unified.tsx`:

1. **Confirm-step chip promotion** — the existing header `Release`
   button changed from `variant='ghost'` with a subtle orange text
   color to `variant='outline'` with a border, background hover, and
   dark-mode aware colors. Same `handleReleaseTask` handler; just
   visually elevated. Renders on every workflow step (existing
   behavior); discoverability improved on the Confirm step
   specifically because that's where operators most likely need it.

2. **Pull-Next landing affordance** — a new TanStack `useQuery`
   (`['rf-cycle-count', 'held-row', userId]`) fetches the operator's
   first held row from `rr_cyclecount_data` via the Supabase client
   (RLS scopes to org). Enabled only when `mode === 'pull'` and
   `currentTask` is null (i.e. operator landed on Pull-Next). If a
   held row exists, an amber Alert renders above the standard Pull
   Next button with the row's `count_number`, `location`, and two
   buttons: **Resume** (calls `claimNext()` → Phase 0 routes them
   back) and **Release** (calls `workServiceClient.releaseTask(id)`
   directly and invalidates the query). 10s staleTime keeps the
   pre-fetch cheap.

### Post-deploy smoke (M-9)

`scripts/post-deploy-smoke-claim.mjs` polls `${url}/health` until the
reported `version` matches `rust-work-service/Cargo.toml` (or
`--expected-version`) AND `status: "healthy"`. Then probes
`${url}/health/detailed` and asserts `dependencies.database.status` +
`dependencies.redis.status` are both `"healthy"`. Bounded retry: up to
12 attempts × 5s = 60s window. Exits 0 on success, 1 on failure with
a GitHub-Actions-format `::error::` annotation.

Companion `.github/workflows/post-deploy-smoke.yml` exposes a
`workflow_dispatch` entry with `url` and optional `expected_version`
inputs. Not wired into the deploy pipeline yet — that's a follow-up
once we settle on the Railway webhook shape (out of scope for the NOW
bundle).

### Runbook (O-1)

`docs/runbooks/work-engine/stuck-zone.md` rewritten:

- New "What changed in migration 311" subsection.
- Triage section adds "Check the admin ribbon" as step 1.
- Recovery section lifts the Stuck Assignments UI procedure to the
  preferred recovery path (no SQL).
- Adds the smoke-claim script reference under a new
  "Verify the deploy actually took effect (M-9)" section.
- Corrected SQL example (the previous one had an invalid 1-arg
  call to `escalate_stale_zone_reservations`).
- Wikilink to the cascade ADR + work-distribution architecture ADR.

## Validation

```
$ cd rust-work-service && cargo check       # ✅ clean (pre-existing warnings in observability/middleware.rs not mine)
$ cd rust-work-service && cargo test --lib  # ✅ 166/166 pass; new ClaimBlockedByZone variant covered by `ws_event_variant_names_match_known_set`
$ pnpm exec tsc -b --noEmit                 # ✅ clean
$ pnpm exec eslint src/components/work-distribution/claim-blocked-ribbon.tsx src/components/layout/authenticated-layout.tsx src/lib/work-service/types.ts  # ✅ clean
$ pnpm vitest run src/lib/work-service/ src/hooks/  # ✅ 56/56 pass
$ pnpm build                                # ✅ build succeeds
$ node scripts/check-bundle-budget.mjs      # 🟡 pre-existing fail: warehouse-location-map / feature-admin / feature-rf-interface chunks already exceed 500 KB and total exceeds 7500 KB BEFORE my changes. Stash-rebuild-compare shows my changes add ~3.8 KB to the total, all on feature-rf-interface (held-row query + Alert UI). Not a NEW regression; surfaces an existing CI gate that's red on main.
```

`rf-cycle-count-unified.tsx` lives under `src/components/ui/` which is
in the project's ESLint ignore list (a pre-existing repo convention).
Forced lint with `--no-warn-ignored` returned no errors, but the
unignored CI path doesn't lint it. Worth a follow-up to lift this file
out of the ignore list — but that's a separate cleanup, out of scope.

## Test plan (manual, post-deploy)

1. **B2 idle-aware escalator.** Seed a `pending+assigned` row where
   the assignee has `last_heartbeat = NOW() - 1 min`, `status = 'idle'`,
   `reservation_started_at = NOW() - 90 min`. Expected: the next
   scheduler tick (≤5 min) escalates the row. Pre-311: would have
   skipped indefinitely.

2. **B3 per-org threshold.** Set `work_type_settings.reservation_
   escalation_minutes = 15` for a test org. Seed a stuck row with
   `reservation_started_at = NOW() - 20 min`. Expected: escalator
   reaps within ≤5 min (vs. having to wait for global 60). Logged
   line includes `threshold=15m`.

3. **T-4 Phase 0 generic.** Create a `work_tasks` row of `task_type
   = 'pick'` assigned to user A in dispatch_zone Z. Create another
   `work_tasks` row of `task_type = 'pick'` claimed by user B in same
   zone Z. Call `claim_next_task` for user A. Expected: returns None
   (Phase 0 generic skips A's row because B's active claim contests
   the zone); the regular claim path then routes A to a fresh row.

4. **T-3 ClaimBlockedByZone canary.** Seed unassigned-pending cycle
   counts in zone X but also a single stuck `pending+assigned` row
   in the same zone. Have an operator tap Pull Next. Expected:
   - Operator sees empty response (existing behavior).
   - Admin shell renders the amber ribbon within ~1 s.
   - Ribbon shows accurate counts.
   - Admin clicks "View Stuck Assignments" → `/apps/inventory`.
   - Admin clicks Unassign → next operator's Pull Next succeeds AND
     the next `TaskAssigned` event clears the ribbon for all admins.

5. **T-7 operator Release on Pull-Next landing.** Have operator hold
   a row, sign out, sign back in, navigate to RF Cycle Count.
   Expected: Pull-Next landing renders + the amber alert shows held
   row's count_number + location. Operator clicks Release.
   Expected: Toast "Released CC-XXXX"; the alert disappears; tapping
   Pull Next now returns a fresh row (not the released one).

6. **T-7 Confirm-step chip.** Open any cycle count, advance to the
   Confirm step. Expected: Release button is clearly outlined and
   visually distinct in the header (no longer a subtle text link).

7. **M-9 smoke after deploy.** Run `scripts/post-deploy-smoke-claim.mjs`
   against the deployed URL with the expected version. Within 60 s
   it should exit 0 with version verified + db/redis green.

## Rollback strategy

Each piece is independently revertable:

- **Migration 311**: re-apply migration 233 + 252 versions of the
  functions (`DROP FUNCTION ... ; CREATE OR REPLACE FUNCTION ...`)
  to restore the single-arg legacy shape. The Rust scheduler's
  per-org loop falls back to `None` org_id ⇒ legacy whole-org
  behavior, so reverting the function works even with the new
  scheduler still deployed.
- **Scheduler refactor**: revert `scheduler/mod.rs` to the previous
  HEAD; the migration is forward-compat.
- **Phase 0 generic filter**: remove the `NOT EXISTS` clause from
  `phase0_already_assigned_generic` — only that one helper changes.
- **ClaimBlockedByZone**: remove the variant from `websocket/mod.rs`,
  `KNOWN_WS_EVENT_VARIANTS`, `sample_events`, FE `types.ts`, and
  delete the FE ribbon component + the `<ClaimBlockedRibbon />`
  import in `authenticated-layout.tsx`. The emit point in
  `routes/work.rs` falls through automatically because the variant
  no longer exists; the route still returns None as today.
- **Operator Release CTA**: revert the two diffs in
  `rf-cycle-count-unified.tsx`. The hook-side `releaseTask` /
  `claimNext` are unchanged.
- **M-9**: delete `scripts/post-deploy-smoke-claim.mjs` and
  `.github/workflows/post-deploy-smoke.yml`. No callers.
- **O-1**: revert `docs/runbooks/work-engine/stuck-zone.md`.

## What this bundle deliberately does NOT do

- **No Option A from cascade ADR** (drop `'pending'` from Phase 2
  zone filter entirely). Defer until C-telemetry quantifies how often
  the soft-reservation race-protection actually matters.
- **No reservations-table / lease semantics (M-2, M-3)**. These are
  MEDIUM-horizon investments that need their own ADR + design
  rounds — the NOW bundle just closes today's cascade class without
  pre-committing to a particular reservation contract.
- **No reason-coded ClaimOutcome enum (M-1)**. The single new event
  variant (`ClaimBlockedByZone`) is the operationally-useful subset
  of M-1 for the cascade class only. The broader enum lands in
  MEDIUM.
- **No append-only work_dispatch_events table (T-9)**. SOON horizon;
  the cascade ribbon provides real-time visibility without the
  historical query. Adding a dispatch-events table is its own
  ADR-level decision (data retention, RLS, schema).
- **No Phase 0 zone filter for `cycle_count`** beyond what's already
  there. Phase 0 cycle_count already has the right filter; the bug
  was in Phase 0 GENERIC, which T-4 closes.

## Related

- [[ADR-Work-Distribution-Pipeline-Architecture-Review-2026-05-18]] —
  the umbrella ADR this implements the NOW horizon of.
- [[ADR-Cycle-Count-Soft-Reservation-Cascade-Mitigation]] — the
  short-term ADR proposing B (B2+B3) + C; B and C ship here.
- [[Fix-RF-Cycle-Count-Zone-Soft-Reservation-Cascade-2026-05-18]] —
  the 2026-05-18 incident that drove the bundle.
- [[Fix-RF-Cycle-Count-Stuck-Waiting]] — the 2026-05-14 Phase 0
  precedent (cycle_count version); informs T-4's generic equivalent.
- [[Fix-Trigger-Evaluator-Empty-After-v041-Restart]] — the
  silent-default failure shape inspires the
  `SettingsCache::resolved` follow-up noted in the ADR §13.
- [[Implement-Resilient-PgListener]] — pattern that the scheduler's
  per-org loop borrows from for graceful per-org failure isolation.
- `supabase/migrations/311_cycle_count_reapers_idle_aware_per_org.sql`
- `rust-work-service/src/scheduler/mod.rs`
- `rust-work-service/src/db/queries.rs`
- `rust-work-service/src/api/routes/work.rs`
- `rust-work-service/src/websocket/mod.rs`
- `rust-work-service/src/observability/metrics.rs`
- `src/lib/work-service/types.ts`
- `src/components/work-distribution/claim-blocked-ribbon.tsx`
- `src/components/layout/authenticated-layout.tsx`
- `src/components/ui/rf-cycle-count-unified.tsx`
- `scripts/post-deploy-smoke-claim.mjs`
- `.github/workflows/post-deploy-smoke.yml`
- `docs/runbooks/work-engine/stuck-zone.md`
