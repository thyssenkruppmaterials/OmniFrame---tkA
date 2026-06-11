---
tags: [type/debug, status/active, domain/backend, domain/database, domain/agent]
created: 2026-05-28
---
# Fix — 29 Putaway Confirms Stuck on the SAP GUI 619 Layout Race + Bad-Warehouse Data

## Symptom

Inbound Apps → Putaway Log Search showed **"Pending Confirms: 29 TOs awaiting confirmation"** (`Pending TO Confirm` pill) for org `c9d89a74-7179-4033-93ea-56267cf42a17`, while the rest of the recent log showed `Omni Agent` auto-confirming within seconds. The auto-confirm pipeline was healthy (all 4 `USINDPR-CXA102V-W1..W4` workers online, `trigger_evaluator: fired` every few seconds), but 29 rows were wedged.

UI count source: `PutawayLogService` → `rf_putaway_operations WHERE to_status='Completed' AND is_mca_workflow<>true AND confirmed_source IS NULL AND created_at >= 2026-01-01`.

## Root cause (two buckets)

### Bucket 1 — SAP GUI 619 layout race (27 rows)

All 27 were created 2026-05-27 12:21–14:49 UTC and every one's `sap_agent_jobs` row FAILED with the same transient COM error raised by `sess.findById(...)`:

```
(-2147352567, 'Exception occurred.', (619, 'SAP Frontend Server',
  'The control could not be found by id.',
  'C:\\Program Files (x86)\\SAP\\FrontEnd\\SAPgui\\sapfront.HLP', 393215, 0), None)
```

The SAP GUI screen was mid-transition under fleet load (4 workers hammering one pinned session). `sap_audit_log` for the burst window: **17 success / 44 of these 619 failures** on the SAME idempotent LT12 code path — i.e. intermittent timing race, not a deterministic break. They wedged permanently because:

- The trigger evaluator (`rust-work-service::triggers::evaluator::fire_trigger`) INSERTs `sap_agent_jobs` WITHOUT `max_attempts`, so each row inherited the table default of **1** (migration 245). One transient blip = one burned attempt = terminal `status='failed'`.
- The backfill re-queue loop (migration 289 / `backfill_pending_putaway_confirms`) only re-fires `failed` confirm jobs within a 24h lookback. Once the rows aged past 24h they stopped being retried.

### Bucket 2 — bad-warehouse data (2 rows)

- TO **7292240**, `warehouse='-03'`, Roger Rojas, location `RO-60-B-03` — SAP rejected with `Entry -03   does not exist in T300 (check entry)`. The `-03` is the **truncated trailing segment** of the location string `RO-60-B-03` (RF scan captured the wrong token).
- TO **7292943**, `warehouse='H5N'`, Nikki Mason, location `RN-55-A-01` — SAP rejected with `Entry H5N   does not exist in T300`. `H5N` is a garbled `WH5`.

(The H5N row initially bucketed as a layout-race during investigation because its *latest* job at the time carried the 619 error; the underlying bad-warehouse error only surfaced on the first re-enqueue.)

## Fix (3 workstreams, 2026-05-28)

### Fix 1 — Re-enqueue the 27 layout-race rows (Supabase write)

`UPDATE rf_putaway_operations SET updated_at = now()` scoped to the exact 27 `id`s (NOT a blanket `status` filter — that would also touch the bad-data rows). The migration-276 NOTIFY re-enters the trigger evaluator, which INSERTs a fresh `sap_agent_jobs` row. The idempotency key `trig:<rule>:<row_id>:<unix_day>` rolled from yesterday's `:20600` to today's `:20601`, so no `ON CONFLICT` collision on the FIRST bump. **23 of 27 flipped to `TO Confirmed` within ~minutes.**

**Known limitation hit (documented in [[Fix-Putaway-Confirms-Stuck-At-41]] — "per-attempt idempotency keys" follow-up):** a SECOND same-day `updated_at` bump is a no-op, because the failed job from the first bump already holds the `:20601` key → `ON CONFLICT DO NOTHING`. The 4 rows that failed again on the first bump (3 transient + the H5N row) therefore could not be re-fired again the same day; they need a next-day bump (their next jobs will inherit `max_attempts=3`).

### Fix 2a — `max_attempts=3` for `/sap/confirm-to` jobs (migration 331)

`supabase/migrations/331_confirm_to_jobs_max_attempts.sql` — a `BEFORE INSERT` trigger `trg_set_confirm_to_max_attempts` on `sap_agent_jobs` that raises `max_attempts` to 3 for `endpoint='/sap/confirm-to'` ONLY (never lowers a higher explicit value). Endpoint-scoped on purpose: a global default bump would let long-running LT10 jobs whose lease lapses re-fire up to N times — the exact phantom-multi-execution regression migration 291 was written to bound. Confirm-TO is idempotent (already-confirmed branch), so the larger budget is safe; migration 291's `watchdog_max_attempts` sweep still caps the total. **Verified live:** the post-migration confirm-to job `415e28fc` (TO 7292240) carried `max_attempts=3`.

