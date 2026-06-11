---
tags: [type/decision, status/proposed, domain/backend, domain/database, domain/infra]
created: 2026-05-14
---

# ADR — Flip rust-work-service general pool from Supavisor session-mode to transaction-mode

## Status / Date / Owner

- **Status: Proposed (drafted 2026-05-14).** This ADR captures the decision space; nothing has been committed.
- **Owner:** unassigned (proposed).
- **Triggered by:** the two 2026-05-14 deploy-time crash-loops on
  `(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 16`
  (one per pool — see [[Fix-RF-Cycle-Count-Stuck-Waiting]] PM section
  for the general pool, [[Fix-Trigger-Evaluator-Empty-After-v041-Restart]]
  "Deploy attempt v0.1.42 — FAILED" for the listener pool).

## Note-worthy finding (read this BEFORE the rest)

The day's debug notes implied that a tx-mode flip's main cost is
"refactor every `work_engine.flag_overrides` setter to per-tx GUC
injection". After auditing the code, the actual scope of that refactor
is **smaller** than the notes implied — but it is **not** the binding
blocker:

- `work_engine.flag_overrides` is **set** in exactly **one Rust callsite**:
  the `after_connect` hook in
  `rust-work-service/src/db/pool_setup.rs::pool_options_with_hooks`
  (~line 219). That hook runs `SELECT set_config('work_engine.flag_overrides', $1, false)`
  on every new pool connection.
- It is **read** by exactly **one plpgsql function**,
  `public.work_engine_feature_flag(p_org uuid, p_key text)` (defined in
  migration 256, extended in migration 262 to add the GUC layer).
- That helper is called from PL/pgSQL **trigger functions** on a small
  set of tables (migrations 257, 265 — projection-side triggers on
  `rr_cyclecount_data` + `inventory_found_parts` writes). Triggers run
  inside the originating write's transaction, so they do see GUCs set
  with `SET LOCAL` inside the same transaction.
- When the GUC is empty / unset, `work_engine_feature_flag` falls
  through to per-org `work_engine_settings.feature_flags` and finally
  the hardcoded default. **Loss of the GUC degrades gracefully** — it
  silences the operator-emergency-override layer (Layer 1 of three),
  but does not break flag evaluation. Migration 262's header comment
  states this explicitly: "Without [the GUC] the GUC is empty and
  evaluation falls through to the per-org/default layers (back-compat)".
- All other `set_config(...)` calls in the migration tree use
  `is_local = true` (per-transaction) — `app.skip_sync`,
  `app.work_zone_lock_bypass`, `app.cycle_count_zone_lock_bypass`. Those
  are already transaction-mode safe.
- FastAPI (`api/`) does **not** use the GUC pattern at all — Grep for
  `set_config` / `current_setting` returns zero matches under `api/`.
  Tenant context on the FastAPI side flows through the Supabase JWT
  via PostgREST, not a session GUC.

So the GUC blast radius for a tx-mode flip is "the env-override layer
of feature flags becomes ineffective until each callsite reinstates the
GUC at tx-start". That's a real but bounded cost.

**The actual binding blocker for tx-mode is unrelated to the GUC** —
see Forces #5 below and [[Fix-Sqlx-Supavisor-Txn-Pool-Prepared-Statement-Collision]].

## Context

`rust-work-service`'s general PostgreSQL pool currently routes through
Supavisor in **session mode** (port 5432) per
[[Implement-Rust-Work-Service-PgBouncer-Pooler]] § "2026-05-07 hotfix".
Per the AM v0.1.41 boot logs, the upstream ceiling is
`pool_size = 16`. The listener pool also currently flows through the
same Supavisor endpoint (the `DATABASE_URL` env var resolves to a
`*.pooler.supabase.com` host on this project today, despite the
in-tree comments that historically described it as "direct"). Both
pools are now lazy as of 2026-05-14:

- General pool went lazy in v0.1.41 (AM session) — see the
  `build_pool_with_flag_overrides_named_lazy` helper in
  `rust-work-service/src/db/pool_setup.rs`. Crash class CLOSED for
  the general pool.
- Listener pool went lazy in v0.1.42-followup (PM session). Crash
  class CLOSED for the listener pool too.

What remains after the two lazy-pool fixes:

- Both pools start with no upstream connections; `connect_lazy_with`
  defers the first acquire to first use.
