---
tags: [type/decision, status/proposed, domain/backend, domain/database, domain/frontend]
created: 2026-05-18
---

# ADR — Mitigating cycle-count zone soft-reservation cascade

## Status / Date / Owner

- **Status: Proposed (drafted 2026-05-18).** Documentation-only deliverable; no code / DB / env / deploy changes.
- **Owner:** unassigned (proposed).
- **Triggered by:** the 2026-05-18 incident in
  [[Fix-RF-Cycle-Count-Zone-Soft-Reservation-Cascade-2026-05-18]] —
  9 idle operators (Marvin Berry + Devon Melsheimer + Jai Singh + 6
  others) blocked from claiming any of **383 unassigned pending
  counts** because **James Dearman's** single stale `pending+assigned`
  row `CC-20260424-1312` at `RP-47-B-01` was treated as a soft
  reservation occupying zone `RP`. User unblocked operationally via
  the admin Stuck Assignments UI; this ADR captures the longer-lived
  decision space.

## Note-worthy finding (read this BEFORE the rest)

The user's framing for **Option B** was "extend the 60-min escalator
to also reap `pending+assigned`". After auditing the code, the
escalator **already does this** — and SHOULD have reaped James's
row 30+ min before the user noticed:

- `rust-work-service/src/scheduler/mod.rs::escalate_stale_reservations`
  (lines 92-151) runs on `tokio_cron_scheduler` `30 */5 * * * *` (every
  5 min, offset 30s past the minute) and calls
  `public.escalate_stale_zone_reservations(60)` with a hardcoded
  60-min threshold.
- The SQL function (live `pg_get_functiondef` dump) hard-unassigns
  `rcc.status = 'pending' AND rcc.assigned_to IS NOT NULL` rows where
  `COALESCE(reservation_started_at, updated_at) < NOW() - 60 min`.

The escalator's predicate has a **second guard** that the Phase 2
candidate-scan filter does NOT share:

```sql
AND (
  hb.last_hb IS NULL
  OR hb.last_hb < NOW() - make_interval(mins => p_threshold_minutes)
)
```

Where `hb.last_hb = max(worker_heartbeats.last_heartbeat)` for the
assignee. **James's heartbeat was current the entire incident** —
`worker_heartbeats.status='idle', current_task_type='cycle_count',
current_location=NULL, last_heartbeat ≈ NOW()` — because he was
signed in to the RF but not actively counting. The heartbeat guard
flipped the escalator predicate to `false`, the function skipped his
row indefinitely, and the row was left occupying zone `RP` for the
whole team for **2h14m and counting** until the admin manually
Unassigned it.

So the asymmetry that produced this incident is:

| Predicate | `occupied.status IN ('pending','in_progress','recount')` | requires stale heartbeat? |
|---|---|---|
| Phase 2 zone-mutual-exclusion (`queries.rs:443-462`) | yes (treats `pending+assigned` as occupying) | **NO** |
| Phase 0 helper (`queries.rs:1792-1808`) | yes | NO |
| Escalator (`escalate_stale_zone_reservations`) | yes | **YES** |

The Phase 2 filter says "your row blocks the zone the moment you're
assigned"; the escalator says "we'll only free your block if you've
also been quiet on the heartbeat for 60 min". An idle-but-online
operator's stale claim cascades **forever** in steady state.

That asymmetry — not a missing escalator — is what
Option B needs to address. Sections below treat **Option B as
"realign the escalator's heartbeat guard with the Phase 2 filter's
semantics"** rather than the original "build a new reaper".