### Fix 2b — classify the 619 as transient/retryable in the agent

`omni_agent/agent.py`:
- New pure classifier `_is_retryable_sap_error(err_text)` — terminal markers (`does not exist in t300`, `does not exist`, `no authorization`, `does not belong`, `is locked`) checked FIRST and win over transient markers (`control could not be found by id` / `control could not be found`).
- `confirm_transfer_order`'s outer `except` now tags a transient failure `{retryable: True, step: 'sap_layout_race'}`.
- The job poller `_claim_and_dispatch_one` leaves a `retryable` job **'running'** (instead of marking it failed) when `attempts < max_attempts`, so the migration-291 lease-expiry re-claim retries it (bounded by max_attempts). Active-job state is cleared in the `finally`, so the in-agent watchdog won't kill it and the heartbeat stops bumping the lease → lease expires → re-claim.
- Test: `omni_agent/tests/test_confirm_to_retryable_error.py` (12 cases; 619 → retryable, T300 `-03`/`H5N` → terminal, terminal-wins-over-transient, empty/success → False). Mirrors the established graceful-skip-on-3.9-import convention.
- **Requires an agent EXE rebuild to take effect in production** (workspace-only change; no rebuild/rsync done here).

### Fix 3 — correct the bad-warehouse rows

Both `-03` and `H5N` corrected to **`WH5`** with high confidence:
- Historical bin→warehouse: `RO-60-B-03` → WH5 (19/19 prior putaways), `RN-55-A-01` → WH5 (12/12). Unanimous.
- TO numbers `7292240` / `7292943` are in the `729xxxx` range — every same-day successful confirm in that range used WH5.
- Each driver's other same-day confirms were WH5.