- During a rolling deploy, the OLD container still holds a share of
  Supavisor's 16 session-mode slots; the NEW container's first HTTP
  request will block on `acquire_timeout` (10 s) until the OLD
  container drains. This produces a brief 5xx window (~7 s observed
  on the v0.1.42 deploy at 16:33:27Z–16:33:35Z; bounded and
  self-clearing). Documented as the "lazy-pool pattern's documented
  trade-off" in [[Sessions/2026-05-14]].
- Three of the 13 LISTEN tasks fall back to the
  [[Implement-Resilient-PgListener]] reconnect loop during the same
  window and re-subscribe within ~7 s once slots free up. Operationally
  invisible.

The deferred long-term option is to **flip the general pool's pooler
URL to transaction-mode (port 6543)**, which would lift the
`pool_size = 16` ceiling entirely.

## Forces

1. **Deploy resilience.** Today's lazy-pool fix closed the crash class
   but a brief 5xx window remains during rolling deploys. Removing the
   pool_size ceiling removes the contention shape entirely.
2. **Tenant flag-injection correctness.** `work_engine.flag_overrides`
   must reach the projection-trigger reads in migrations 257 / 265 for
   the operator-override layer to remain effective.
3. **Connection efficiency / cost.** Transaction mode multiplexes many
   client connections onto a smaller upstream pool (per
   [[Implement-Rust-Work-Service-PgBouncer-Pooler]], the original
   target was ~3–6 freed direct slots back to `pg_cron`).
4. **Operational complexity.** Two pool modes (session for listener +
   tx for general) is more state to monitor than one mode.
5. **sqlx 0.7 + Supavisor txn-pool is fundamentally incompatible.**
   This is the binding blocker. sqlx 0.7 hardcodes named prepared
   statements `sqlx_s_<n>` from a per-CLIENT-connection counter.
   Supavisor txn-pool multiplexes client connections onto a smaller
   upstream pool, swapping upstreams at COMMIT/ROLLBACK boundaries —
   two app connections that share the same upstream backend
   deterministically collide on `sqlx_s_1`, `sqlx_s_2`, …. **Already
   proven in production**: the 2026-05-07 attempt to set
   `WORK_SERVICE_DATABASE_POOLER_URL` to port 6543 caused 25 minutes
   of universal 5xx (`42P05 prepared statement "sqlx_s_17" already exists`,
   `26000 ... does not exist`, `08P01 bind message ...`). Rolled back
   to session mode (port 5432) and stayed there. Documented in
   [[Fix-Sqlx-Supavisor-Txn-Pool-Prepared-Statement-Collision]].
   `statement-cache-capacity=0` does NOT fix this — verified against
   sqlx-postgres-0.7.4's `prepare()` source.
6. **The pool_size = 16 ceiling is a Supavisor configuration, not a
   Postgres limit.** Whether it's raise-able depends on the project's
   Supabase tier and may be tied to plan upgrades. We have not
   verified the cost or limits ([[ADR-Capacity-Ceiling-2k-Users]] §
   "Honest uncertainties" notes the tier is inferred-Pro-Small but
   unconfirmed).
7. **The deploy-time pool race is NOT today's binding capacity wall.**
   [[ADR-Capacity-Ceiling-2k-Users]] documents that the next user-volume
   wall is FastAPI's single-worker uvicorn (now lifted to
   `WEB_CONCURRENCY=4`) and Supabase Realtime presence shard pressure
   (now drained by `VITE_PRESENCE_MODE=rust`), NOT Postgres
   connection slots. The 16-slot Supavisor ceiling only binds during
   **rolling-deploy overlap** (NEW + OLD container both holding
   slots simultaneously).

## Options Considered

### Option 1 — Status quo: session-mode + lazy pools (already shipped today)

- **Pros:**
  - Already live in v0.1.42. Both crash classes CLOSED.
  - No code change. No dependency upgrade. No migration. No risk.
  - `work_engine.flag_overrides` GUC continues to work via the
    existing `after_connect` hook.
  - Listener pool's LISTEN/NOTIFY semantics preserved (session-mode
    is LISTEN-safe; tx-mode would break LISTEN — see
    [[Implement-Rust-Work-Service-PgBouncer-Pooler]] § Caveat).
- **Cons:**
  - ~7 s 5xx window during rolling deploys. Bounded, self-clearing,
    documented; routes that hit the pool during the window get HTTP
    5xx and clients retry.
  - Steady-state Supavisor `pool_size = 16` is tight when the general
    pool (max 20) + listener pool (max 30) + a brief OLD-container
    overlap all want slots simultaneously. Capacity headroom is
    asymmetric: today, peak observed listener footprint is ~22, peak
    observed general footprint is single-digit — so 16 is "tight at
    deploy time", "comfortable in steady state".
  - Original 2026-05-07 audit goal of "free ~3–6 direct slots back to
    pg_cron via tx-mode multiplexing" remains unrealised.