Secondary finding (worth flagging but unrelated to today's incident):
the scheduler hardcodes `bind(60_i32)` and ignores the per-org
`reservation_escalation_minutes` setting that
`SettingsCache::resolved` already reads from `work_type_settings`
(`scheduler/mod.rs:107` vs. `settings/cache.rs:88` /
`strategies/mod.rs:28`). Filed as Forces #8 / Open Question #4.

## Context

- **Predicate that creates the cascade** —
  `rust-work-service/src/db/queries.rs:443-462` (Phase 2 candidate
  scan, used by `claim_next_cycle_count`) and the matching
  `queries.rs:1792-1808` (Phase 0 helper). Both filter:

  ```sql
  AND occupied.assigned_to IS NOT NULL
  AND occupied.assigned_to <> $2
  AND occupied.status IN ('pending','in_progress','recount')
  ```

  Inline comment says the `pending` branch is intentional —
  "soft-released reservation (pending + assigned_to set)" — and gives
  the operator a few seconds of priority on their own row before
  someone else can claim it.

- **Zone rule on the affected org** —
  `cycle_count_zone_rules`: `enabled=true, policy='one_counter_per_zone',
  zone_pattern=NULL`. With `zone_pattern=NULL`, the
  `COALESCE(cycle_count_zone_of(loc, NULL), rcc.zone)` fall-through
  uses the raw `rcc.zone` column. Every one of the 383 unassigned
  pending counts has `zone='RP'`, so a single occupier in zone RP
  cascades to the entire pool.

- **The 60-min escalator that should have helped** —
  `scheduler/mod.rs::escalate_stale_reservations` →
  `public.escalate_stale_zone_reservations(60)`. Heartbeat guard
  prevented it from firing for James. See Note-Worthy Finding above.

- **NOT the 2026-05-14 class** —
  [[Fix-RF-Cycle-Count-Stuck-Waiting]] / Phase 0 / v0.1.42 is healthy
  in production (`/health → 0.1.42`). Today's class lives in the
  Phase 2 candidate scan, not the Phase 0 capacity-gate ordering.

- **Reference debug note** —
  [[Fix-RF-Cycle-Count-Zone-Soft-Reservation-Cascade-2026-05-18]] —
  full RCA, reproduction SQL, log evidence, scope.

## Forces

1. **Zone mutual-exclusion is a real product invariant.** Two
   operators in the same zone is documented in
   [[Cycle-Count-Zone-Exclusivity]] as bad UX + safety risk. Any
   mitigation has to preserve "no two operators in the same zone at
   the same time when actively counting."
2. **Soft-released reservations are intentional.** Without the
   `pending+assigned` branch, two operators who tap Pull Next within
   seconds of each other could both end up landing on the same row
   and racing through Confirm. The branch gives the first claimant a
   protected window.
3. **`pending+assigned` is unbounded today.** Once a row gets stuck
   in that state AND its owner keeps heartbeating (RF tab open, not
   actively counting), no automatic recovery exists — the escalator's
   heartbeat guard skips it.
4. **Blast radius scales with `zone_pattern` granularity.** This
   org's `NULL` pattern means ONE zone = ALL counts on a warehouse
   row. Orgs with `zone_pattern='aisle'` or similar would see
   proportionally narrower cascades. Today's org is the worst case.
5. **9 idle operators × hourly labor cost.** Real money lost per
   incident. The user already absorbed at least 2 hours of floor
   downtime before the admin noticed and ran Unassign.
6. **Admin can see/clear the row today** via the existing Stuck
   Assignments card, **but only if they navigate there**. Floor
   operators get the silent `task: null` from `/work/claim` and have
   no signal that "you'd have work except one row is blocking the
   zone" — the 2026-05-07 noise-quieting fix
   ([[Fix-RF-CycleCount-Empty-Queue-Noise]]) intentionally hid the
   per-claim toast, which has the side effect of hiding this class
   too.
7. **FE auto-release on `beforeunload` is best-effort.** Mobile
   backgrounding, Citrix kiosk shutdown, dead Wi-Fi, browser crash
   all skip the unload handler. It's a defence layer, not a primary
   fix.
8. **Server-side reaping is the durable solution** — and most of
   the server-side mechanism already exists. The scheduler runs
   every 5 min; the SQL function exists; the WS broadcast event
   `WsEvent::ReservationEscalated` exists. The gap is the heartbeat
   guard semantics + the hardcoded 60-min threshold (ignoring
   `reservation_escalation_minutes`).

## Options Considered

### Option A — Tighten the Phase 2 candidate-scan filter

Drop `'pending'` from `occupied.status IN (...)` in both
`queries.rs:443-462` (Phase 2 candidate scan) AND `queries.rs:1792-1808`
(Phase 0 helper). Soft-reservation semantics disappear — only
`in_progress` and `recount` rows count as occupying the zone.

- **Pros**
  - Deterministic — no escalator wait, no heartbeat dependency.
  - Smallest predicate change (drop one literal from each of two
    SELECTs).
  - Removes the whole class of stuck-pending-cascade regardless of
    heartbeat behaviour.
  - The DB-level zone-exclusivity trigger from migration 266 is the
    authoritative guard at write time — relaxing the read filter
    cannot allow two operators in the same zone, only invite a
    racey claim that the trigger then rejects.
- **Cons**
  - **Breaks the soft-reservation UX intent.** Two operators tapping
    Pull Next within ~1 s of each other could both land on the same
    row; the loser sees an error from the write-time trigger. Today
    the second tapper gets routed to a different row in a different
    zone.
  - The Phase 0 helper change also needed to keep parity (its same
    filter exists for the resume path; out-of-sync = different
    behaviour for resume vs new-claim).
  - Behavioural regression risk on contention-heavy floors during
    shift-change rushes when many operators tap Pull Next
    simultaneously.
- **Effort:** small. Two `('pending','in_progress','recount')` →
  `('in_progress','recount')` substitutions + a new dispatcher
  integration test seeding the soft-reservation-race scenario.
  ~30-50 LOC including the test.
- **Risk:** medium. The intentionality of the `pending` branch
  is documented in-tree but never quantified — we have no telemetry
  on how often soft-reservation actually prevented a real race.

### Option B — Align the escalator with the Phase 2 filter

Per the Note-Worthy Finding above, the escalator's heartbeat guard
(`hb.last_hb IS NULL OR hb.last_hb < NOW() - threshold`) is the gap.
Three sub-flavours, pick one:

- **B1.** Drop the heartbeat guard entirely from
  `public.escalate_stale_zone_reservations`. Any
  `pending+assigned` row older than the threshold is reaped, online
  or not. Most aggressive — closes the cascade hard at the
  60-min boundary regardless of operator state.
- **B2.** Tighten the heartbeat guard to require the operator be
  `worker_heartbeats.status='idle'` (or `status != 'busy'`) for the
  threshold window, rather than the current "heartbeat missing
  entirely for threshold". An online-but-idle operator like James
  today (`status='idle', current_location=NULL`) becomes reapable;
  an actively-counting operator (`status='busy'`,
  `current_location` set) stays protected.
- **B3.** Wire the hardcoded `bind(60_i32)` in
  `scheduler/mod.rs:107` to the per-org
  `reservation_escalation_minutes` setting that
  `SettingsCache::resolved` already loads (`settings/cache.rs:88`).
  Stand-alone improvement; combines well with B1 or B2.

- **Pros**
  - Preserves the soft-reservation semantics inside the threshold
    window (the original product invariant).
  - Bounds the cascade blast radius to the threshold instead of
    "until admin notices."
  - Reuses existing infra: scheduler job, SQL function, WS event,
    cache.
  - B3 is independently useful — closes a configuration drift bug
    surfaced by the audit.
- **Cons**
  - Worst-case wait for an operator caught behind a stuck row is the
    threshold (60 min default today). Acceptable if rare; painful if
    common.
  - B1 removes the "operator is still online, give them another
    chance" semantics — supervisors who push counts to operators may
    notice rows getting reaped from operators who are still on the
    floor but currently between counts. (B2 keeps the safety net.)
  - SQL function lives in a migration; changing its body requires
    a new migration. (Acceptable per project convention.)
- **Effort:** B1 — small. ~5-line diff to the SQL function +
  reapplied migration + integration test. B2 — small + one query
  to `worker_heartbeats.status`. B3 — small (~3 lines in
  `scheduler/mod.rs` reading from the cache; 1-line scheduler
  signature change to pass the cache handle).
- **Risk:** low. Additive to the existing predicate; existing
  `in_progress` semantics in `detect_and_release_abandoned` are
  untouched. Failure modes are well-understood (worst case: a row
  gets reaped from an operator who's mid-cognition-pause — they
  re-claim and continue).

### Option C — Admin banner / WS canary

Emit a `WARN`-level log AND a UI banner (via existing
`workServiceWs`) when `claim_next_task` returns `None` AND the org
has `>N` unassigned-pending rows. Does NOT fix the cascade; surfaces
it immediately so admins can navigate to Stuck Assignments without
waiting for an operator to complain.

- **Pros**
  - Cheapest of the four options.
  - High observability win even if A or B never ships.
  - Bridge from "the 2026-05-07 toast was silenced for sanity" to
    "the right person still gets pinged when it matters."
  - WS plumbing already exists — `WsEvent::ReservationEscalated`
    is precedent; a sibling `WsEvent::ClaimBlockedByZone` (or
    similar) reuses the same broadcast path.
- **Cons**
  - Doesn't fix anything; it just surfaces the problem.
  - Adds noise if the threshold isn't tuned — needs to fire on real
    cascades, stay quiet on transient zero-claim moments.
- **Effort:** small. ~30 lines of Rust (route handler decision + WS
  emit) + a FE banner component subscribing to the new
  variant. ~50-100 LOC total.
- **Risk:** minimal. Pure observability layer; can't break the
  claim path.

### Option D — FE auto-release on Confirm-screen exit

`beforeunload` / route-change handler that fires `releaseTask` on
the held row when the operator navigates away from the Confirm
screen without explicitly completing or releasing it.

- **Pros**
  - Prevents the row from getting stuck in the first place for the
    common case (operator opens row, then taps Back / closes tab).
  - Cheap and self-contained on the FE.
- **Cons**
  - `beforeunload` is unreliable — mobile backgrounding, Citrix
    kiosk teardown, network drop, browser crash, OS reboot all skip
    the handler.
  - Doesn't help with rows that are ALREADY stuck.
  - Doesn't address the predicate that allows the cascade.
- **Effort:** small. ~20 LOC in `useUnifiedCycleCount` /
  `RFCycleCountUnified` plus auditable network log.
- **Risk:** low-ish. False-positive releases (operator's network
  blips during the `unload` POST) could surprise the operator on
  re-open by handing them a different row.

## Combinations

The four options are **not mutually exclusive**.

- **B + C** is the production-ready answer. B bounds the blast
  radius to the threshold; C surfaces in-flight cascades so admins
  don't have to discover them via operator complaints. Both are
  additive, both are small.
- **D** layers on top of B + C as defence-in-depth — covers the
  "operator deliberately backs out" common case without waiting for
  the B threshold to fire.
- **A alone** is risky: it eliminates the cascade at the cost of
  removing the soft-reservation safety net, and we have no
  telemetry today on how often that safety net prevents real
  contention.
- **A + C** is viable if telemetry from C shows the soft-reservation
  branch's "race protection" rarely fires in practice. C provides
  the data that justifies — or doesn't — eventually dropping to A.

## Recommendation

**Ship B (specifically B2 + B3) and C now. Defer A. Defer D unless
B2 telemetry shows operators are getting frequent surprise reaps.**

- **B2** addresses today's exact incident shape (online-but-idle
  operator's stale claim) without breaking the
  "still-actively-counting" protection.
- **B3** is the smallest standalone correctness fix: today's
  hardcoded 60-min ignores the per-org config admins already have a
  UI for, surfaced by the audit.
- **C** turns the next incident from "operator complains → admin
  investigates → maybe finds it" into "WS event fires → admin sees
  banner → 30-second Unassign." Closes the discovery gap that made
  today's incident take >2 hours to surface.
- **A** is structurally cleaner but requires telemetry we don't have
  to commit to safely. Re-evaluate after C ships and we have
  observability on how often the soft-reservation branch matters.
- **D** is a UX nicety that doesn't unblock anyone if the
  `beforeunload` doesn't fire; not worth front-loading unless
  cascade frequency stays high after B + C.

This recommendation is conditional on B's actual implementation
matching the small-diff estimate. If reading the SQL function and
its migration reveals B is materially harder than 5 lines + one
migration (e.g. the function is referenced by other SECURITY
DEFINER chains that need re-auditing), C alone is a defensible
first step and B can follow in a separate sprint.

## Migration plan (B + C, in order)

1. **Audit `escalate_stale_zone_reservations` once more before
   editing.** Confirm the heartbeat-guard semantics in the live
   function are exactly what `pg_get_functiondef` returns today
   (already done in the Note-Worthy Finding — captured verbatim).
   Note that the function is SECURITY DEFINER + sets
   `app.cycle_count_zone_lock_bypass='on'` to bypass the
   migration-266 write-time zone trigger; preserve that bypass when
   editing.
2. **B3 first (it's the smallest):** change
   `rust-work-service/src/scheduler/mod.rs:107` from
   `bind(60_i32)` to read the per-org
   `reservation_escalation_minutes` from `SettingsCache::resolved`.
   The scheduler runs ORG-wide; pick the right semantic — either
   call the function once per org with that org's threshold (clean,
   ~10-line change) or pass the org-min as a parameter to a
   variant function. Whichever lands smaller in PR review.
3. **B2 second:** new migration that replaces the existing
   `public.escalate_stale_zone_reservations` body. Replace the
   current heartbeat-guard clause:

   ```sql
   AND (
     hb.last_hb IS NULL
     OR hb.last_hb < NOW() - make_interval(mins => p_threshold_minutes)
   )
   ```

   with:

   ```sql
   AND (
     hb.last_hb IS NULL
     OR hb.last_hb < NOW() - make_interval(mins => p_threshold_minutes)
     OR (
       -- Online-but-idle operators DON'T grant cascade-protection:
       -- if they're heartbeating with status='idle' (no current_task /
       -- current_location), their stale claim isn't worth blocking the
       -- whole zone for. Actively-counting operators (status='busy'
       -- with current_location set) keep the protection.
       SELECT status FROM worker_heartbeats
        WHERE user_id = rcc.assigned_to
        ORDER BY last_heartbeat DESC LIMIT 1
     ) = 'idle'
   )
   ```

   Keep the `SECURITY DEFINER` + `SET search_path` + `PERFORM
   set_config('app.cycle_count_zone_lock_bypass','on',true)` lines
   verbatim. Add the migration number per current convention (next
   would be `309_…` based on the `308_fix_has_permission_role_id.sql`
   already on disk today).
4. **C:** add `WsEvent::ClaimBlockedByZone` variant in
   `rust-work-service/src/websocket/mod.rs`. Emit from the
   `/api/v1/work/claim` route handler when `claim_next_task` returns
   `None` AND a cheap follow-up `SELECT COUNT(*)` of
   `unassigned pending in org` > N (suggested: 50). FE adds a
   subscriber + an admin-only banner component (gated on the
   admin-permission check already used by the Stuck Assignments
   card).
5. **Integration tests** in `rust-work-service/tests/`:
   - Seed a `pending+assigned` row whose owner is heartbeating with
     `status='idle'` → assert the escalator reaps it after
     threshold.
   - Seed a `pending+assigned` row whose owner is heartbeating with
     `status='busy'` AND `current_location` set → assert the
     escalator does NOT reap (protection preserved).
   - Seed an org with >50 unassigned pending + the cascade
     condition → call `/work/claim` for a clean operator → assert
     `task: null` AND a `WsEvent::ClaimBlockedByZone` was
     broadcast.
6. **Cargo.toml bump** `0.1.42 → 0.1.43`. Quality gates per
   2026-05-14 PM template (`cargo build` + `cargo test --bin
   rust-work-service` + `cargo clippy` + `ReadLints` + `pnpm
   lint:check`).
7. **Deploy as v0.1.43** via `railway up`. Post-deploy validation:
   `/health → 0.1.43`; manually seed an idle-but-online stale row
   in staging and confirm the scheduler reaps it on the next tick;
   confirm the WS event arrives in the admin banner.

## Decision triggers

Re-evaluate this ADR when ANY of the following becomes true:

1. **Cascade incidents > 1/week** despite B + C — Option A becomes
   the next escalation.
2. **Average reap window > X min** causes operational SLA breach —
   tighten the per-org `reservation_escalation_minutes` (B3 already
   makes this admin-tunable) or move to A.
3. **Telemetry from C shows the soft-reservation `pending` branch's
   "race protection" is negligible** — < N races prevented per
   week — justifies dropping to A entirely and removing the
   `pending` literal from both filters.
4. **A second pattern emerges** where the escalator's heartbeat
   guard skips a legitimate reap that B2 doesn't catch (e.g.
   operator stays `busy` with `current_location` set indefinitely
   on a different row than the one stuck pending) — extend B2's
   predicate.
