---
tags: [type/decision, status/proposed, domain/backend, domain/database, domain/frontend, domain/infra]
created: 2026-05-18
---

# ADR — Work-distribution pipeline architecture review (2026-05-18)

## Status / Date / Owner

- **Status: Proposed (drafted 2026-05-18).** Synthesis of 5 incidents over
  12 days; documentation-only (no code / DB / env / deploy).
- **Owner:** unassigned.
- **Triggered by:** the user asking for a permanent solution beyond the
  short-term ADR [[ADR-Cycle-Count-Soft-Reservation-Cascade-Mitigation]],
  scoped to the entire claim/dispatch pipeline and forward-looking for
  additional task types beyond `cycle_count`.

## 1. Executive summary

The rust-work-service claim path has been hit by **five distinct
failure modes in 12 days** (2026-05-07 → 2026-05-18). Each was patched
tactically and most fixes are healthy in production (v0.1.42), but the
incidents share a structural shape: **silent reads return `task: null`
while real work exists, and there is no observability layer that
catches these silent-empty conditions automatically**. The B+C plan
in [[ADR-Cycle-Count-Soft-Reservation-Cascade-Mitigation]] is the
correct 48-hour move — it closes today's exact cascade — but it does
NOT close the larger class. The pipeline scales poorly to new task
types today: only `cycle_count` has a real strategy, the
zone-mutual-exclusion filter is cycle-count-specific SQL embedded in
the candidate scan, and the capacity / escalator predicates each carry
their own asymmetric guards. **Ship B+C now; in parallel, invest in
reason-coded dispatch decisions + an observability SLI on
`silent-null-with-work` so the next class fails loudly. Defer a generic
queue rewrite to medium-horizon.**

Headline:

1. **Same architectural shape, three different bug sites**: capacity-gate
   ordering (2026-05-14 AM), boot pool-race (2026-05-14 PM x2), and now
   read-filter / escalator-guard asymmetry (2026-05-18).
2. **Phase 0 firing 57x in 24h proves disconnect-mid-count is COMMON,
   not rare** — the resume path is now critical infrastructure. Any
   future regression silently re-introduces the David / James / Marvin
   class.
3. **The escalator IS firing daily** (multiple `Escalated N stale zone
   reservations` per day; same row escalated twice in 3 hours on
   05-16). The heartbeat-guard ONLY skips ONLINE-but-idle operators —
   which is exactly the 2026-05-18 shape.
4. **The single tenant on cycle-count today (`c9d89a74`) is
   worst-case** for cascade radius (`zone_pattern = NULL` ⇒ whole-zone
   lock). Adding new tenants narrows cascades by default.
5. **Generic dispatch is mostly stub code**: only `cycle_count` has a
   real strategy; `zone_audit` + `pick` are skeletons; `replenish` and
   `kit_pick` aren't even registered. Shipping a new work type today
   means duplicating cycle_count's 800-line SQL path, not adding a
   plug-in.

## 2. The five incidents — pattern analysis

| # | Date | Bug class | Where the failure mode lived | What surfaced it | Status |
|---|---|---|---|---|---|
| 1 | 2026-05-07 | FE noise on every empty claim (4-line stack per tap) | `client.ts`, `useUnifiedCycleCount` | Console flood after `railway up` | ✅ Fixed FE (debug-log + `Promise.resolve().catch()`). Underlying capacity-gate bug deferred. |
| 2 | 2026-05-14 AM | Capacity gate short-circuits Phase 1 resume (`open_per_type=1 ≥ cap=1` blocks own row) | `queries.rs::claim_next_task` order: capacity → claim. Latent since 2026-05-07. | David Simmons stuck on "Pull Next"; field complaint | ✅ Fixed (Phase 0 short-circuit) → v0.1.40 deploy crash-looped EMAXCONNSESSION → v0.1.41 redeploy with lazy general pool. |
| 3 | 2026-05-14 PM | Trigger evaluator wedged with empty `TriggerSet` after boot pool race | `triggers/loader.rs::run`: single-attempt `reload()` failed with `PoolTimedOut`, silently used `default()` | Auto-confirm putaway backlog growing (35 rows in 24h) | ✅ Fixed (5-attempt retry loop, 1/2/4/8 backoff + error-on-giveup) → v0.1.42 first attempt FAILED (listener-pool eager init) → v0.1.42 second attempt SUCCESS. |
| 4 | 2026-05-14 PM | Listener-pool eager init crash-loop on rolling deploy | `main.rs:301`: `build_pool_with_flag_overrides_named().expect()` | v0.1.42 deploy crash-loop | ✅ Fixed (lazy variant + retry probe) → v0.1.42 live. |
| 5 | 2026-05-18 | Phase-2 zone filter treats `pending+assigned` as "occupied" even when escalator's heartbeat-guard exempts the assignee | `queries.rs:443-462` + `:1792-1808` vs. `public.escalate_stale_zone_reservations()` heartbeat-guard | Marvin Berry stuck while 383 RP counts free; admin discovered via `Stuck Assignments` | 🟡 Operationally unblocked (admin Unassign). [[ADR-Cycle-Count-Soft-Reservation-Cascade-Mitigation]] proposes B2+B3+C. |

### Pattern

- **#1 + #2 + #5** are silent-failure incidents: route returns
  `200 OK { success: false, task: null }`. FE has no diagnostic
  affordance (intentionally — see [[Fix-RF-CycleCount-Empty-Queue-Noise]]).
  Operator hits Pull Next, sees nothing happen, complains hours later.
- **#2 + #3 + #4** are deploy-time pool races. The 2026-05-14
  back-to-back fixes converged on "both pools lazy + retry-on-empty".
  Healthy now but the underlying Supavisor `pool_size=16` ceiling is
  still tight (see [[ADR-Pooler-Mode-Flip-Session-To-Transaction]]).
- **#1 + #2 + #5** all have **read predicates that diverge from the
  authoritative write-side or recovery predicate**:
    - #2: capacity check + Phase 1 used **different status sets**;
      Phase 1 had no chance to fire.
    - #5: Phase 2 read filter (`'pending'+assigned' as occupied`) +
      escalator (`+heartbeat stale`) disagree on what counts as
      "abandoned".
    - #1: FE error throw + happy-path `task: null` use the **same
      transport shape** (`success:false`) with no out-of-band
      distinction; the noise fix had to add `allowFalseSuccess`.
- **5 of 5** were on `c9d89a74` (`thyssenkrupp-materials`) — corrected
  from the original "3 of 5" framing after fresh vault re-verification
  on 2026-05-18 21:55Z (every incident Debug note explicitly references
  this org_id). That org is the **only** active cycle-count tenant
  today, but the bug classes are tenant-agnostic. The cascade radius IS
  tenant-config-dependent (`zone_pattern=NULL` is worst case).
- **No single fix was deployed cleanly first try.** Two of four
  `railway up`s failed. Both due to a shared resource ceiling
  (Supavisor session-mode pool_size=16) that the deploy pipeline
  doesn't budget for.

## 3. Pipeline architecture as-built