`UPDATE rf_putaway_operations SET warehouse='WH5', updated_at=now()`. TO 7292240 (last job was yesterday's `:20600`) got a fresh `:20601` job → **confirmed in SAP at 22:26:15 UTC**. TO 7292943 (its `:20601` job already existed from the Fix-1 bump) collided on re-enqueue — data is corrected, will confirm on the next-day bump.

## Outcome

Pending dropped **29 → 4**. The 4 remaining are data-correct/unblocked and need one next-day `updated_at` bump (blocked today only by the same-day idempotency-key collision): TO 3687783 (PDC), 3687824 (PDC), 7292650 (WH5) — transient races; TO 7292943 (WH5) — corrected warehouse.

### 2026-05-29 follow-up — known-4 cleared + new H52 bad-warehouse row

New UTC day cleared the same-day idempotency-key collision. Status check found the 4 still stuck (nothing had bumped them — the trigger only fires on INSERT/UPDATE). Re-fired all 4 via `updated_at = now()` (scoped by id, re-verified `Completed`/`confirmed_source IS NULL` + WH5 corrections intact). Each got a fresh `sap_agent_jobs` row with **`max_attempts=3`** (migration 331 confirmed working again). **All 4 flipped to `TO Confirmed`** within ~2.5 min (7292650, 3687783, 3687824, 7292943).

One NEW stuck row surfaced: **TO 7293633, `warehouse='H52'`, Ed Brummett, created 2026-05-29 19:28** — same bad-warehouse-data category as `-03`/`H5N` (`Entry H52   does not exist in T300`). Its job already carried `max_attempts=3` and correctly did NOT churn (T300 "does not exist" is classified terminal, not the retryable 619). Bin `RO-34-D-02` → WH5 (33/33 prior putaways), so `H52` is almost certainly a garbled `WH5`. **Left uncorrected pending sign-off** (the 2026-05-29 status-check authorization covered only re-firing the known-4). Recommended fix: correct `H52` → `WH5` + bump `updated_at`. This is the 3rd bad-warehouse occurrence (`-03`, `H5N`, `H52`) — reinforces the RF-stow-form warehouse-validation follow-up below.

**H52 correction (2026-05-29 20:10, signed off):** corrected `warehouse H52 → WH5` + `updated_at = now()` on TO 7293633 (id `628fb5fb`). **Did NOT clear today** — hit the same-day idempotency-key collision: the row's failed job `beeca4a9` was created earlier *today* (19:29) with key `trig:...:628fb5fb:20602`, and today's unix_day is also `20602`, so the bump's re-enqueue hit `ON CONFLICT DO NOTHING` (no new job). The existing failed job still carries the stale `H52` payload, so a backfill re-queue would also re-run H52. The warehouse data is now correct and permanent, but a fresh WH5-payload job can only be enqueued once the unix_day rolls (2026-05-30 = `20603`) AND a row event re-fires the trigger — i.e. it needs a **next-day `updated_at` bump** to actually confirm. Per instruction, did NOT retry blindly / no `sap_agent_jobs` writes. This is the SAME class of limitation as the original 4 same-day-collision rows — the per-attempt-idempotency-key follow-up (below) would eliminate it.

**H52 forced re-run (2026-05-29 20:21, option-2 signed off):** since the collision blocked a new job AND the backfill loop kept re-running the stale `H52`-payload job `beeca4a9` every cycle (observed: claimed 20:20:06 → failed H52 20:20:17), directly re-armed the single job row `beeca4a9` to match a freshly-minted confirm-to job (verified column defaults: `attempts`/`claim_count` NOT NULL default 0, `status` default 'queued', claim/lease fields nullable). Exact field changes on `beeca4a9` (no other rows touched, no new job, idempotency_key unchanged):

| Field | Before | After |
|---|---|---|
| `payload.warehouse` | `H52` | `WH5` |
| `status` | `failed` | `queued` |
| `attempts` | 1 | 0 |
| `claim_count` | 1 | 0 |
| `max_attempts` | 3 | 3 (unchanged) |
| `priority` | 50 | 50 (unchanged) |
| `error` | `Entry H52 ... T300` | NULL |
| `claimed_by` / `claimed_at` / `started_at` / `completed_at` / `heartbeat_at` / `claim_lease_until` / `assigned_agent_id` / `step` / `result` | (set) | NULL |

Guarded the UPDATE on `payload->>'warehouse'='H52'` (race-safe vs. the concurrent backfill loop; an in-flight H52 attempt can't confirm anything in SAP, so no double-confirm risk). Worker `USINDPR-CXA102V-W1` claimed the re-armed job and **TO 7293633 confirmed at 2026-05-29 20:21:58 UTC** (`confirmed_source='agent_trigger_direct'`). SAP audit: `WH:WH5 | Transfer order 0007293633 confirmed` @ 20:21:57.9 (agent v2.1.0). **Pending Confirms board = 0.**

## Constraints honoured

- Supabase writes limited to Fix 1 (`updated_at` bumps on the exact layout-race ids), Fix 2a (migration 331 via `apply_migration`), Fix 3 (warehouse correction on the 2 rows). No direct `sap_agent_jobs` edits.
- NO agent EXE rebuild, NO Supabase Storage upload, NO Railway deploy/restart.
- NO new `supabase.channel(...)` callsites.
- `agent.py` AST-parse clean; `python3 -m pytest omni_agent/` — new test collects + skips on the 3.9 sandbox (runs on operator's 3.10+ venv); classifier logic validated standalone (12/12). Pre-existing unrelated failure: `test_log_rotation.py::test_retention_sweep_deletes_old_files` (date-relative, reproduces on clean HEAD).

## Open follow-ups

- **The 4 remaining rows** need a next-day `updated_at` bump (or an operator backfill with widened lookback) to clear. Per-attempt idempotency keys (see below) would remove this friction.
- **Per-attempt idempotency keys** — the `<unix-day>` suffix is why a same-day re-bump no-ops. A per-attempt UUID suffix on the evaluator's idempotency key would let same-day re-enqueues work. Carried over from [[Fix-Putaway-Confirms-Stuck-At-41]].
- **Extend retryable handling to `/sap/lt12` picks** — the same 619 race can hit pick-confirms; Fix 2a (max_attempts) and 2b (retryable) currently scope to putaway confirm-to only.
- **RF stow form validation** — reject warehouses not present in master tables before INSERT, so `-03`/`H5N`-class truncation/typo data never reaches SAP.
- **Agent rebuild** still required for Fix 2b to take effect in production.

## Related

- [[Fix-Putaway-Confirms-Stuck-At-41]] — prior stuck-confirms incident (migrations 321/322); documents the idempotency-key + backfill-cap mechanics this fix builds on.
- [[Fix-Auto-Confirm-Putaways-Trigger-Missing-And-Listener-Wedge]] — original auto-confirm pipeline incident.
- [[Fix-Putaway-Status-UTC-Midnight]] — row-id-targeted PATCH (v1.8.3).
- [[Implement-Putaway-Confirm-Backfill-Loop]] — migration 289 backfill loop.
- [[Components/Omni-Agent - Headless SAP Agent]] — agent claim/complete/fail protocol + `confirm_transfer_order`.
- migration 245 (table + default max_attempts=1), 291 (claim max_attempts enforcement + lease-expiry re-claim), 331 (this fix).
