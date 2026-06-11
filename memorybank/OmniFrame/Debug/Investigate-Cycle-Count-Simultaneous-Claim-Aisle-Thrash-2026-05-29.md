---
tags: [type/debug, status/active, domain/backend, domain/database, domain/concurrency]
created: 2026-05-29
---
# Investigate — Cycle-Count Simultaneous-Claim Aisle/Zone Thrash (2026-05-29)

## Symptom

Operators report: when **two of them press "Pull Next Count" at the same time**, the
system **swaps them into each other's aisle / makes them jump zones** instead of
keeping each associate working linearly down their current aisle. Org
`c9d89a74-7179-4033-93ea-56267cf42a17`, served by `rust-work-service`
(`claim_next_cycle_count` in `rust-work-service/src/db/queries.rs`). Diagnosis-only
pass — no code/migrations applied.

## Root cause (one mechanism, triple-confirmed)

**The claim takes no serializing lock at candidate-SELECTION time, and the
`FOR UPDATE SKIP LOCKED LIMIT 200` candidate scan hands two concurrent claimers
DISJOINT candidate windows offset by up to 200 serpentine positions. Because the
first one or two aisles at the queue head total fewer than 200 rows, the losing
racer's window starts in the *third* aisle, so the two workers are routed into
different (non-adjacent) aisles. Which racer "wins" the head rows is a coin-flip,
so ~50% of near-simultaneous claims trade the two workers' aisles.**

Step by step (Phase 2 of `claim_next_cycle_count`, lines ~361–542):

1. The claim runs in a plain `pool.begin()` transaction (READ COMMITTED). **There is
   no `pg_advisory_xact_lock` anywhere in the claim function** — the only advisory
   locks in the system are inside the zone-exclusivity *trigger*, which fires at
   `UPDATE`/commit time, **after** the candidate has already been chosen, so it
   cannot influence selection.
2. The candidate scan is `... ORDER BY priority, sticky, dedicated, unresolved,
   resolved_zone, resolved_aisle, resolved_sequence, location, created_at
   FOR UPDATE SKIP LOCKED LIMIT 200`. Worker A's scan acquires row-locks on the
   top 200 serpentine rows and holds them for the whole (millisecond-scale)
   transaction. Worker B's concurrent scan **SKIP-LOCKEDs all 200** and its first
   lockable row is serpentine **position 201**.
3. The two guards that are *supposed* to keep workers apart are blind under
   concurrency:
   - `get_occupied_aisles_tx` / `OCCUPIED_AISLES_SQL` computes occupancy from
     `worker_heartbeats` (`last_heartbeat >= NOW() - 5 min`) **joined to committed
     `rr_cyclecount_data.status = 'in_progress'`** rows. At the simultaneous-claim
     instant the other worker's brand-new claim is **uncommitted** (invisible under
     READ COMMITTED) **and** their heartbeat hasn't been rewritten yet, so the
     per-aisle cap (`max_counters_per_aisle = 1`) sees an empty/lagged picture and
     blocks nothing.
   - The Phase-2 zone pre-filter (`one_counter_per_zone`) is likewise driven by the
     other worker's `assigned_to`/`status`, which is uncommitted during the race.
4. So whichever transaction wins the row-lock race for the low (head) rows gets the
   head aisle; the other is shoved ~200 positions away into a different aisle.
   Because the winner is a coin-flip, when the head-aisle incumbent loses the race
   the two workers **swap** aisles.

The zone-exclusivity advisory lock (`pg_advisory_xact_lock('cyclecount_zone:<org>:<zone>')`
in `enforce_cycle_count_zone_exclusivity()`) does **not** save us: SKIP-LOCKED has
already handed the racers *different* aisles, so they grab *different* zone locks and
neither raises `ZONE_LOCKED`. Both claims **succeed** — into the wrong (swapped)
aisles. (If they *had* collided on the same zone, the loser's whole claim tx would
abort with `ZONE_LOCKED` (`P0001`) and the route would return an error / `None`, not a
row — which is not what the data shows.)

## Evidence (live, 2026-05-29 ~17:50 UTC)

### Config (the constraints, confirmed)
- `cycle_count_path_rules`: three active rules (zones **Shelves / Racks / Kardex**),
  all `strategy='serpentine_zone'`, `direction='ascending'`,
  **`max_counters_per_aisle = 1`** (Racks/Shelves `allow_unmapped_last`, Kardex
  `block_unmapped`).