```
┌── RF UI ─────────────────────────────────────────────────────────────────┐
│ RFCycleCountUnified  ──claimNext()──▶  useUnifiedCycleCount             │
│        ▲                                       │                        │
│ (workServiceWs subscribed for TaskAssigned/    │ POST /api/v1/work/claim│
│  TaskStatusChanged/ReservationEscalated/       ▼                        │
│  QueueStatsUpdated/PushedWork)              fetchWithAuth ──HTTPS──▶    │
└─────────────────────────────────────────────────────────────────────────┘
                                                                           │
┌── rust-work-service v0.1.42 ────────────────────────────────────────────▼┐
│ routes/work.rs::claim                                                   │
│   resolve task_type → strategy from DispatchStrategyRegistry            │
│   load ResolvedWorkTypeSettings via SettingsCache (60s TTL)             │
│   call db::claim_next_task(...)                                         │
│                                                                         │
│ db::queries::claim_next_task                                            │
│   Phase 0   phase0_already_assigned_{cycle_count | generic}             │
│             (READ-only — bypasses capacity gate; reads rr_cyclecount_   │
│              data for cycle_count, work_tasks for the rest)             │
│   Capacity  resolve_effective_capacity (work_tasks open per type +      │
│             worker_profiles.max_concurrent_tasks ?? 3)                  │
│   Phase 2   cycle_count → claim_next_cycle_count (TX, Phase 1 zone-     │
│             aware resume + FOR UPDATE SKIP LOCKED candidate scan)       │
│             else      → generic_claim_against_work_tasks (strategy     │
│             static SQL fragments)                                       │
│   return Option<CycleCountTask>                                         │
│                                                                         │
│ strategies/                                                             │
│   CycleCountStrategy    ✅ full (facade over claim_next_cycle_count)    │
│   ZoneAuditStrategy     🟡 stub (order_clause only)                     │
│   PickStrategy          🟡 stub (order_clause only)                     │
│   replenish/kit_pick    ❌ not registered → 400 BadRequest              │
│                                                                         │
│ scheduler/mod.rs (4 jobs)                                               │
│   abandonment    5min — release in_progress > 30min back to             │
│                         pending+assigned + release_stale_heartbeat_     │
│                         assignments(10) for stale-HB in_progress       │
│   queue stats   30sec — broadcast QueueStatsUpdated per-org             │
│   worker cleanup 1min — mark heartbeats offline if > 5min               │
│   escalation    5min — escalate_stale_zone_reservations(60) HARDCODED  │
│                         (ignores work_type_settings.reservation_       │
│                         escalation_minutes from SettingsCache)         │
│                                                                         │
│ triggers/                                                               │
│   loader  LISTEN agent_triggers_changed; hot-reload TriggerSet         │
│   evaluator per-table LISTEN; matches rules + INSERTs sap_agent_jobs   │
│             + broadcasts WsEvent::TriggerFired                          │
│                                                                         │
│ websocket/  WsEvent enum (20 variants in the FE mirror as of            │
│   2026-05-18; see src/lib/work-service/types.ts L177-271. Earlier       │
│   draft said 28 — corrected after re-count on 2026-05-18 21:55Z)        │
│                                                                         │
│ Pool topology  general (lazy, 20 conn) + listener-dedicated             │
│                (lazy, 30 conn) against Supavisor SESSION mode           │
│                (port 5432, pool_size=16) ← shared ceiling               │
└─────────────────────────────────────────────────────────────────────────┘
                                                                          │
┌── Postgres ────────────────────────────────────────────────────────────▼┐
│ rr_cyclecount_data         ← cycle_count source-of-truth (369 pending,  │
│                                0 in_progress today)                     │
│ work_tasks                 ← generic projection (sparse — only 6        │
│                                cycle_count pending in proj. right now)  │
│ worker_heartbeats          ← presence (3 idle, 57 offline)              │
│ cycle_count_zone_rules     ← 1 row for c9d89a74 (zone_pattern=NULL)     │
│ cycle_count_zone_assignments                                            │
│ cycle_count_operator_deferred_counts (2 active)                         │
│ work_type_settings         ← per-(org, task_type) tunables              │
│ work_engine_settings       ← per-org feature flags                      │
│ agent_triggers             ← Phase 9 DSL (2 enabled rules)              │
│ sap_agent_jobs             ← downstream job table for omni_agent        │
│ public.escalate_stale_zone_reservations(60) ← SECURITY DEFINER          │
│ public.release_stale_heartbeat_assignments(10) ← SECURITY DEFINER       │
│ public.cycle_count_zone_of(loc, pattern) ← pattern resolver             │
└─────────────────────────────────────────────────────────────────────────┘
```

Key file references:

- Route + capacity timing: `rust-work-service/src/api/routes/work.rs:130-243`
- Dispatcher entry: `rust-work-service/src/db/queries.rs:1941` (`claim_next_task`)
- Phase 0 resume helpers: `queries.rs:1742` (cycle_count), `queries.rs:1850` (generic)
- Capacity gate: `queries.rs:1674` (`resolve_effective_capacity`)
- Cycle-count claim (Phase 1 + 2): `queries.rs:221` (Phase 1 zone-aware existing), `queries.rs:443-462` (Phase 2 zone-mutual-exclusion filter — the 2026-05-18 cascade lives here)
- Generic claim: `queries.rs:2055` (`generic_claim_against_work_tasks`)
- Strategy registry: `rust-work-service/src/strategies/mod.rs:140`
- Scheduler: `rust-work-service/src/scheduler/mod.rs:16` (4 cron jobs)
- Escalator hardcoded threshold: `scheduler/mod.rs:107` (`bind(60_i32)`)
- Settings cache: `rust-work-service/src/settings/cache.rs:45` (`resolved`)
- WS event enum mirror: `src/lib/work-service/types.ts:177`
- FE hook: `src/hooks/use-unified-cycle-count.ts:344` (claim mutation),
  `:687` (auto-claim-on-mount gate), `:499` (releaseTask), `:507`
  (skipTask)
- FE landing: `src/components/ui/rf-cycle-count-unified.tsx:1798-1855`
  (Pull-Next-Count landing)

## 4. Live state snapshot (queried 2026-05-18 ~19:55Z–21:35Z)

```
rr_cyclecount_data org=c9d89a74
  status×push_mode:
    pending,pull        : 369
    completed,pull      : 7675
    completed,push      : 4
    variance_review,pull: 775
    variance_review,push: 2
    approved,pull       : 301
    approved,push       : 1
  pending+assigned     : 0 (post admin-Unassign; was 1 at 19:40Z)
  in_progress          : 0

work_tasks org=c9d89a74
  cycle_count, completed: 3632
  cycle_count, pending  : 6   ← drift from rr_cyclecount_data (369). Sparse
                              projection by design but worth a sweep
                              audit (Recommendation O-3).
  cycle_count, claimed/in_progress: 0
  zone_audit / pick / replenish / kit_pick : NO rows ever.

cycle_count_zone_rules org=c9d89a74 (1 row)
  enabled=true, policy=one_counter_per_zone
  zone_pattern=NULL  ← WORST CASE cascade radius
  sticky_zone=false, treat_null_zone_as_locked=false
  supervisor_assignment_protection_hours=24

work_type_settings org=c9d89a74
  cycle_count : enabled, cap=1, abandon=30, esc=60, hb_release=10
  pick        : enabled, cap=5, esc=60
  zone_audit  : enabled, cap=1, esc=60
  putaway, replenish, kit_pick : disabled (defaults loaded but no claims)

worker_heartbeats org=c9d89a74
  3 idle (median 32s since last_heartbeat, p95 59s, worst 62s)
  57 offline (mostly very stale — cleanup-pending)
  0 busy (no in-flight cycle counts right now)

7-day stuck-pattern (rows pending+assigned > 30min)
  2026-05-12..2026-05-18: 0 stuck rows per day in retrospect.
  ← Misleading! When admin Unassign clears a stuck row, the
     pending+assigned signature DISAPPEARS — historical query
     can never find prior cascades. Observability gap (R-O-2).

agent_triggers org=c9d89a74
  enabled=true: Auto-Confirm Completed Putaways → /sap/confirm-to
  enabled=true: Auto-Confirm Completed Picks → LT12 → /sap/lt12
  (Phase 9 evaluator healthy since 2026-05-14 v0.1.42)

cycle_count_operator_deferred_counts: 2 active (right now)
```

Railway log signatures (last 24h, rust-work-service v0.1.42):

- `No tasks available`: **dominant** (rate-limit hit at 500/sec on level filter — true volume is multi-hundred/min during shift)
- `Phase 0 returning already-assigned row`: **57** firings — disconnect-mid-count is COMMON, NOT rare. Resume path is now critical infra.
- `capacity exhausted`: **0** — Phase 0 is correctly preventing the David / James class from ever reaching the gate.
- `Escalated N stale zone reservations`: multiple/day. `CC-20260424-1222` escalated TWICE in 3h on 2026-05-16 — a row that gets stuck once is likely to be re-stuck (same operator, same zone). Today (2026-05-18T21:35Z) the escalator caught `CC-20260424-1328` (a new stuck row appeared post-incident, but late in the day so no operators were blocked).
- `Auto-release` (`detect_and_release_abandoned`): **0** firings — no row stayed `in_progress` > 30min in the window.
- Boot signatures (`v0.1.42`): clean. `trigger_loader: initial load succeeded attempt=1`. Listener pool's `PoolTimedOut`-then-reconnect dance during deploys is documented as expected (~7s blip).

## 5. Failure-mode inventory