- **Effort:** zero.

### Option 2 — Flip to transaction-mode (port 6543) + per-tx GUC injection

- **Pros:**
  - Lifts the `pool_size = 16` ceiling entirely. Rolling deploys no
    longer race for upstream slots; the 5xx window collapses.
  - Reclaims the multiplexing benefit Item 4 of the 2026-05-07
    audit was originally targeting.
- **Cons (the deal-breaker class):**
  - **Blocked on sqlx 0.7's named-prepared-statement collision class.**
    Cannot ship a tx-mode pool against Supavisor without ALSO
    addressing this. Two viable unblockers, both non-trivial:
    1. Upgrade sqlx 0.7 → sqlx 0.8+ and call
       `PgConnectOptions::no_statement_cache()` — sqlx 0.8 emits
       unnamed prepared statements that are scoped to a single
       Bind/Execute cycle and clear at end-of-transaction. Migrating
       sqlx is a cross-cutting change for `rust-work-service`,
       `rust-core-service`, and any other sqlx consumer (Cargo
       `0.7` → `0.8`, plus follow-up API churn — `Executor` trait
       changes, `query_as!` row-binding changes, and the
       `PgPoolOptions` API surface evolved). Not a 1-PR change.
    2. Replace Supavisor with **pgcat** (rewrites named-statement
       names per upstream) or **pgbouncer-rs** (1.23+
       `replace_query_text=true`). New infra surface, new
       deployment to operate, new failure modes. Out-of-band of
       the Supabase-owned Supavisor.
- **Cons (the GUC class — bounded, but real):**
  - Once unblocked, `work_engine.flag_overrides` no longer survives
    across queries. Either:
    - **(a) Per-tx `SET LOCAL` injection** at every callsite that does
      a write to a `work_engine_feature_flag`-checking table. Every
      INSERT/UPDATE on `rr_cyclecount_data` /
      `inventory_found_parts` would need to wrap in an explicit
      transaction with a `SET LOCAL work_engine.flag_overrides = '...'`
      preamble. The audit surface is small (the trigger fires inside
      the writer's tx; SQL-level callsites are concentrated in the
      shadow-write paths) but the chain crosses both rust-work-service
      and any FastAPI/edge-function path that writes the same tables.
    - **(b) sqlx executor wrapper** that prepends the SET LOCAL to
      every statement. Cleaner than (a) but also complicates
      observability (every query carries an extra round-trip's worth
      of work). Cost per statement: 1 extra round-trip OR 1 extra SQL
      statement in the same Pipeline frame.
    - **(c) Move env-override out of the GUC entirely** — Redis-cached
      `(organization_id, key) → boolean` table read in Rust before
      every flag check. Substantial refactor of
      `work_engine_feature_flag` itself + every reader; effectively
      a re-architecture of feature-flag layering.
  - Listener pool MUST stay on session-mode (or direct) regardless —
    sqlx `PgListener` against tx-mode receives no frames at all
    (session affinity required). Confirmed in
    [[Implement-Rust-Work-Service-PgBouncer-Pooler]] § Caveat.
- **Effort:** high. sqlx upgrade or pooler swap (~1–2 weeks, plus
  staging soak), then GUC-injection mechanism (~3–5 days), then
  staging validation against tx-mode endpoint, then production roll-out
  with breakglass back to session-mode if either unblocker has a tail.
  Multi-week project, not a 1-line env-var flip.

### Option 3 — Hybrid: session-mode pool for flag-overrides code paths, tx-mode pool for read-mostly hot paths

- **Pros:**
  - Side-steps the GUC-injection refactor for routes that need
    `work_engine.flag_overrides`.
- **Cons:**
  - **STILL blocked on Force #5**. The sqlx 0.7 prepared-statement
    collision applies to ANY pool routed through tx-mode regardless
    of whether it sets the GUC. The hybrid doesn't sidestep the real
    blocker.
  - Routing complexity. Every route handler must pick the right pool.
    Easy to regress (a write that should have been on the
    flag-overrides pool ends up on the read-mostly pool).
  - Two pools to monitor (general session, general tx, listener
    session) — three pools total. Operational state grows.
- **Effort:** high. Same sqlx-or-pooler unblocker as Option 2,
  plus per-route pool selection refactor.