- `cycle_count_zone_rules`: `policy='one_counter_per_zone'`, **`zone_pattern = NULL`**
  ⇒ the exclusivity "zone" = `split_part(location,'-',1)` = the **aisle prefix**
  (`SH`, `SI`, `SM`, …), and **`sticky_zone = false`**.

### Queue shape (why `LIMIT 200` crosses aisles)
- 4,601 pending; **4,510 in Shelves across only 12 aisles** (~375 bins/aisle);
  2 in_progress.
- Serpentine head of the live pending queue:

| aisle | serpentine positions | rows |
|-------|----------------------|------|
| SH | 1 – 111 | 111 |
| SI | 112 – 133 | 22 |
| SM | 134 – 330 | 197 |
| SN | 331 – 600 | 270 |

  ⇒ one `LIMIT 200` lock spans **three aisles (SH + SI + into SM)**. The loser's
  window starts at position 201 = **SM**, jumping clean past SH **and** the tiny
  22-row SI aisle (which gets stranded).

### Correlation (near-simultaneous ⇒ aisle switch)
Over the last 40 h / 1,508 between-count claims (`assigned_at` is the claim time):

| claim is within 3 s of another worker's claim | claims | aisle switches | switch rate |
|---|---|---|---|
| **no** (isolated) | 1,258 | 149 | **11.8 %** |
| **yes** (near-simultaneous) | 250 | 127 | **50.8 %** |

Near-simultaneous claims switch aisle **4.3× more often**.

### Swap signature (the coin-flip)
131 distinct near-simultaneous cross-worker claim *pairs* (≤3 s apart):
- **55 (42 %) clean aisle swaps** (`A: X→Y` while `B: Y→X`)
- **57 (44 %) both stayed linear** (race winner = head-aisle incumbent)
- remainder = 3-way / partial displacements

The ~50/50 split of "both-linear" vs "clean-swap" is the textbook signature of an
**unserialized race** for the queue head.

### Named instances
- `17:29:08` (gap **1.72 s**): **William Brewer SH→SM** (`SM-26-C-03`, `CC-20260519-4523`)
  while **Marvin Berry SM→SH** (`SH-21-B-02`, `CC-20260519-3990`) — perfect swap.
- `16:44:03` (gap **0.02 s**): **David Simmons SI→SN** (`SN-24-A-02`) while
  **William Brewer SN→SI** (`SI-28-C-01`).
- `16:39:54` (gap 1.87 s): **Erick Robinson SM→SI** / **William Brewer SI→SM**.
- `14:37:18` (gap 0.27 s): **William Brewer SM→SG** / **Marvin Berry SG→SM**.
- …14+ more in the same 40 h window, all the same `X↔Y` trade pattern.

### Heartbeat cadence / logs
- Active counters heartbeat every **~3–30 s** (`current_zone` = aisle prefix, e.g.
  William `SM`, Marvin `SH`). Occupancy detection lags the actual claim by at least
  this cadence **plus** the commit-visibility gap.
- Postgres logs (last 24 h): **no `ZONE_LOCKED`** events — consistent with "both
  racers succeed into swapped aisles" rather than one aborting.
- Aside: connection pressure is real — one `execute_sql` failed with
  `53300: remaining connection slots are reserved for SUPERUSER`; steady-state ~98
  connections (87 idle, 0 idle-in-tx). Not the root cause, but worth watching.

### Code facts
- Route `/claim` → `claim_next` → `claim_next_task` → (`cycle_count`) →
  `claim_next_cycle_count` **verbatim** (`api/routes/work.rs`). The queue *preview*
  reads the replica; the *claim* locks/updates on the primary inside the tx.
- No advisory/serialization lock in `claim_next_cycle_count` (full read of
  `db/queries.rs`).

## Railway log evidence (rust-work-service deploy logs, 2026-05-29)

Pulled after the user re-authenticated the Railway MCP. **Gotcha:** the service's
*latest* deployment `ecfcd99a` is **SKIPPED** (no container/logs); the actually-running
one is **`81783c80` (SUCCESS, up since 2026-05-24 14:18 UTC)** — logs must be queried
with that explicit `deployment_id`. The logs **corroborate and strengthen** the root
cause; nothing contradicts it.