5. **`zone_pattern` adoption changes** — if a future org enables a
   finer `zone_pattern` (per-aisle) the cascade radius shrinks
   automatically. If MOST orgs end up on fine patterns and only
   legacy ones use `NULL`, the urgency on A drops.

## Open questions

1. Should B3's threshold default match the existing
   `reservation_escalation_minutes` (60) or be configurable
   separately (e.g. a new `pending_assigned_reap_minutes` finer
   knob)? Recommendation: reuse the existing setting unless
   admins ask for finer control — one fewer knob to manage.
2. Should the C banner be admin-only (gated on
   `inventory_apps:edit` or similar) or floor-wide? Recommendation:
   admin-only — floor operators already had their toast quieted in
   2026-05-07; surfacing it to them again would re-introduce the
   noise [[Fix-RF-CycleCount-Empty-Queue-Noise]] consciously chose
   to avoid.
3. Should we add an **operator-side** "Release my held row"
   affordance on the RF cycle-count screen so the operator can
   self-recover before the B2 threshold fires? Today the only
   exit-without-complete is to close the tab — which leaves the
   row stuck. A visible Release button on the Confirm screen
   would let the operator unblock themselves AND the zone.
4. Is the per-org `reservation_escalation_minutes` setting actually
   exposed in the admin UI today, or is it DB-only? If DB-only, B3
   may not be operationally useful without a small admin-UI add.
   (Out of scope to verify without reading the FE side; flag for
   the PR author.)