### Option 4 — Bump session-mode `pool_size` higher (Supavisor tier upgrade or per-project quota request)

- **Pros:**
  - Operationally simplest. No code change. No dependency change.
  - Preserves all existing session-mode invariants (LISTEN safety,
    GUC survival, sqlx 0.7 compatibility).
  - Buys runway: 16 → 32 doubles the deploy-overlap headroom; 16 →
    64 effectively retires the issue at our current concurrency.
- **Cons:**
  - Doesn't remove the deploy-overlap class — just raises the
    ceiling. A future feature that doubles per-container connection
    count rolls the dice again.
  - Cost: depends on Supabase tier. We have not verified what tier
    we're on or what the upgrade costs.
  - Requires a Supabase ops change (config tweak or tier upgrade)
    that's external to the codebase.
- **Effort:** low. File a Supabase ticket; possibly upgrade tier.

## Recommendation

**Stay on Option 1 (status quo) for now. Treat Option 4 as cheap
insurance if Supabase makes the bump easy. Defer Option 2 to a
multi-quarter project tracked behind a sqlx 0.7 → 0.8 upgrade.**

Rationale:

- The deploy-crash class is CLOSED. The residual ~7 s 5xx window
  during rolling deploys is **bounded, organic, observable, and
  operationally acceptable** at our current deploy frequency
  (typically 1–3 deploys/day during active work, far less during
  steady-state). The class is also fully documented; an SRE looking
  at a 5xx blip during a deploy window has a clear narrative.
- Option 2's migration cost is dominated by the sqlx 0.7
  incompatibility, NOT the GUC refactor. The GUC refactor is real
  but bounded (single setter, single SQL helper, ~4 trigger callers
  in migrations 257 / 265). The sqlx work is the real budget item.
  An sqlx 0.7 → 0.8 upgrade is a project we'd undertake for many
  reasons besides this one (e.g. better error types, async iterators,
  improved time/uuid mapping); when that upgrade lands for unrelated
  reasons, this ADR's recommendation flips.
- Option 4 is genuinely cheap if Supavisor's per-tenant pool_size is
  raise-able on our current tier. Worth filing the ask before
  spending an engineer on Option 2.
- The current binding capacity wall at our user volumes is NOT
  Postgres slots ([[ADR-Capacity-Ceiling-2k-Users]] confirms this).
  Spending a multi-quarter budget on the pool_size=16 ceiling buys
  us nothing while real walls (FastAPI workers, Realtime sockets)
  are the load-bearing constraints.

## Migration plan (if Option 2 is chosen later)

In order:

1. **Audit + cite every `work_engine.flag_overrides` callsite.** Currently
   one Rust setter (`pool_setup.rs::pool_options_with_hooks::after_connect`)
   and the SQL helper `work_engine_feature_flag(uuid, text)` called from
   trigger functions in migrations 257 + 265. Decide whether the
   refactor lives at: (a) per-tx `SET LOCAL` at writer callsites,
   (b) sqlx executor wrapper, or (c) Redis-cached flag table replacing
   the GUC layer entirely.
2. **Pick the sqlx unblocker.** Either bump sqlx 0.7 → 0.8 across
   `rust-work-service`, `rust-core-service`, and any other sqlx
   consumer (and call `PgConnectOptions::no_statement_cache()` on
   the new tx-mode pool); OR swap Supavisor for pgcat / pgbouncer-rs.
   Decide based on team appetite and Supabase ops constraints. The
   sqlx route is in-tree; the pooler-swap route involves Railway +
   Supabase ops changes.
3. **Set sqlx `statement_cache_capacity = 0`** on the tx-mode pool
   (only meaningful with sqlx 0.8 + `no_statement_cache()`; ignored on
   sqlx 0.7).
4. **Test in staging against the tx-mode endpoint.** Soak ≥ 24 h
   covering at least one full rolling-deploy cycle. Watch for
   `42P05` / `26000` / `08P01` errors; verify no regression on the
   GUC-dependent flag paths; verify Lagged-event metric stays at
   baseline.
5. **Flip env var `WORK_SERVICE_DATABASE_POOLER_URL`** from `:5432` to
   `:6543` (with `?pgbouncer=true`).
6. **Roll out + monitor** for 2 weeks. Breakglass: revert env var to
   `:5432`. Document the breakglass timeline in the new ADR that
   would supersede this one.