1. **Both simultaneous claims are in the handler log at the exact event times, with
   matching `count_number`s:**
   - `16:44:05.185849Z` `User claimed task user_id=cbe23c27…(David Simmons)
     count_id=4fa6d2ff count_number=CC-20260519-4944` (his SN-24-A-02 jump)
   - `16:44:05.188500Z` `User claimed task user_id=e33287aa…(William Brewer)
     count_id=cf625e8c count_number=CC-20260519-4370` (his SI-28-C-01 jump)
     → the two claims complete **2.65 ms apart** — the SI↔SN swap, logged essentially
     simultaneously.
   - `17:29:08.478419Z` `User claimed task user_id=fb6e0266…(Marvin Berry)
     count_id=db2758cf count_number=CC-20260519-3990` (his SM→SH jump) — the 17:29
     swap. Confirms concurrent claim handling at human timescale.

2. **THE smoking gun — the Phase-2 candidate scan is slow (~1.01 s) and locks exactly
   200 rows.** Every pull-claim emits:
   `WARN claim_next_task{…}:claim_next_cycle_count{…}: sqlx::query: slow statement:
   execution time exceeded alert threshold` and the captured `db.statement` is the
   **`… FROM rr_cyclecount_data rcc … FOR UPDATE SKIP LOCKED LIMIT 200`** query
   (byte-for-byte the Phase-2 scan in `queries.rs`), with
   **`rows_affected=200 rows_returned=200 elapsed=1.012385067s slow_threshold=1s`**.
   This:
   - **Empirically confirms the 200-row lock footprint** (`rows_affected=200`).
   - **Quantifies the unserialized critical-section width at ~1 second.** Because the
     scan holds `FOR UPDATE SKIP LOCKED` on 200 rows for ~1 s, any two "Pull Next"
     presses within ~1 s **overlap inside the locked window** — so the SKIP-LOCKED
     displacement race is trivially hit at human timescales (not a microsecond fluke).
     This is the missing quantitative link explaining the bug's reproducibility, and
     it matches the ≤3 s correlation window (50.8 % switch rate).
   - The WARN fires on **essentially every pull-claim** all shift → the ~1 s race
     window is the steady state, not an outlier. (Scan is slow because it filters
     ~4.5 k pending rows through two correlated `NOT EXISTS` zone subqueries + two
     `cycle_count_zone_of()`-per-row `CASE` subqueries in the ORDER BY.)

3. **No `ZONE_LOCKED` anywhere in the service logs** (explicit search, 0 hits) →
   corroborates that simultaneous claims **succeed into swapped aisles** (SKIP-LOCKED
   displacement), and are **not** aborting on the zone-exclusivity trigger. Confirms
   the trigger-abort path is NOT the observed mechanism.

4. **Connection-pool pressure (compounding reliability risk).** `2× PoolTimedOut`
   from `sap_agents::get_fleet` at **16:46:03** and **16:47:50** — within ~2–3 min of
   the 16:44 swap — plus `2× HTTP 500` (`tower_http … response failed Status code:
   500 … latency=904 ms / 1171 ms`) at 18:20:02 (latency ≈ the ~1 s slow-scan
   duration). The ~1 s claim scans each hold a pooled connection **and** 200 row
   locks; under concurrent pull-claim load the sqlx pool starves. Consistent with the
   Supabase-side `53300: remaining connection slots reserved for SUPERUSER` hit during
   the original diagnosis. A serializing claim lock + a narrower/faster scan would
   also relieve this.

5. **WS broadcast lag (secondary).** Recurring
   `ws send loop lagged — dropped N broadcast events; receiver resynced`
   (`metric=work_ws_lagged_events_total`) for this org today: 1560 @12:58, 1071
   @14:01, five bursts up to 1370 @16:09, 769/768 @17:39. RF clients' live queue/zone
   state can momentarily desync during bursts — part of the concurrency-stress
   picture, not the swap cause.

6. **`PgListener` watchdog: 0 hits** — no listener wedge.

7. **Incidental, OUT OF SCOPE — flag separately:** a continuous ERROR stream
   `rust_work_service::triggers::evaluator: trigger_evaluator: bad NOTIFY payload
   (skipped) — Error("missing field \`row_id\`")` on `sap_agent_jobs` NOTIFY payloads
   (`{op, step, job_id, status, organization_id}` — no `row_id`). This is the **SAP
   agent-job pipeline**, unrelated to cycle-count claims, but it means the evaluator is
   dropping ~every `sap_agent_jobs` NOTIFY (likely tied to the in-progress omni-agent
   remediation / a payload-schema mismatch). Worth its own ticket.