5. Is the cascade common enough on smaller orgs (finer
   `zone_pattern`) to justify A long-term? Today we have N=1
   tenant data point. Decide after 2-4 weeks of C-telemetry.

## Related

- [[Fix-RF-Cycle-Count-Zone-Soft-Reservation-Cascade-2026-05-18]] —
  today's debug note; full RCA + reproduction + scope.
- [[Fix-RF-Cycle-Count-Stuck-Waiting]] — 2026-05-14 Phase 0 fix;
  DIFFERENT root cause, healthy in v0.1.42, not implicated today.
- [[Fix-Trigger-Evaluator-Empty-After-v041-Restart]] — 2026-05-14
  trigger-loader retry; healthy, unrelated.
- [[Cycle-Count-Zone-Exclusivity]] — the original zone-mutual-
  exclusion implementation (migrations 232 + 233 + 266); the
  predicate this ADR proposes touching.
- [[Cycle-Count-Zone-Sticky-And-Assignments]] — companion zone
  engine work.
- [[Zone-Reservation-Enforcement-Two-Operators-Same-Zone]] — prior
  Debug note on the write-time trigger (the authoritative guard
  that backstops any read-filter relaxation in Option A).
- [[Cycle-Count-Bug-Fix-Pass-Migration-252]] — added
  `supervisor_assigned_at` / `supervisor_assignment_protection_hours`
  which the escalator already honours.