The listener pool stays on session-mode (or moves to direct
`DATABASE_URL` if/when the project's `DATABASE_URL` is repointed at
the project's pre-pooler host) regardless of what happens to the
general pool — LISTEN/NOTIFY is incompatible with tx-mode pooling.

## Decision triggers

Re-evaluate this ADR when ANY of the following becomes true:

1. **Rolling-deploy 5xx window observed > ~30 s sustained** on a
   single deploy (today's baseline is ~7 s and self-clearing). Use
   the existing `work_http_requests_total{status="5xx"}` per-deploy
   diff as the signal.
2. **Steady-state general-pool acquire wait** > 1 s p99 over a
   1-hour window (proxy: a new metric on `pool.acquire().await`
   latency we don't have today — file as a follow-up if the deploy
   concern grows).
3. **Concurrent worker count** crosses where 16 connections become
   contended in steady state. Today: peak general-pool footprint is
   single-digit; threshold is "general pool near max=20 sustained",
   which would mean a roughly 4× growth in concurrent HTTP load.
4. **An sqlx 0.7 → 0.8 upgrade lands for unrelated reasons.** That
   removes Force #5's blocker; Option 2 becomes a 1-week project
   instead of multi-quarter.
5. **Supabase exposes a per-project pool_size raise** that doesn't
   require a tier upgrade. Option 4 becomes free.
6. **Customer SLA on availability tightens** to where the residual
   ~7 s 5xx blip during rolling deploys is unacceptable.

## Open questions

1. What Supabase tier are we on, and is `pool_size` raise-able on it?
   ([[ADR-Capacity-Ceiling-2k-Users]] § "Honest uncertainties" still
   has this open as of 2026-05-11.)
2. What does a Supabase tier upgrade cost for this project? (Pro →
   Team is the canonical step; pricing varies.)
3. Is there team appetite for a sqlx 0.7 → 0.8 upgrade as a separate
   workstream — even without the tx-mode flip motivation? An audit of
   sqlx 0.8's API churn against our actual `query_as!` / `Executor`
   usage would size that work.
4. Does Supabase have a roadmap to raise or remove the per-tenant
   session-mode `pool_size` ceiling? (The constraint exists for fair
   resource sharing across multi-tenant Supavisor; it's not a
   fundamental Postgres limit.)
5. Should the listener pool be moved off Supavisor entirely and onto
   the project's pre-pooler host (the historical "DIRECT URL" the
   in-tree comments still describe)? That would isolate
   LISTEN/NOTIFY from any future Supavisor changes regardless of the
   general-pool decision.

## Related

- [[Fix-RF-Cycle-Count-Stuck-Waiting]] — AM lazy-pool fix (general pool)
  + James-Dearman PM deep-dive showing the failed-deploy class.
- [[Fix-Trigger-Evaluator-Empty-After-v041-Restart]] — PM lazy-pool
  fix (listener pool) + bounded-retry hardening for the Phase 9
  trigger loader.
- [[Sessions/2026-05-14]] — full timeline of both incidents and both
  deploys (v0.1.40 → v0.1.41 → v0.1.42).
- [[Implement-Rust-Work-Service-PgBouncer-Pooler]] — the 2026-05-07
  dual-pool routing implementation + the post-incident hotfix that
  forced session-mode (the "use port 5432" rule this ADR considers
  reversing).
- [[Fix-Sqlx-Supavisor-Txn-Pool-Prepared-Statement-Collision]] — the
  2026-05-07 production incident this ADR's Force #5 cites verbatim.
- [[Implement-Resilient-PgListener]] — the LISTEN-pool reconnect
  pattern that absorbs the lazy-pool deploy window today.
- [[ADR-Capacity-Ceiling-2k-Users]] — the strategic context for why
  pool_size = 16 is NOT today's binding capacity wall.
- [[ADR-Broadcast-Channel-Sizing]] — sibling "act on data, not
  speculation" ADR; same posture.
- [[ADR-Trigger-DSL-Evaluator-Phase9]] — Phase 9 ADR for the trigger
  loader hardened by the PM v0.1.42 fix.
- [[ADR-Presence-Architecture-Next-Steps]] — sibling ADR; informs
  the "binding capacity wall" framing in Forces #7.
- `supabase/migrations/262_work_engine_feature_flag_env_layer.sql` —
  the SQL helper that reads the GUC.
- `rust-work-service/src/db/pool_setup.rs` — the single Rust setter
  for the GUC; both the eager and lazy variants of
  `build_pool_with_flag_overrides_named` route through the same
  `pool_options_with_hooks` `after_connect` hook.
- `rust-work-service/src/main.rs` — the call sites for both pools
  (general + listener), both now lazy as of 2026-05-14.