**Net effect on confidence:** the Railway logs raise root-cause confidence from high to
**very high** — they directly show (a) the two racing claims at the exact timestamps,
(b) the 200-row, ~1 s `FOR UPDATE SKIP LOCKED` scan that defines the race window, and
(c) the absence of `ZONE_LOCKED` (so it's displacement, not abort). No new alternative
cause surfaced; the pool-timeout + WS-lag findings are compounding stressors, not
competing explanations.

## Hypotheses — ruled in / out

- **H1 — `max_counters_per_aisle=1` race + heartbeat-lagged occupancy: PARTIAL /
  contributing.** The occupancy/cap guard IS blind under concurrency (heartbeat
  freshness + committed-`in_progress` join can't see an in-flight claim) — confirmed
  real. But the cap is *not* what forces the jump; it's the guard that **fails to
  prevent** it. The observed thrash is a swap on the **same** claim (SKIP-LOCKED
  displacement), not the "cap kicks one out on the **next** claim" variant. (That
  next-claim variant *can* occur when a head aisle holds >200 pending rows so both
  windows stay inside it; today's data is displacement-dominated.)
- **H2 — advisory lock / isolation: CONFIRMED root contributor.** No claim-time
  serialization; two transactions race the candidate set under READ COMMITTED. The
  only advisory lock is in the trigger and fires too late to steer selection.
- **H3 — sticky-zone tiebreaker not firing: CONFIRMED.** `sticky_zone = false` makes
  the Phase-2 sticky `CASE` (queries.rs ~492–509) a dead no-op. Even if enabled, it
  keys on the worker *currently holding* an `in_progress`/`recount` row in the zone —
  which doesn't exist in the window *between* counts (the just-completed row is
  `completed`). Phase 2 has **no heartbeat-based stickiness at all** (only Phase 1
  does). Net: the new-claim path has **zero per-worker aisle stickiness**, so a
  displaced worker never self-corrects back toward their own aisle.
- **H4 — heartbeat staleness: CONFIRMED, secondary.** Occupancy lags the claim by the
  heartbeat cadence + commit gap, which is *why* the cap can't compensate — but the
  displacing mechanism is the SKIP-LOCKED window, not the staleness itself.

## Recommended fix direction (not applied)

Primary (addresses the root):
1. **Serialize claims at selection time.** Take a
   `pg_advisory_xact_lock(hashtextextended(format('cyclecount_claim:%s', org_id),0))`
   (per-org, or per meta-zone) at the **start of Phase 2, before** the candidate
   scan, so concurrent claims serialize and each one sees the prior claim's
   *committed* effect (its `assigned_to`/`status` and updated occupancy). Claims are
   ms-scale at floor throughput, so per-org serialization is acceptable; a
   per-meta-zone lock keeps cross-zone parallelism if needed.

Reinforcing:
2. **Detect in-flight claims by reservation/assignment, not heartbeat freshness.**
   With the claim serialized, occupancy/zone reads will see the committed prior
   claim; additionally consider folding `assigned_to IS NOT NULL AND status IN
   ('pending','in_progress','recount')` (and/or `reservation_started_at`) into
   occupancy so it never depends on a heartbeat write landing first.
3. **Add real Phase-2 per-worker aisle stickiness** keyed on the claiming worker's
   *current/last* aisle (`worker_heartbeats.current_zone`, or their most-recent
   completed `resolved_aisle` within N minutes), and turn on `sticky_zone` — so even
   if displaced, the worker prefers to continue their own aisle.
4. **Shrink the lock footprint of the candidate scan** (e.g. rank via a non-locking
   read, then `FOR UPDATE`/`UPDATE … WHERE assigned_to IS NULL` the single chosen row
   with retry-on-miss), so one claimer no longer locks 200 rows across three aisles
   for the duration of its transaction. Pair with the advisory lock so it stays
   race-free.

## Implementation (2026-05-29)

Server-side only (Rust + one data migration); no `supabase.channel(...)` added.

**Files / functions touched**
- `rust-work-service/src/db/queries.rs` (+190/−31): `claim_next_cycle_count`
  (Phase 2), new `get_sticky_aisle_tx`, rewritten `OCCUPIED_AISLES_SQL`, new pure
  `sticky_rank` helper, `#[cfg(test)] mod tests` (4 tests).
- `rust-work-service/src/db/models.rs` (1 line): `OccupiedAisle` doc comment.
- `supabase/migrations/332_enable_cycle_count_sticky_zone.sql` (new; applied).

**Fix 1 — serialize claims (the primary fix).** At the **start of Phase 2**, before
the occupancy read and the `FOR UPDATE SKIP LOCKED LIMIT 200` candidate scan:

```rust
sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
    .bind(format!("cyclecount_claim:{}", org_id))
    .execute(&mut *tx).await?;
```

- **Key:** `cyclecount_claim:<org_id>` (mirrors the trigger's `hashtextextended(text,0)`
  style). **Per-org**, not per-zone, because the target aisle isn't known until
  *after* selection — and for this org all counters share one meta-zone (Shelves),
  so per-meta-zone ≡ per-org anyway. Claims are sub-second–~1 s and floor claim
  rate is ~0.1–0.5/s, so serial per-org claiming is negligible queueing while it
  fully removes the SKIP-LOCKED displacement (the second claim now runs *after* the
  first commits and sees its assignment).
- **Lock-ordering rationale (deadlock-free):** the claim path acquires
  `cyclecount_claim:<org>` (outermost) → later, inside the `UPDATE … status=
  'in_progress'`, the zone-exclusivity trigger acquires `cyclecount_zone:<org>:<zone>`.
  So the order is always **claim-lock → zone-lock**. No other path acquires them in
  reverse: the trigger fires on push / reclaim / escalation / RPC writes too, but
  **none of those take the claim lock** — only Phase 2 does. With no path taking
  zone-lock → claim-lock, there is no lock-ordering cycle, hence no deadlock. Both
  are `pg_advisory_xact_lock` (released on COMMIT/ROLLBACK), so nothing leaks across
  transactions. Blocking (not `try_`) is intentional — serialization is the goal.

**Fix 2 — in-flight detection off assignment state.** `OCCUPIED_AISLES_SQL` no longer
joins `worker_heartbeats` / gates on `last_heartbeat >= NOW()-5min`. It now counts
`COUNT(DISTINCT cc.assigned_to)` per `resolved_aisle` directly from
`rr_cyclecount_data` where `assigned_to IS NOT NULL AND assigned_to <> caller AND
status IN ('in_progress','recount')`. A just-claimed aisle (claim sets
`status='in_progress'`, committed before the next claim under Fix 1's lock) is now
visible to the per-aisle cap **immediately** — no 3–30 s heartbeat lag — and the cap
is consistent with the (heartbeat-free) zone pre-filter and trigger. Offline-worker
staleness is handled by the existing abandonment/escalation reclaim (it nulls
`assigned_to`), same as the zone pre-filter already relies on.

**Fix 3 — real Phase-2 aisle stickiness.** The old sticky `CASE` was doubly dead:
gated on `sticky_zone=false` *and* keyed on a HELD `in_progress` row that never
exists in the between-counts claim gap. Replaced with:
- `get_sticky_aisle_tx` computes the worker's current aisle = most-recent (≤30 min)
  assigned/completed row's `resolved_aisle`, falling back to live
  `worker_heartbeats.current_zone`; returns `None` unless `sticky_zone=true`.
- The candidate SQL sticky `CASE` is now `CASE WHEN $3 IS NOT NULL AND
  rcc.resolved_aisle = $3 THEN 0 ELSE 1 END` (`$3` = sticky aisle) — floats the
  worker's aisle into the locked window.
- **Critical:** the Rust `sort_by` (which is the source of truth for the final pick
  and previously had NO stickiness, so it overrode the SQL ordering) now applies the
  same `sticky_rank` tiebreaker right after priority. Without this the global
  `resolved_aisle` sort would still pull the worker to the lowest aisle.
- **Config choice:** kept the `cycle_count_zone_rules.sticky_zone` gate (so stickiness
  stays an opt-out for orgs wanting pure global serpentine / cross-aisle balancing)
  and **enabled it for this org via migration 332** rather than making it
  unconditional. Heartbeat lag is acceptable here because stickiness is a SOFT
  preference; the hard don't-double-occupy guards are all assignment-state based.

**Fix 4 (LIMIT 200) — deliberately NOT changed.** With Fix 1 holding the per-org
claim lock, `SKIP LOCKED` skips nothing (no concurrent claim holds row locks), so the
200-row window no longer causes displacement. Shrinking `LIMIT 200` would risk
regressing migration 252 (critical rows sorting late must stay in-window), so it was
left as-is — surgical. The slow ~1 s scan persists but is now harmless to routing;
a future perf pass could trim the per-row `cycle_count_zone_of` subqueries.

**Migration applied:** `332_enable_cycle_count_sticky_zone.sql` →
`UPDATE cycle_count_zone_rules SET sticky_zone=true WHERE organization_id=
'c9d89a74…'` (idempotent). Applied via Supabase MCP `apply_migration`; verified
`sticky_zone=true`. Mirrored as a committed `.sql` file.

**Build / test:** `cargo build` green (19.5 s; only pre-existing dead-code warnings in
`observability/middleware.rs`). `cargo test --bin rust-work-service db::queries::tests`
→ **4 passed** (`priority_rank_orders_buckets`, `sticky_rank_prefers_worker_current_aisle`,
`sticky_rank_is_noop_without_sticky_aisle`, `sticky_rank_sorts_worker_aisle_first`).
The `tests/` integration files (`zone_exclusivity_*`, `zone_assignment_dedicated`,
`ws_*`) are `#[ignore]`'d scaffolds requiring a DB harness — they compile clean and
don't assert the changed internals; `claim_next_cycle_count`'s public signature is
unchanged.

**NOT deployed (human-confirm step).** Exact command, from a shell linked to the
project (`railway status` → Project `onebox-ai-logistics`, Env `production`, Service
`rust-work-service`):

```bash
cd rust-work-service
railway up --service rust-work-service --environment production
```

(Builds the new image from the service Dockerfile and deploys it. Migration 332 is
already live in the DB, so it can ship before or with the code — the code reads
`sticky_zone` defensively, and Fixes 1–2 work regardless of the flag.)

## Constraints honoured / noted
- **Diagnosis only** — no migrations applied, no code edited, no Railway deploy. All
  Supabase access was read-only (`SELECT`/`pg_get_functiondef`/logs/advisors).
- **Master Rule realtime hard-ban is NOT implicated:** the fix is server-side (Rust
  claim tx + config + optional SQL fn tweak) and touches **no** `supabase.channel(...)`.
  If a future fix broadcasts claim/zone changes, it must route through `workServiceWs`
  or polling, never a new Supabase Realtime channel.
- **Railway logs:** initially `Unauthorized` (MCP credential expiry); after the user
  re-authenticated, the `rust-work-service` deploy logs were pulled and added above
  (see "Railway log evidence"). Note the running deployment is `81783c80`, not the
  SKIPPED "latest" `ecfcd99a`. Postgres-side logs via Supabase were also checked and
  agree (no `ZONE_LOCKED`).

## Related
- [[Fix-Cycle-Count-Resolve-FOUND-Check-2026-05-20]] — migration 323 made
  `resolved_zone/aisle/sequence` ~100% populated, which is what *re-enabled* the
  serpentine ORDER BY this bug now races on (pre-323 every row was `unresolved`, so
  the queue collapsed to location-sort and the SKIP-LOCKED window stayed roughly
  contiguous).
- [[Investigate-Cycle-Count-Paths-2026-05-20]] — walking-path analysis (per-counter
  linearity %, serpentine self-routing); same `assigned_at`-timeline methodology.
- [[Cycle-Count-Bug-Fix-Pass-2026-05-01]] / [[Cycle-Count-Final-Hardening-Pass-2026-05-01]]
  — migrations 252/253 (priority-first ordering, Phase-1 pattern-aware collision
  filter, sticky-zone/heartbeat tiebreakers referenced in the ORDER BY comments).
- [[Fix-RF-Cycle-Count-Zone-Soft-Reservation-Cascade-2026-05-18]] — zone-exclusivity
  trigger + `ClaimBlockedByZone` canary context.
- [[Components/Rust-Work-Service]] — `claim_next_cycle_count`, `get_occupied_aisles_tx`,
  `OCCUPIED_AISLES_SQL`.
- Code: `rust-work-service/src/db/queries.rs` (claim ~217–813; occupancy
  ~1505–1519; ORDER BY ~299–340, 478–530); `enforce_cycle_count_zone_exclusivity()`,
  `resolve_cycle_count_location()` (Supabase fn defs).
