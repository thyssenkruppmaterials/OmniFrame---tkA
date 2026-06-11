---
tags: [type/pattern, status/active, domain/backend, domain/database, cycle-count, scoping]
created: 2026-05-01
---

# Per-operator vs global defer scope

## Pattern

When a `_for_operator` table tracks per-user state (skip, defer, mute, snooze) AND that table also has rows for OTHER users, **every read filter on the per-operator code path MUST scope to the current user**. A missing `WHERE user_id = $current_user` turns the per-operator behavior into a global one.

## The trap

```sql
-- table is per-operator (has user_id column)
CREATE TABLE cycle_count_operator_deferred_counts (
  count_id uuid, user_id uuid, is_active boolean, ...
);

-- but the candidate query forgets to scope:
AND rcc.id NOT IN (
  SELECT count_id FROM cycle_count_operator_deferred_counts
  WHERE is_active = true       -- ❌ NO user_id scope
)
```

Result: operator A's defer hides the row from operator B too. The per-operator table behaves as a global block-list. Critical-priority counts can be silently excluded from every operator's queue if any single operator deferred them.

The correct version:

```sql
AND rcc.id NOT IN (
  SELECT count_id FROM cycle_count_operator_deferred_counts
  WHERE is_active = true
    AND user_id = $current_user_id
)
```

## Where this came up

[[Fix-Critical-Hidden-By-Global-Defer-Filter]] — `claim_next_cycle_count` Phase 2 in `rust-work-service/src/db/queries.rs` had the bare `is_active = true` filter. Five critical + 21 hot counts deferred by four other operators became invisible to a fifth operator (Jai) for the entire session. Hidden behind the priority-first ORDER BY — never reproduced in 252 / 253 smoke tests because those tests never inserted a deferred row.

## Resolution (2026-05-01)

Fix shipped in two halves:

- **SQL unblock** — 26 stranded critical+hot defer rows cleared (`is_active = false, cleared_at = NOW()`). Reversible — the same operators can re-defer if they re-encounter the rows.
- **Rust patch** — three call sites scoped to `WHERE user_id = $current_user`:
  1. `claim_next_cycle_count` Phase 2 candidate scan (the original bug).
  2. `get_pending_cycle_counts` queue-list endpoint (`/api/v1/work/queue`) — added `auth_user_id` parameter; route handler threads `user.user_id` through.
  3. `get_queue_stats` `pending` subquery (`/api/v1/work/queue/stats`) — same. `deferred_pending` left global as admin observability signal.

Scheduler `broadcast_queue_stats` (org-scoped WS payload) intentionally NOT scoped — it's a single fan-out per org, can't represent per-recipient state. Per-operator information lives in the REST channel; WS retains the org-level summary.

Phase 1 (`assigned_to = $2`), Phase 3 / `get_deferred_count_for_user` (`d.user_id = $1`), and `get_worker_tasks` (`assigned_to = $1`) were already correctly scoped — only Phase 2 + the two queue-list/stats endpoints had the bug.

`cargo check` + `cargo test` (16/16) green. Diff `+89 / -10` LOC across `queries.rs` + `routes/work.rs`. Awaiting Railway redeploy of `rust-work-service` (service `fac8472c-…`) — the SQL unblock keeps production usable in the interim by clearing the specific 26 stranded rows.

## Audit checklist for similar tables

Any `_for_operator`-style table in this project (defer, snooze, dismiss, mute, hide) should be audited:

- [x] Every SELECT in a per-operator code path filters `user_id = $current_user`. — closed for `cycle_count_operator_deferred_counts` 2026-05-01 (Rust patch + SQL unblock; pending Railway redeploy).
- [x] Every SELECT in a global / admin path explicitly comments that it's intentionally global. — `broadcast_queue_stats` and `get_queue_stats.deferred_pending` both carry inline `// intentionally global` comments after this fix.
- [ ] Smoke tests cover at least one row deferred-by-another-user → still visible to the current user. — open; should land in the next Rust integration-test pass.
- [ ] Schema-level CHECK or partial unique index makes the user-scope explicit (`UNIQUE (count_id, user_id) WHERE is_active`). — open; index already enforces the per-user uniqueness via composite key on the table, but a defensive `WHERE is_active` partial index would make the contract explicit.

## Generalization

Any query that joins a per-actor scoped table without binding the actor identity is suspect. Same shape as:

- `notification_dismissals` (dismiss-by-user) — read filter must include `user_id = $current_user`.
- `cycle_count_operator_deferred_counts` (defer-by-operator) — same.
- `task_snooze` / `inbox_mute` — same.

A test that inserts state for User A and reads from User B is the cheapest way to catch this in CI.

## Related

- [[Fix-Critical-Hidden-By-Global-Defer-Filter]]
- [[Cycle-Count-Bug-Fix-Pass-Migration-252]]
- [[Cycle-Count-Final-Hardening-Pass-Migration-253]]