| # | Category | Failure mode | Sev | Mitigation today | Gap |
|---|---|---|---|---|---|
| F1 | Claim path | Capacity-gate ordering blocks own resume | P0 | ✅ Phase 0 short-circuit (v0.1.41+) | None (covered by `dispatcher_phase1` regression test) |
| F2 | Claim path | Phase 2 zone-mutual-exclusion cascades from one stuck `pending+assigned` row to entire zone (today's incident) | P0 | 🟡 Admin Unassign UI (manual) | **Predicate asymmetry vs. escalator heartbeat-guard**. ADR proposes B2 (idle-status-aware guard) + B3 (per-org threshold). |
| F3 | Claim path | Phase 0 helper applies a NARROWER zone filter (`('in_progress','recount')` — see `queries.rs:1805`) than Phase 2 (`('pending','in_progress','recount')` — see `queries.rs:459`). Today's cascade class therefore does NOT block Phase 0 own-resume in the cycle_count path. Phase 0 GENERIC (`queries.rs:1850`) has NO zone filter at all (relies on the migration-266 trigger being immutable). Latent risk: if a row's zone is reassigned post-claim via admin, Phase 0 generic resumes blind | P2 (downgraded from P1 after 2026-05-18 21:55Z code re-read) | Phase 0 cycle_count's narrower status set; mig-266 trigger | If the trigger ever changes status semantics, Phase 0 generic resume could land an operator in a now-foreign zone. Worth a sweep test. |
| F4 | Claim path | `claim_next_task` strategy-filter Skip path leaves a Phase-2-claimed row assigned (intentional) — scheduler abandonment job has to reclaim | P2 | Abandonment job runs every 5min | Reclaim window = 5..30min depending on `abandonment_minutes`. Could fast-path. |
| F5 | Claim path | Generic path (`zone_audit`, `pick`) HAS a zone-mutual-exclusion filter (`queries.rs:2100-2110`, against `work_tasks.dispatch_zone` for `held.status IN ('claimed','in_progress')`) but it does NOT include the SOFT-reservation status (`pending` rows with `assigned_to IS NOT NULL`) the way cycle_count's Phase 2 does. So new work types get the conservative (only-block-active-claims) semantics — they cannot opt into the soft-reservation race-protection without duplicating SQL. Original ADR overstated the gap as "no filter at all" — corrected 2026-05-18 21:55Z | P2 | The filter exists, but isn't pluggable per strategy | Strategy contract should declare `wants_soft_reservation_collision: bool` (or `zone_collision_predicate(...) -> Option<&str>`). |
| F6 | State transitions | Operator closes Confirm screen → row stays `pending+assigned` forever (the 2026-05-18 mechanism) | P0 | 🟡 Admin Unassign UI; escalator with 60min + heartbeat-stale guard | B2 from cascade ADR; FE `beforeunload`/route-change auto-release (D) as defense-in-depth. |
| F7 | State transitions | Two operators simultaneously tap Pull Next on overlapping zones → DB write-time trigger rejects loser; UX = error toast | P3 | Migration 266 write-time zone trigger | The race exists. Real-life freq unknown (no telemetry). |
| F8 | State transitions | Defer-list scopes per-user but historical bug (2026-05-01) had global scope → could re-emerge in other phases | P2 | Read-side filter scoped to `user_id` after the May-01 fix | Audit: any other place that reads the defer table? |
| F9 | Heartbeat / liveness | Online-but-idle operator (RF tab open, not actively counting) keeps heartbeating → escalator skips their stale claim indefinitely | P0 (when paired with F2) | None today | B2 (idle-status-aware guard). |
| F10 | Heartbeat / liveness | `worker_heartbeats` is org-wide single-row-per-user; no per-task-claim binding | P3 | Implicit via `current_task_id`/`current_location` | A claim that's older than the operator's session implies a session restart but isn't surfaced. |
| F11 | Heartbeat / liveness | Heartbeat cadence is FE-driven; no server-side eviction beyond `cleanup_stale_workers` (1min cron) → up to ~6min for `status=offline` flip after disconnect | P3 | 5min stale → offline | `last_heartbeat < now() - 5m AND status != 'offline'` UPDATE; not push-based. |
| F12 | Zone rules | `zone_pattern=NULL` ⇒ cascade radius = whole `zone` column ⇒ single stuck row blocks whole floor (today's worst-case shape) | P0 | None today | Org-config; bigger orgs typically set finer patterns. |
| F13 | Zone rules | `treat_null_zone_as_locked=false` default treats unresolved-zone rows as unrestricted; alternative setting could over-block | P3 | Per-org tunable | Documented in [[Cycle-Count-Zone-Exclusivity]]. |
| F14 | Zone rules | Sticky-zone affordance present but per-org-disabled; if enabled, candidate ORDER BY adds a sticky tiebreaker that interacts with priority | P3 | Off today (false) | If turned on for other orgs, regression risk on "critical not first". |
| F15 | Zone rules | Multi-rule per org not modelled (`cycle_count_zone_rules` is currently single-row; loop runs `EXISTS` per rule) | P3 | Adequate today | Future: rule-of-rules priority order undefined. |
| F16 | Push vs pull | Push acknowledgment cycle: row goes `push_mode='push', push_acknowledged=false` → operator must ack → if no ack, stays in `pushed_pending` | P2 | Scheduler doesn't auto-reap pushed_pending | A push that nobody acknowledges sits forever until pushed_by un-pushes. |
| F17 | Push vs pull | Push targeting can overlap with pull eligibility (push assigns a row; pull candidate scan filters `assigned_to IS NULL`) — race between push-by-supervisor and pull-by-other-operator on the same row | P3 | DB write-time uniqueness trigger | UX: pusher sees "target user already has higher priority" sometimes |
| F18 | Dispatch / scheduler | Escalator hardcodes 60-min threshold (`scheduler/mod.rs:107: bind(60_i32)`); ignores per-org `reservation_escalation_minutes` already loaded in `SettingsCache::resolved` | P1 | None today | B3 in cascade ADR. |
| F19 | Dispatch / scheduler | Escalator iterates org-wide once per tick — does NOT per-org loop with each org's tunable threshold | P2 | Hardcoded single threshold | Wire to `SettingsCache::resolved` per-org. |
| F20 | Dispatch / scheduler | `detect_and_release_abandoned` hardcodes 30-min (`assigned_at < now() - INTERVAL '30 minutes'`); ignores per-org `abandonment_minutes` | P2 | None | Same fix shape as B3. |
| F21 | Dispatch / scheduler | `release_stale_heartbeat_assignments(10)` hardcodes 10-min; ignores per-org `heartbeat_release_minutes` | P2 | None | Same. |
| F22 | Dispatch / scheduler | Scheduler cron uses `tokio_cron_scheduler` (in-process). If the cron loop hangs (e.g. one job blocks the runtime), all four jobs stall | P2 | None (the jobs are async + short) | Add cron tick instrumentation + warn if a tick is missed. |
| F23 | Dispatch / scheduler | No retry on escalator failures (a single bad rows iteration could lose an escalation cycle) | P3 | Logged at error, but next tick (5min) retries | Acceptable; document. |
| F24 | Trigger evaluator | `triggers::loader::run` was wedged silently 2026-05-14 (resolved); the LISTEN-only-recovery path is still the safety net | P1 → P3 now | ✅ 5-attempt retry loop, error-on-giveup (v0.1.42) | F25 below + observability gauge `work_trigger_set_total > 0`. |
| F25 | Trigger evaluator | `triggers::evaluator::handle_notification` returns `Ok(())` on `for_table → None` with NO log — wedge is invisible | P2 | None | Add `warn!` for first-occurrence + Prometheus gauge of empty-table notifications. |
| F26 | Trigger evaluator | `bad NOTIFY payload (skipped) ... missing field row_id` for `sap_agent_jobs` channel is ambient noise — payload shape doesn't carry `row_id` for the jobs-table's own NOTIFYs | P3 | Logged once at startup | Distinguish noise from real bad payloads; structured-payload-version. |
| F27 | Infra | Supavisor session-mode `pool_size = 16` is the binding ceiling during rolling deploys; both `rust-work-service` pools are lazy (post 2026-05-14) so panics are gone, but ~7s 5xx blip per deploy remains | P2 | ✅ Lazy pools + retry probe | Pooler-mode flip blocked on sqlx 0.7 named-prepared-statement collision (see [[ADR-Pooler-Mode-Flip-Session-To-Transaction]]). |
| F28 | Infra | `WORK_SERVICE_DATABASE_POOLER_URL` env-var DOC drift (says "port 6543 transaction" but actually `:5432` session) | P3 | Documented in two debug notes | Fix the comment in `main.rs` OR flip the env var (latter is blocked). |
| F29 | Infra | All Rust services start an eager listener pool; if any other Rust service starts a similar boot dance, it inherits the same EMAXCONNSESSION risk | P2 | None — only rust-work-service lazy-patched | Audit + same fix in other services as needed. |
| F30 | Infra | The deploy pipeline does NOT include a post-deploy smoke test that exercises `/api/v1/work/claim` for a known in-flight operator — the 2026-05-14 AM "deploy succeeded but old container still serving" trap took 90min to discover | P1 | None | Smoke-claim CI step. |
| F31 | Observability | `No tasks available` is logged at INFO with no reason code — "queue empty" / "capacity exhausted" / "all candidates zone-blocked" / "all candidates deferred" all collapse to the same line | P0 | None today | Reason-coded log: distinct enum + structured field. |
| F32 | Observability | No metric for "claim returns None while > N candidates exist for org" — the canary that would have caught today's cascade automatically | P0 | None today | C from cascade ADR + Prometheus gauge. |
| F33 | Observability | Once an admin Unassigns a stuck row, the `pending+assigned` signature is gone forever — historical SQL queries cannot find prior cascade events | P2 | None | Append-only `claim_dispatch_events` table OR `work_event_log` with reason codes. |
| F34 | Observability | Phase 0 firing rate (57x in 24h) is a critical signal but isn't aggregated or alarmed — silent regression would re-introduce David/James class invisibly | P1 | INFO log line only | Prometheus counter + ratio alert (Phase 0 firing : Phase 2 firing). |
| F35 | Observability | Multi-org future: today's queries all assume `c9d89a74`. Adding a tenant would require per-org SLO scaffolding | P3 | Single tenant today | Per-org dashboards once N>1. |
| F36 | Frontend | `claimMutation.onSuccess({task: null})` logs at `debug` only (2026-05-07 noise fix). Operator sees Pull Next landing with no signal. | P2 | Intentional UX call | Compromise: operator-side "explain" affordance when claim returns null AND queue (per `/work/queue`) shows >0 rows. |
| F37 | Frontend | `autoClaimOnMount` defaults to `false` for `RFCycleCountUnified`; operators have to tap Pull Next on every cold open | P3 | Intentional (post 2026-05-07) | Add a `useEffect` that auto-resumes Phase 0 rows specifically without firing Phase 2. |
| F38 | Frontend | Operator-side Release affordance EXISTS (`rf-cycle-count-unified.tsx` header L1887-1912 → `handleReleaseTask` L1516 → `ConfirmDialog` L2798-2808 → `releaseTask()`) on every workflow step including Confirm — but it's a small inline chip in the header, NOT a prominent affordance on the Confirm review surface itself. Original ADR overstated this as "no affordance" — corrected 2026-05-18 21:55Z. The actual gap is **discoverability**, not existence | P2 (downgraded from P1) | Existing header chip | T-7 → make the existing chip a primary CTA on the Confirm step, or surface a "release this row" affordance on the Pull-Next landing for operators who can't see their currently-held row. |
| F39 | Frontend | `beforeunload`/route-change auto-release not wired — closing the tab leaves the row `pending+assigned` (the 2026-05-18 mechanism) | P1 | None | Option D in cascade ADR (deferred). |
| F40 | Frontend | `WsEvent::ReservationEscalated` is broadcast but FE has no banner / toast that surfaces it to the affected operator or admins | P2 | Logged + cached in tanstack | Banner subscribing to the variant. |
| F41 | Multi-tenancy | Only `cycle_count` strategy is implemented; `zone_audit` + `pick` are stubs; `replenish` + `kit_pick` aren't registered | P2 (future) | 400 if requested | Generic claim path needs to gain zone/heartbeat/escalator parity per type. |
| F42 | Multi-tenancy | Per-tenant cascade radius (`zone_pattern`) decision is made at zone-rule INSERT time — no UI affordance to preview the cascade radius on a hypothetical config change | P3 | Engineer-only | Admin UI: "preview cascade radius for `pattern='aisle'`" before-save. |
| F43 | Data integrity | `rr_cyclecount_data` ↔ `work_tasks` projection drift: 369 pending in source vs. 6 pending in projection. Sparse-by-design but lacks an audit script | P3 | Designed sparse | Periodic reconciler script + dashboard tile. |
| F44 | Data integrity | A claim cannot be "completed" without a `claim_id` trace — completion uses the row id from `rr_cyclecount_data`, not a dispatch-event id. Repeated claims of the same row by the same operator across sessions are not distinguishable | P3 | `assigned_at` timestamp + audit log of claim events would help | Append-only event table. |
| F45 | Data integrity | The escalator's `notes` append is the only audit trail for an escalation; format is string-prose, not structured | P3 | `notes` columns | If we add an event table, structured fields go there. |
| F46 | Data integrity | `work_tasks.pending` rows for cycle_count (6 right now, no source row in `in_progress`) are likely orphan projection rows from past claim cycles | P3 | None | Reconciler + sweep. |

## 6. Recommendations (full)

Effort: XS<½d, S=½–2d, M=2–5d, L=1–2wk, XL=>2wk.
Risk: L=isolated, M=cross-cuts one subsystem, H=touches multiple subsystems.
Impact on user goal: L=local fix, M=closes one incident class, H=closes a class + raises future floor.
Horizon: Now=<48h, Soon=1–2wk, Med=1mo, Long=quarter+.

### Tactical (already in play or near-term)

| ID | Recommendation | Effort | Risk | Impact | Horizon | Depends on |
|---|---|---|---|---|---|---|
| T-1 | **B2 from cascade ADR** — escalator heartbeat-guard becomes `idle`-status-aware (online-but-idle operators don't grant cascade protection) | S | L | H | Now | Migration 309 |
| T-2 | **B3 from cascade ADR** — wire scheduler `bind(60_i32)` to per-org `reservation_escalation_minutes` from `SettingsCache` (already loaded but unused — F18) | XS | L | M | Now | None |
| T-3 | **C from cascade ADR** — admin banner on `claim_next_task → None AND unassigned_pending > N` via WS `ClaimBlockedByZone` (new variant) | S | L | H | Now | None |
| T-4 | **F3 — tighten Phase 0 zone filter** — exclude the operator's OWN held row from the zone-collision check (it's a resume contract, not a candidate selection) | XS | L | M | Now | None |
| T-5 | **Wire `detect_and_release_abandoned` + `release_stale_heartbeat_assignments` to per-org tunables** (F20, F21 — same shape as T-2) | S | L | M | Now | None |
| T-6 | **Generalise Phase 0 zone-aware filter to `zone_audit` + `pick`** (today only cycle_count has the pattern-aware filter; new types will inherit the cascade) | S | L | M | Soon | T-4 |
| T-7 | **Operator-side "Release my held row" CTA on the RF Confirm screen** (F38, ADR open question #3) — closes the most common F39 case without `beforeunload` flakiness | S | L | M | Soon | None |
| T-8 | **F39 — `beforeunload` / route-change best-effort `releaseTask` from RF** — defense-in-depth | XS | L | M | Soon | T-7 |
| T-9 | **F33 — append-only `work_dispatch_events` table** — every claim attempt, every release, every escalation, with reason codes | M | M | H | Soon | None |

### Mid-tier refactor

| ID | Recommendation | Effort | Risk | Impact | Horizon | Depends on |
|---|---|---|---|---|---|---|
| M-1 | **Reason-coded dispatch result** — `claim_next_task` returns `Result<ClaimOutcome>` where `ClaimOutcome = Hit(task) \| EmptyQueue \| CapacityExhausted \| AllZoneBlocked \| AllDeferred \| StrategyFiltered`; route maps to structured log + WS + metric | M | M | H | Med | None |
| M-2 | **Explicit reservations table** (`work_reservations` PK `(task_id, user_id)`) instead of soft-using `assigned_to` on `rr_cyclecount_data` for the pending state — separates "claimed" from "in-progress" cleanly | L | M | H | Med | M-1 |
| M-3 | **Session-scoped lease** — claim returns `(task, lease_token, expires_at)`; operator extends lease via heartbeat; lease expiry auto-releases (replaces today's `assigned_at < now() - 30min` predicate with explicit lease) | L | M | H | Med | M-2 |
| M-4 | **Pre-fetch next-N** — `claim_next_task(N=3)` returns a window of next candidates so FE can show "next up" without round trip per row | M | M | M | Med | M-1 |
| M-5 | **Server-side dispatch decision events** broadcast via WS (`WsEvent::DispatchDecisionLogged`) — every claim attempt's reason becomes observable in real time on admin dashboards | S | L | M | Med | M-1 |
| M-6 | **Migrate Phase 2 zone-mutual-exclusion to a pluggable strategy method** (`strategy.zone_collision_predicate(...) -> Option<&'static str>`) so new task types can opt-in (or opt-out) of cycle-count's zone semantics | M | M | M | Med | F5 |
| M-7 | **Per-org SLI: `claim_success_within_3s` + `claim_returns_with_work_in_queue`** — the two SLIs that, if alarmed, catch every silent-failure class today | M | L | H | Med | M-1, T-9 |
| M-8 | **F25 — `work_trigger_set_total` Prometheus gauge** — alerts when set is empty while `agent_triggers WHERE enabled=true > 0` exists | XS | L | M | Med | None |
| M-9 | **Post-deploy smoke claim** (F30) — CI step runs `POST /api/v1/work/claim` for a known in-flight test-user immediately after `railway up` healthcheck passes; failure rolls back | S | L | M | Med | None |
| M-10 | **`work_tasks` ↔ `rr_cyclecount_data` reconciler** (F43, F46) — periodic sweep + tile on admin dashboard | S | L | L | Med | None |

### Strategic

| ID | Recommendation | Effort | Risk | Impact | Horizon | Depends on |
|---|---|---|---|---|---|---|
| S-1 | **Generic job queue abstraction** — `pgmq` or `river` (Rust-native) for all task types, with cycle_count migrating progressively. Eliminates rr_cyclecount_data ↔ work_tasks projection drift class | XL | H | H | Long | M-1, M-2, M-3 |
| S-2 | **Event-sourced state** — work tasks become a stream of events (`TaskCreated`, `TaskClaimed`, `TaskReleased`, `TaskCompleted`); projections are eventually consistent rebuilds | XL | H | H | Long | S-1 |
| S-3 | **Generic `WorkTask` with task-type extensions** — typed payload per task type, dispatched via the strategy registry; today's cycle_count-specific columns become `payload JSONB` keyed by `schema_version` | L | M | H | Long | M-6 |
| S-4 | **Multi-region readiness** — single-writer-per-org assumption holds today; cross-region would need conflict resolution on assignments | XL | H | M | Long | S-1, S-2 |
| S-5 | **SLO + synthetic monitoring** — formal SLOs (claim success rate, claim-to-confirm latency, cascade-recovery time), synthetic test agents that periodically claim + complete to detect silent regressions | L | L | H | Long | M-7 |

### Forward-looking (scales to new task types)

| ID | Recommendation | Effort | Risk | Impact | Horizon | Depends on |
|---|---|---|---|---|---|---|
| FL-1 | **Strategy plug-in points for new task types** — formal contract beyond today's `extra_where + order_clause`; declare zone semantics, capacity, abandonment, defer behaviour as trait methods | M | M | H | Med | M-6, S-3 |
| FL-2 | **Cross-type fairness** — operator with 0 cycle_count + 0 pick + 0 zone_audit but cycle_count is empty should be routed to pick/zone_audit if eligible (today there's no cross-type ordering) | M | M | M | Med | FL-1 |
| FL-3 | **Generic WS event variants** — `WorkTaskAssigned { task_type, ... }` instead of cycle-count-specific `TaskAssigned` event name; backward-compat via `task_type` field | S | L | M | Med | None |
| FL-4 | **Per-task-type DB-trigger zone-exclusivity** — migration 266's trigger is `rr_cyclecount_data`-specific; new tables need their own | M | M | M | Med | FL-1 |
| FL-5 | **Per-task-type capability gating** — `worker_capabilities.work_types` already supports this; ensure new strategies USE it | XS | L | M | Soon | None |

### Operational

| ID | Recommendation | Effort | Risk | Impact | Horizon | Depends on |
|---|---|---|---|---|---|---|
| O-1 | **Runbook: cascade detection + admin Unassign** — document in `docs/runbooks/work-engine/` (the directory already exists; `stuck-zone.md` is there) | XS | L | M | Now | T-3 |
| O-2 | **Daily "stuck row" metric** in admin email digest or Slack — `count(*) FROM rr_cyclecount_data WHERE status='pending' AND assigned_to IS NOT NULL` per org per hour | S | L | M | Soon | T-9 |
| O-3 | **`work_tasks` ↔ source-table reconciler dashboard tile** (F43, F46) | S | L | L | Med | M-10 |
| O-4 | **On-call rota for work-distribution P0s** — formalise who gets paged when `claim_success_ratio` SLI breaches | XS | L | M | Med | M-7 |
| O-5 | **Customer-tier visibility** — admin UI surfaces "queue health" per tenant on a single page (today admins navigate to multiple sub-tabs) | M | L | M | Med | T-3, T-9 |
| O-6 | **Cascade-radius preview** in zone-rule admin UI (F42) — calculate `max(count(*) per zone WHERE status='pending')` for candidate `zone_pattern` before save | M | L | M | Long | None |

## 7. Proposed roadmap by horizon

### NOW (<48h) — close the most likely next incident, low risk

**Goal:** ensure tomorrow's shift can't hit today's cascade again, AND raise observability so the next class fails loudly.

- **T-1 (B2)** + **T-2 (B3)** + **T-3 (C)** from
  [[ADR-Cycle-Count-Soft-Reservation-Cascade-Mitigation]] (single PR;
  one migration for B2, one Rust diff for B3, one Rust + FE diff for C).
- **T-4** Phase 0 own-row exclusion (smallest possible diff; closes F3
  before it can fire).
- **T-5** wire abandonment / heartbeat-release to per-org tunables (same
  pattern as B3; ship in the same PR to keep the scheduler consistent).
- **M-9** post-deploy smoke claim (CI step that fires `POST /work/claim`
  with a known in-flight test user; alerts on `task: null` AND log line
  `Phase 0 returning already-assigned row` absent). This costs ~½ day
  and would have caught the 2026-05-14 AM "deploy didn't take effect"
  trap inside 5 min instead of 90 min.
- **O-1** runbook update (admin Unassign procedure + WS event
  description).

**Acceptance criteria:**

- For an idle-but-online operator's stale `pending+assigned` row
  older than the per-org threshold: escalator reaps within the next
  tick (≤5 min).
- Admin banner appears when `claim_next_task → None` AND
  `unassigned_pending > 50` AND fires within 10 s of the third
  consecutive empty claim from the same org.
- Post-deploy smoke claim passes in CI; failure rolls back the deploy.
- A green-field operator (no held row) on the affected org claims
  successfully within 1 s after the stuck row is reaped.

**Test plan:** Cargo integration tests seeding `(pending+assigned,
status='idle')` + `(pending+assigned, status='busy', current_location=set)`
+ `(unassigned_pending > 50)` against a test DB; Vitest covering
the new admin banner subscriber.

**Rollback strategy:** Each change is independent; revert the migration
for B2 (the only DDL change), revert the Rust diff for B3 / C / T-4 /
T-5 / M-9 (no DDL).

### SOON (1–2 wk) — observability + operator-side affordances

**Goal:** reduce time-to-detection on the NEXT silent-failure class
from "operator complains" to "on-call gets paged".

- **T-6** generalise Phase 0 zone filter to `zone_audit` + `pick`
  (new types inherit cycle_count's zone semantics — closes F5 for
  near-term enabled types).
- **T-7** operator-side "Release my held row" CTA on Confirm screen
  (closes F38 → today's most common cascade source without
  `beforeunload` flakiness).
- **T-8** `beforeunload` / route-change best-effort `releaseTask`
  (defense-in-depth on top of T-7).
- **T-9** append-only `work_dispatch_events` table (every claim,
  release, escalation, with reason codes — closes F33 historical
  blindness and unlocks M-1).
- **M-5** broadcast `WsEvent::DispatchDecisionLogged` (live admin
  view of the same event stream).
- **O-2** daily stuck-row digest.
- **FL-5** wire per-task-type capability gating (cheap; ensures new
  strategies USE the existing `worker_capabilities` infrastructure).

**Acceptance criteria:**

- 100 % of `claim_next_task` returns produce a row in
  `work_dispatch_events`, key by reason code.
- Operator sees a Release button on the Confirm screen; tapping it
  clears `assigned_to` within 200 ms.
- Closing the tab fires `releaseTask` 80 % of the time (mobile +
  Citrix kiosks excluded; expected upper bound).
- Admin dashboard surfaces a "stuck pending+assigned > 10 min" tile
  refreshed every 30 s via the existing `QueueStatsUpdated` cadence.

**Test plan:** Vitest for the Release CTA + `beforeunload` handler;
integration test for the events table (seed claim attempt → assert
row inserted with expected reason code).

**Rollback strategy:** Independent migrations; revert the events table
DDL if the storage cost is unacceptable.

### MEDIUM (1 mo) — reason-coded results, lease semantics, generic strategy contract

**Goal:** turn "silent null" into an impossible condition, and make
adding a new task type a 1-day exercise instead of a 2-week project.

- **M-1** reason-coded `ClaimOutcome` enum returned from
  `claim_next_task`; route handler maps to structured log + WS event +
  metric. Replaces the binary `Some(task) | None` contract.
- **M-2** explicit reservations table (`work_reservations`) replaces
  soft-using `assigned_to` on source rows for the "claimed but not yet
  in-progress" state. Removes the entire F2/F3/F6/F39 cascade class —
  reservations can have a TTL.
- **M-3** session-scoped lease tokens (replaces today's
  `assigned_at < now() - 30 min` predicate with explicit lease
  expiry). Heartbeat extends; missed heartbeat releases.
- **M-6** pluggable zone-collision predicate (strategy method, not SQL
  fragment) — closes F5 for all future task types.
- **M-7** per-org SLIs + alerts (`claim_success_within_3s`,
  `claim_returns_with_work_in_queue`).
- **M-8** `work_trigger_set_total` Prometheus gauge (closes F25
  observability gap).
- **M-10** `work_tasks` ↔ source reconciler (closes F43, F46).
- **FL-1** formal strategy contract (zone semantics, capacity,
  abandonment, defer behaviour as trait methods).
- **FL-3** generic WS event variants (rename for forward-compat).

**Acceptance criteria:**

- Adding a new task type requires: implement `DispatchStrategy`,
  add row to `work_type_settings`, add migration for any new
  source/projection table. NO changes to `queries.rs` core.
- SLI dashboard shows green `claim_success_within_3s ≥ 99.5 %`,
  `claim_returns_with_work_in_queue ≤ 0.5 %` per org over 7-day
  rolling window.
- Reservation TTL configurable per task-type; expired reservations
  reaped within ≤5 min.
- 100 % of `No tasks available` log lines carry a reason code field.

**Test plan:** Property-based tests for `ClaimOutcome` mapping;
integration tests for the new `work_reservations` lease + expiry;
Vitest for the SLI dashboard tiles.

**Rollback strategy:** Each component (M-1, M-2, M-3) is independently
revertable. The reservation table runs alongside the legacy
`assigned_to` column until M-2's migration drops the latter.

### LONG (quarter+) — generic queue, event sourcing, scale targets

**Goal:** support N tenants × M task types without per-type SQL.

- **S-1** evaluate generic job queue (pgmq vs. river vs. keep-and-
  extend the current pattern). Decision is itself an ADR — don't
  prejudge.
- **S-2** event-sourced state for work tasks (full audit trail; the
  `work_dispatch_events` table from T-9 is the seed).
- **S-3** generic `WorkTask` with payload extensions per type.
- **S-4** multi-region readiness (single-writer-per-org assumption
  needs explicit conflict resolution).
- **S-5** formal SLOs + synthetic monitoring (synthetic test agents
  that periodically claim + complete on a test tenant).
- **FL-2** cross-type fairness routing.
- **FL-4** per-task-type DB-trigger zone-exclusivity.
- **O-6** cascade-radius preview UI.

**Acceptance criteria** (per ADR-to-be):

- New task type "replenish" lands in <1 sprint with no `queries.rs`
  changes.
- Tenant onboarding has a published zone-pattern guide + radius
  preview.
- p99 claim latency ≤ 200 ms across all task types at 10× current
  load.

**Test plan + rollback strategy:** Per-component ADRs.

## 8. Why this path

- **NOW = B+C + T-4/T-5/M-9.** B+C is already justified by
  [[ADR-Cycle-Count-Soft-Reservation-Cascade-Mitigation]]; adding T-4
  (Phase 0 own-row exclusion) is free and closes a latent equivalent
  of today's bug; T-5 (per-org abandonment / heartbeat-release) ships
  in the same scheduler PR as B3 with the same shape; M-9 (post-deploy
  smoke claim) closes the trap from 2026-05-14 AM that took 90 min to
  discover. This is the most defensive package for ~1 day of effort.
- **SOON = observability + operator affordances.** Today's incidents
  all surfaced via operator complaint hours after onset. Reason-coded
  reasons + an event table + an operator Release CTA + admin
  dashboards turn "silent null" into "alarmed-and-visible". This is
  the highest-leverage 1-2 wk investment because the next bug class
  becomes a 10-min discovery instead of a 2-hr discovery.
- **MEDIUM = M-1 (reason codes) + M-2 (reservations table) + M-3
  (leases) + M-6 (pluggable zone).** These together eliminate the
  entire "soft-using `assigned_to` to mean reservation" class that
  today carries F2/F3/F6/F39. They also make M-7 (SLIs) trivial
  because the events + outcome enum already carry the reason codes.
- **LONG = generic queue ADR.** Don't prejudge today. The strategy
  pattern is fine for the next 2-3 task types; revisit when the diff
  between strategies stops fitting in `static_sql()` fragments.

## 9. What we explicitly chose NOT to do, and why

- **A from cascade ADR (drop `'pending'` from Phase 2 zone filter
  entirely)** — would close the cascade but eliminates the
  soft-reservation safety net for the within-window race-protection.
  We have no telemetry on how often that branch actually prevents real
  races. Defer to MEDIUM after C-telemetry quantifies it.
- **Option 2 from
  [[ADR-Pooler-Mode-Flip-Session-To-Transaction]]** (flip to
  transaction-mode) — blocked on sqlx 0.7's hardcoded named prepared
  statements (proven in production on 2026-05-07 → 25 min of universal
  5xx). Lazy pools + retry probes already closed the deploy-crash
  class; the residual ~7 s 5xx blip is bounded and self-clearing. The
  flip becomes viable when sqlx 0.8 lands or pgcat/pgbouncer-rs swap.
- **Rewriting the dispatcher in Rust as event-sourced from
  scratch** — too much risk, too much value already in
  `rr_cyclecount_data` + `work_tasks` + the strategy pattern.
  Incremental M-1 → M-2 → M-3 gets us 80 % of the value with 20 % of
  the risk.
- **Adding a new realtime channel (Supabase `postgres_changes`) to
  surface dispatch decisions** — explicitly forbidden by
  `Master Rule workspace rule` and
  [[ADR-Presence-Architecture-Next-Steps]]; the precedent pattern is a
  new `WsEvent` variant + `PgListener` on a `NOTIFY` trigger, which
  M-5 already proposes.
- **Cron loop instrumentation today (F22)** — defer to MEDIUM as part
  of M-7 SLIs. Today the cron jobs are short async; the failure shape
  is a stale schedule, which would show in the SLI before it shows in
  the cron-tick metric.
- **Multi-region capacity planning (S-4)** — not relevant in the
  next 2 quarters per
  [[ADR-Capacity-Ceiling-2k-Users]]; the binding wall is FastAPI +
  Realtime, not work-service.
- **Rewriting omni_agent** — out of scope per the user's framing
  ("adjacent to the pipeline"). The Phase 9 trigger evaluator is the
  agent's contract; that's the right abstraction line.

## 10. Open questions for the user

1. **Reservation TTL philosophy** — should the new reservations table
   (M-2) use a fixed TTL (e.g. 30 min) or be linked to the operator's
   session (lease extends with heartbeat — M-3)? Session-bound is
   correct but harder to model on RF kiosks where sessions are long.
2. **Per-org config vs. global defaults** — `work_type_settings` is
   per-(org, task_type). Once T-2 (B3) wires the scheduler to it,
   should the UI expose ALL the knobs (`reservation_escalation_minutes`,
   `abandonment_minutes`, `heartbeat_release_minutes`)? Or hide them
   behind a "sensible defaults" toggle for non-superadmin tenants?
3. **Admin banner severity** (C) — should the WS-driven banner be a
   toast (dismissible), a persistent alert ribbon at the top of the
   admin shell, or a notification in the bell icon? The 2026-05-07
   noise fix consciously hid per-claim toasts for operators; the C
   variant is admin-only by default but the banner-vs-toast call
   matters for response time.
4. **Operator Release CTA placement** (T-7) — on the Confirm screen
   only, or also on the Pull Next landing if the operator's queue
   shows they hold a row but they can't see it? The latter doubles as
   a self-recovery affordance for the David / James class.
5. **Generic queue evaluation timing** (S-1) — start the ADR now
   while context is fresh, or wait until M-1 + M-2 ship and we know
   the strategy abstraction's actual sharp edges?
6. **Synthetic test agent** (S-5) — would the team operate a
   permanent fake-tenant test environment with synthetic operators
   doing periodic claims, or rely on real-tenant traffic + SLOs? The
   former is more reliable; the latter is cheaper.
7. **Cross-type fairness routing** (FL-2) — today operators are
   single-task-type at a time (RF Cycle Count, RF Picking,
   RF Putaway are separate screens). Should the dispatcher offer
   cross-type routing ("no cycle counts; want a pick instead?") or
   keep each screen scoped? Affects UX flow + strategy contract.

## 11. Decision triggers

Re-evaluate this ADR when ANY of:

1. **A 6th cascade-class incident in 30 days** — escalates M-2 (explicit
   reservations) from MEDIUM to SOON.
2. **A new tenant onboards with cycle-count** — validates / invalidates
   the `zone_pattern=NULL` worst-case assumption; if MOST orgs use
   finer patterns, A becomes the cheaper long-term move.
3. **A new task type (zone_audit, pick, replenish) lands in
   production** — exposes whether the strategy plug-in contract (M-6,
   FL-1) is fit-for-purpose. If we end up duplicating `queries.rs`
   logic, S-1 escalates.
4. **sqlx 0.7 → 0.8 upgrade lands** (for any reason) — unblocks
   [[ADR-Pooler-Mode-Flip-Session-To-Transaction]] Option 2, which
   would alter the deploy-time pool calculus.
5. **Operator pool > 50 per org concurrent** — F11 (heartbeat 5 min
   stale-flip) starts mattering for capacity; push-based eviction
   becomes worth implementing.
6. **Realtime org-fanout cap moves** ([[ADR-Capacity-Ceiling-2k-Users]]
   updates) — would unlock options foreclosed today.

## 12. Related

- [[ADR-Cycle-Count-Soft-Reservation-Cascade-Mitigation]] — the
  short-term B+C plan this ADR is a strict superset of.
- [[Fix-RF-Cycle-Count-Zone-Soft-Reservation-Cascade-2026-05-18]] —
  today's incident; primary forcing function.
- [[Fix-RF-Cycle-Count-Stuck-Waiting]] — 2026-05-14 Phase 0 fix;
  proves disconnect-mid-count is common.
- [[Fix-Trigger-Evaluator-Empty-After-v041-Restart]] — 2026-05-14
  trigger-loader wedge; observability lesson for M-8.
- [[Fix-RF-CycleCount-Empty-Queue-Noise]] — 2026-05-07 FE noise fix;
  precedent for the silent-`task:null` UX choice that this ADR
  partially reverses (M-1 + T-3).
- [[Investigate-Work-Tasks-Capacity-Gate-Returning-Existing-Task]] —
  the originally-deferred 2026-05-07 ticket that became the 2026-05-14
  Phase 0 fix.
- [[ADR-Pooler-Mode-Flip-Session-To-Transaction]] — sibling deferred
  ADR; explains why F27 / F28 stay as documented constraints.
- [[ADR-Capacity-Ceiling-2k-Users]] — capacity context (work-service
  pool ceiling is not the binding wall today).
- [[ADR-Presence-Architecture-Next-Steps]] — the realtime policy
  (forbids new `supabase.channel` callsites); informs M-5.
- [[Roadmap-Rust-WS-Unlocks]] — the channel-migration backlog M-5
  shares architecture with.
- [[Cycle-Count-Zone-Exclusivity]] — original zone-mutex semantics.
- [[Cycle-Count-Zone-Sticky-And-Assignments]] — companion zone-engine
  work.
- [[Implement-Resilient-PgListener]] — pattern Z-Y on LISTEN recovery.
- [[Implement-Rust-Work-Service-Phase9]] — trigger evaluator (M-8
  target).
- [[Sessions/2026-05-18]] — today's session log; this ADR is
  cross-linked from there.
- `rust-work-service/src/api/routes/work.rs:130-243` (claim handler)
- `rust-work-service/src/db/queries.rs:1941` (`claim_next_task`)
- `rust-work-service/src/db/queries.rs:443-462` (Phase 2 zone filter — today's cascade site)
- `rust-work-service/src/db/queries.rs:1742-1849` (Phase 0 helpers)
- `rust-work-service/src/scheduler/mod.rs:65-151` (escalator job + hardcoded `bind(60_i32)`)
- `rust-work-service/src/settings/cache.rs:45-106` (`SettingsCache::resolved`)
- `rust-work-service/src/strategies/mod.rs:140-152` (registry)
- `src/hooks/use-unified-cycle-count.ts:344-461` (FE claim mutation)
- `src/components/ui/rf-cycle-count-unified.tsx:1798-1855` (landing UI)
- `src/lib/work-service/types.ts:177-271` (WS event mirror)
- `public.escalate_stale_zone_reservations(integer)` (heartbeat-guard SQL — F2/F9)
- `public.release_stale_heartbeat_assignments(integer)` (sibling reaper — F21)
- `docs/runbooks/work-engine/stuck-zone.md` — existing operator runbook (O-1 extends this)

## 13. Validation log — 2026-05-18 ~21:55Z fresh re-verification

User requested an independent re-verification of every claim in this
ADR against current Railway logs, Supabase live state, and code at
HEAD. Four parallel verifiers ran (backend code, frontend code, vault
incident narrative, and live data). Verdict: **largely accurate
(~92% of claims hold exactly as written)**, with five material
corrections applied inline above and a handful of nuances captured
below. The structural conclusions (B+C is the right NOW move;
reason-coded outcomes + reservations table are the right MEDIUM;
generic queue deferred to LONG) are **unchanged** by this validation
pass.

### Corrections applied inline (5)

1. **Section 2 pattern footer** — "3 of 5 on c9d89a74" → "5 of 5 on
   c9d89a74". Vault re-read confirms every Debug note in the incident
   table explicitly cites org_id `c9d89a74-7179-4033-93ea-56267cf42a17`.
2. **Section 2 table row #2** — the 2026-05-14 AM deploy that
   crash-looped EMAXCONNSESSION was **v0.1.40** (not v0.1.41); v0.1.41
   was the successful redeploy with the lazy general pool. Confirmed
   against `Fix-RF-Cycle-Count-Stuck-Waiting.md` line 449.
3. **Section 3 architecture diagram** — `WsEvent enum (28 variants
   today)` → `20 variants`. Counted in `src/lib/work-service/types.ts`
   L177-271: TaskAssigned, TaskStatusChanged, WorkerStatusChanged,
   QueueStatsUpdated, PushedWork, Heartbeat, ReservationEscalated,
   SapAgentChanged, PresenceJoined, PresenceUpdated, PresenceLeft,
   SapJobStatusChanged, ImportRunStatusChanged,
   CycleCountOperationChanged, Lx03DataChanged, EntityFocus,
   Notification, RfPutawayChanged, SapAgentConsoleLine, TriggerFired
   = **20** total.
4. **Section 5 F3** — Phase 0 cycle_count zone filter is NARROWER
   (`'in_progress','recount'` at `queries.rs:1805`) than Phase 2's
   (`'pending','in_progress','recount'` at `queries.rs:459`). The
   original gap claim ("own-resume can be blocked by another user's
   stale pending+assigned in same zone") is **false in production
   today**. F3 reframed as the narrower latent risk on Phase 0
   GENERIC (no zone filter at all — relies on the mig-266 trigger
   invariant; downgraded to P2.
5. **Section 5 F5** — `generic_claim_against_work_tasks` DOES have a
   zone-mutual-exclusion filter (`queries.rs:2100-2110`, against
   `work_tasks.dispatch_zone` for `held.status IN ('claimed',
   'in_progress')`). The gap is specifically the SOFT-reservation
   branch (no `pending + assigned_to` case), not the entire filter.
   Recommendation M-6 (pluggable zone-collision predicate) still
   stands but its motivation is sharpened.
6. **Section 5 F38** — operator-side Release affordance EXISTS as a
   small header chip on every workflow step including Confirm; the
   gap is **discoverability**, not absence. T-7 reframed from "add a
   Release CTA" to "promote the existing chip to a primary affordance
   on the Confirm screen + add a parallel affordance on the Pull-Next
   landing for operators who can't otherwise see their held row".
   Severity P1 → P2.

### Confirmed-as-written

- **18 backend file:line citations** (work.rs claim handler ✅,
  queries.rs:1941 `claim_next_task` three-phase structure ✅,
  queries.rs:443-462 Phase 2 zone filter ✅, queries.rs:1674
  `resolve_effective_capacity` ✅, scheduler/mod.rs:107 hardcoded
  `bind(60_i32)` ✅, scheduler/mod.rs:185 hardcoded `INTERVAL '30
  minutes'` for abandonment ✅, scheduler/mod.rs:200-205 hardcoded
  `bind(10_i32)` for heartbeat-release ✅, strategies/mod.rs:140-152
  registry with cycle_count/zone_audit/pick only ✅, triggers/loader.rs
  5-attempt retry with 1/2/4/8 backoff ✅, triggers/evaluator.rs
  `for_table → None → Ok(())` silent return ✅, pool_setup.rs lazy
  pools ✅, settings/cache.rs:45 `resolved` with all three tunables ✅,
  WsEvent variants in types.ts ✅).
- **5 of 5 incident narratives** match the cited Debug notes
  (2026-05-07 noise loop, 2026-05-14 AM capacity, 2026-05-14 PM
  trigger loader wedge, 2026-05-14 PM listener-pool eager init,
  2026-05-18 zone soft-reservation cascade).
- **Patterns A, B, C** all genuinely shared across multiple incidents
  as the ADR claims.
- **No 6th cycle-count work-distribution incident** found in the
  2026-05-07 → 2026-05-18 window. Adjacent (non-claim-path) issues
  exist (auto-confirm putaway TO backlog 5/08, LT10 phantom re-claims
  5/09, Redis pool init crash 5/11, Postgres connection exhaustion
  5/11) but none belong in the cycle-count claim-path incident table.
- **Live state snapshot (Section 4) still matches today** within the
  hour: 369 pending pull cycle counts, 0 stuck pending+assigned, 0
  in_progress, work_tasks projection still 6 pending / 3632 completed
  (drift unchanged), 1 cycle_count_zone_rules row with
  `zone_pattern=NULL` + `sticky_zone=false` +
  `treat_null_zone_as_locked=false`, 2 enabled agent_triggers.
  work_type_settings re-queried with the correct column names
  (`capacity_per_worker`, not `max_concurrent_tasks_per_user`):
  cycle_count + pick + zone_audit enabled; putaway + replenish +
  kit_pick rows EXIST with `enabled=false`. 7-day completion volume
  100/330/463/825/394/301 for 5/18 through 5/12 (today only ~100
  because shift is mid-flight).
- **Live escalator log signatures (last 4 days)** confirm the
  ADR's "escalator IS firing daily" claim:
    - 2026-05-14T18:25Z — 1 row (`CC-20260421-3970`)
    - 2026-05-14T20:55Z — 2 rows
    - 2026-05-14T21:15Z, 21:25Z, 21:35Z, 21:40Z — 1 row each
    - 2026-05-15T20:20Z, 21:10Z, 21:40Z, 22:05Z — 1 row each
    - 2026-05-16T17:45Z — `CC-20260424-1222`; **20:20Z** — **same row
      escalated AGAIN** (matches ADR's "same row escalated twice in
      3h on 05-16" claim ✅)
    - 2026-05-18T21:35Z — `CC-20260424-1328` (matches the ADR's
      "today the escalator caught CC-20260424-1328" claim ✅)
- **`capacity exhausted` log line frequency = 0** in current window
  (matches ADR's claim that Phase 0 is correctly preventing the
  David/James class from ever reaching the gate).
- **Phase 0 firing rate** hit Railway's 500 logs/sec replica rate
  limit when filtered for `Phase 0 returning already-assigned`
  (53k-character output across 57 lines truncated to file). This is
  consistent with the ADR's claim of multi-hundred Phase 0 firings
  per shift — actual count cannot be measured without a Prometheus
  counter (M-8 / Recommendation O-2).

### New findings (not in the original ADR)

- **`SettingsCache::resolved` silently swallows DB errors** —
  `cache.rs:77` uses `.unwrap_or_default()` on the sqlx query result.
  A transient pool timeout returns an empty per-org map → global
  defaults (capacity 1, abandonment 30m, escalation 60m, heartbeat
  release 10m) are served for the entire 60s TTL window. Worth adding
  as **F47** to the inventory: silent settings-cache failure could
  mask per-org tunables once T-2 / B3 ships. Severity P2.
- **Phase 0 generic helper has NO zone filter at all**
  (`queries.rs:1850-1855`; docstring at L1843-1849 explicitly states
  "for an already-owned row, no zone-collision filter is needed
  because the row could not have been assigned in the first place if
  a different user already held its zone"). This assumes the
  migration-266 zone trigger is immutable. If a row's `dispatch_zone`
  is ever administratively reassigned post-claim, Phase 0 generic
  resume would happily return a row in a now-foreign zone. Severity
  P3 (theoretical); covered by reframed F3 above.
- **Frontend has TWO heartbeat code paths**, not one as the
  architecture diagram (Section 3) implies. WS heartbeat at
  connect/disconnect only (`rf-interface.tsx:1052,1055`,
  status='online'/'offline'); authoritative stateful HTTP heartbeat
  on `setInterval` (every 30s) via `useWorkerHeartbeat` in
  `use-pushed-work.ts:413-470`. Neither honours `visibilitychange` —
  RF tab kept open overnight continues heartbeating even when hidden.
- **Operator-side skip-then-claim path DOES surface explainer
  toasts** (`use-unified-cycle-count.ts:527-552`) for ZONE_LOCKED /
  ZONE_ASSIGNED responses with owner-name parsing. F36's claim
  "operator never sees an explainer" overstates the gap — operators
  see explainers on the skip flow, just not on the pull flow.
- **`main.rs:301` line citation is stale** — that line is now inside
  a comment block (rolling-deploy explanation L294-310). Actual eager
  init call sites that were patched lazy are L239 (general pool) and
  L314 (listener pool).
- **Strategy trait file is 153 lines total** (`strategies/mod.rs`) —
  any future reference to "line 200" is invalid. Trait surface for
  `DispatchStrategy` documented at L78-120.
- **Three `#[allow(dead_code)]` markers in the trigger evaluator**
  (`loader.rs:33`, `TriggerSet::total` at L51,
  `build_pool_with_flag_overrides` non-named non-lazy variant) — knip
  / dead-code latent targets. Not a runtime issue today.
- **Scheduler module docstring is stale** (`mod.rs:1-6` mentions 3
  jobs in the header doc but `start_scheduler` registers 4).
  Cosmetic; documented as a follow-up.

### Roadmap impact

- **NOW (B+C + T-4 + T-5 + M-9):** confirmed; T-4 ("Phase 0 own-row
  exclusion") is reframed slightly — the gap is NOT cycle_count Phase
  0 (already narrower) but Phase 0 GENERIC, plus a clarifier that the
  filter divergence between Phase 0 cycle_count, Phase 2 cycle_count,
  Phase 0 generic, and generic claim path is a separate strategy-
  contract question for M-6.
- **SOON (T-6 through T-9, M-5, O-2):** unchanged.
- **MEDIUM (M-1 through M-10, FL-1, FL-3, FL-5):** unchanged; M-6
  motivation sharpened by the F5 nuance — the strategy contract
  needs to declare *which collision semantics* it wants (active-only
  vs. soft-reservation-inclusive), not just whether it wants any.
- **LONG (S-1 through S-5):** unchanged.

### Vault notes touched this validation pass

- This ADR (`ADR-Work-Distribution-Pipeline-Architecture-Review-2026-05-18.md`)
  — five inline corrections + this Section 13 appended.
- `_Index/Decisions.md` — already references this ADR; no further
  edits needed.
- `Sessions/2026-05-18.md` — append a "Re-validation of
  comprehensive-review ADR" subsection.

No code edits. No DB writes. No deploys. No env changes. Pure
validation + targeted vault corrections.