- [[Cycle-Count-Final-Hardening-Pass-Migration-253]] — last round
  of escalator hardening.
- [[Fix-RF-CycleCount-Empty-Queue-Noise]] — the 2026-05-07 FE noise
  fix that intentionally hid per-claim toasts; informs the C
  open-question on whether to re-surface them.
- [[ADR-Pooler-Mode-Flip-Session-To-Transaction]] — sibling
  `status/proposed` ADR; same shape & tone.
- [[Sessions/2026-05-18]] — today's session log with the user's
  decision to draft this ADR.
- `rust-work-service/src/db/queries.rs:443-462` (Phase 2 filter)
- `rust-work-service/src/db/queries.rs:1792-1808` (Phase 0 filter)
- `rust-work-service/src/scheduler/mod.rs:65-151` (escalator job +
  hardcoded `bind(60_i32)`)
- `rust-work-service/src/settings/cache.rs:88` (per-org
  `reservation_escalation_minutes` already loaded but unused by
  the scheduler)
- `rust-work-service/src/strategies/mod.rs:28-44` (settings struct
  + 60-min default)
- `public.escalate_stale_zone_reservations(integer)` — current
  body captured verbatim in the Note-Worthy Finding.
- `docs/runbooks/work-engine/stuck-zone.md` — existing operator-
  facing runbook; should reference this ADR + the new debug note
  once B + C ship.
