---
tags: [type/debug, status/active, domain/backend, domain/infra]
created: 2026-05-07
---
# Fix Trigger Evaluator Channel Singular/Plural

## Symptom

The v2.0.0 OmniFrame agent on `USINDPR-CXA103V` reported `WS connected`,
`/jobs/claim` was succeeding (200 OK with 120 “miss” outcomes in 30 minutes
on rust-work-service `/metrics`), and the **"Auto-Confirm Completed
Putaways"** trigger row was loaded
(`trigger_loader: rule set reloaded total_db_rows=1 accepted=1 rejected=0`)
— yet **no** `sap_agent_jobs` rows were ever inserted by the trigger
evaluator. Putaway TOs piled up in `rf_putaway_operations` with
`to_status='Completed'`, `is_mca_workflow=false`, and
`confirmed_source IS NULL` (~25 rows in 30 minutes), all of which match the
trigger filter exactly. The agent never received a `TriggerFired` or a
putaway-confirmation `SapJobStatusChanged` event because the queue stayed
empty.

## Root cause

[`rust-work-service/src/triggers/evaluator.rs`](../../../rust-work-service/src/triggers/evaluator.rs)
at line 88 derived the LISTEN channel name with:

```rust
let channel = format!("{}_changed", table);
```

For `"rf_putaway_operations"` this yields `rf_putaway_operations_changed`
(plural). But the actual NOTIFY function shipped in migration 276/285 emits:

```sql
PERFORM pg_notify('rf_putaway_operation_changed', …);  -- singular
```

The Phase 4 WS fanout listener `rf_putaway_listener.rs` correctly subscribes
to the SINGULAR channel and works fine — that's why the agent's
`WsEvent::SapJobStatusChanged` deliveries (e.g. the LT22 import job at
console.txt:135) work. But the Phase 9 evaluator's automatic plural form
never sees a single notification.

Postgres `LISTEN` succeeds on any channel name (it just registers interest),
so the evaluator's `LISTEN failed` warning branch never fired and the
bug was invisible from the Railway logs (line 6:
`trigger_evaluator: subscribed channel=rf_putaway_operations_changed`
looked fine).

Same bug applies to `sap_agent_jobs` → evaluator listens on
`sap_agent_jobs_changed` (plural) but migration 271 NOTIFYs on
`sap_agent_job_changed` (singular). It hasn't surfaced yet because no
admin-authored trigger has `source_table = 'sap_agent_jobs'`.

## Fix

Introduced an explicit `channel_for_table(&str) -> String` mapping in
`evaluator.rs`:

- `rf_putaway_operations` → `rf_putaway_operation_changed` (singular)
- `sap_agent_jobs` → `sap_agent_job_changed` (singular)
- everything else → falls back to the `<table>_changed` convention so
  future migrations (`work_tasks`, `shipment_queue`) light up the moment
  they ship the matching NOTIFY trigger.

Locked the mapping with two regression tests:
`channel_for_table_uses_singular_for_phase4_tables` and
`channel_for_table_falls_back_to_convention_for_future_tables`.

DB state is **not** modified — no migration ships with this fix. The
rust-work-service binary needs to be redeployed via the standard Railway
pipeline.

## Verification

- `cargo check -q` clean (only pre-existing `dead_code` warnings).
- `cargo test --lib triggers::evaluator::tests::channel` → 2 passed.
- After the next rust-work-service deploy, look for in Railway logs:
  - `trigger_evaluator: subscribed channel=rf_putaway_operation_changed`
    (singular, one entry per allowlisted table that has a NOTIFY).
  - `trigger_evaluator: rule fired … trigger_id=b8160159 …` (the
    "Auto-Confirm Completed Putaways" rule for org
    `c9d89a74-7179-4033-93ea-56267cf42a17`).
- After the next deploy, look for in agent `console.txt`:
  - `[work-ws] event delivered: type=SapJobStatusChanged … status=queued op=INSERT`
    paired with `Claimed job … ? /sap/confirm-to`.
  - Updates in `rf_putaway_operations` to `confirmed_source = 'agent_trigger_direct'`.

## Why this didn't blow up earlier

The pre-Phase-9 agent ran the trigger evaluator client-side
(`omni_agent/agent.py::_HARDCODED_TRIGGERS`) using a Supabase Realtime
subscription on `rf_putaway_operations`, which never touched these channel
names. Phase 9 (2026-05-07) moved evaluation server-side and the channel-
name drift only became live the moment Phase 9 deployed.

## Related

- [[ADR-Trigger-DSL-Evaluator-Phase9]]
- [[Implement-Rust-Work-Service-Phase9]]
- [[Implement-Rust-Work-Service-Phase4]]
- [[Fix-Phase10-Bootstrap-NameError]]
- [[Omni-Agent - Headless SAP Agent]]
- [[2026-05-07]]
