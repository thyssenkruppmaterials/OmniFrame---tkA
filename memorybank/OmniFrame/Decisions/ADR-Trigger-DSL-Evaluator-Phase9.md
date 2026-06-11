---
tags: [type/decision, status/active, domain/backend, domain/realtime, domain/database, domain/agent]
created: 2026-05-07
---

# ADR — Server-Side Trigger DSL Evaluator (Phase 9)

## Context

Phase 9 of the [[plans/rust_work_service_full_integration_5b88165d.plan]]
moves agent-trigger evaluation **server-side** into `rust-work-service`.
Previously, two evaluators co-existed:

1. **Browser-side** in
   [`src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts`](../../../src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts)
   (~700 LOC). Subscribed to Supabase Realtime per-trigger; admins could
   pick the source table, event types, and PostgREST filter at trigger-
   setup time. Held the `use-agent-trigger-runtime.ts` grandfather
   exception in [`realtime-policy workspace rule`](../../../realtime-policy workspace rule).
2. **Agent-side** in `omni_agent/agent.py::_HARDCODED_TRIGGERS` (3 entries:
   `builtin-rf-putaway-completed`, `builtin-shipment-queue`,
   `builtin-pick-completed`). Hardcoded; required an agent rebuild + EXE
   rollout to add a new rule.

This ADR records the decision to BUILD the dynamic-DSL evaluator that
[[ADR-WsEvent-Typed-vs-Envelope]] (Workstream B section) explicitly
**declined** to build — and explains what changed in the cost/benefit
calculus that justifies reversing the prior position.

## Prior position (recap)

[[ADR-WsEvent-Typed-vs-Envelope]] declined to ship a generic
`WsEvent::EntityChanged { table, row_id, op, organization_id }` envelope
plus a `WsClientMessage::SubscribeTable { table, filter }` primitive
because:

> That's 1–2 weeks of work plus a security review. The trigger-runtime
> is admin-gated and typically <10 triggers per org, so the load case is
> weak.

The grandfather exception in `realtime-policy.mdc` was the
implementation of that decision: keep the existing
`use-agent-trigger-runtime.ts` channel, do NOT introduce a parallel
typed/envelope variant, revisit only on a real load complaint or a
separate ADR.

This ADR is that "separate ADR".

## What changed since the prior position

Three things shifted the calculus:

1. **The "dynamic Subscribe-to-table from the FE" framing was the wrong
   framing.** The user's actual goal is "admins author rules; the system
   evaluates them server-side". That doesn't require client-driven
   Subscribe-to-table at all. The Rust evaluator owns the per-table
   `PgListener` subscriptions itself (same pattern as the existing
   `rf_putaway_listener`, `sap_agents_listener`, etc.), reads rules from
   `agent_triggers`, and INSERTs `sap_agent_jobs` rows that the existing
   agent fleet drains. **The browser is OUT of the trigger evaluation
   path entirely** — it only does CRUD on `agent_triggers`.
2. **Phase 4 already shipped the foundational pieces.** Migration 276's
   `rf_putaway_operation_changed` NOTIFY trigger + the
   `rf_putaway_listener.rs` template + the `WsEvent::SapJobStatusChanged`
   broadcast that moves agent jobs into the WS bus mean Phase 9 reuses
   90% of the plumbing. The "1–2 weeks of work plus a security review"
   estimate from the prior ADR assumed building the WS plumbing too;
   that part is sunk.
3. **The user explicitly chose Option C — the full dynamic DSL — over
   simpler alternatives.** Option C's stated value is "admins can author
   any of the unbounded set of trigger patterns we'll need over the next
   year without an agent or service rebuild". Option B (a fixed
   allowlist of 3 hardcoded patterns + parameter overrides per-org) was
   rejected because the operational benefit of the simpler scheme
   doesn't outweigh the cost of needing a Rust release each time
   product asks for a new pattern.

## Decision

**Build a server-side trigger DSL evaluator in `rust-work-service`.**
The evaluator:

- Reads rules from `public.agent_triggers` (created by migration 281).
  Hot-reloads on `agent_triggers_changed` NOTIFY (also migration 281).
- Subscribes to per-table NOTIFY channels (e.g.
  `rf_putaway_operation_changed`, `sap_agent_job_changed`) and runs each
  changed row against the rules whose `source_table` matches and whose
  `source_events` includes the operation.
- Each rule's `match_filter` is a JSON document parsed by the
  whitelisted DSL grammar in `rust-work-service/src/triggers/dsl.rs`.
- On match, INSERTs a `sap_agent_jobs` row with the rule's
  `target_endpoint` + an interpolated `payload_template`.
- Broadcasts a `WsEvent::TriggerFired` for FE observability.

The agent's role narrows to "consume `sap_agent_jobs` rows" — the
hardcoded `_HARDCODED_TRIGGERS` list is deleted, and the agent's
`_on_rf_putaway_change` / `_start_trigger_backfill_poller` / dedup cache
become dead code.

### DSL grammar (whitelist)

The parser only recognises:

| Form                                                             | Meaning                                                |
|------------------------------------------------------------------|--------------------------------------------------------|
| `{ "all": [...] }`                                               | logical AND of children                                |
| `{ "any": [...] }`                                               | logical OR of children                                 |
| `{ "not": <child> }`                                             | logical NOT                                            |
| `{ "eq":  { "field": <path>, "value": <literal> } }`             | exact equality                                         |
| `{ "neq": { "field": <path>, "value": <literal> } }`             | inverse                                                |
| `{ "in":  { "field": <path>, "values": [<lit>, ...] } }`         | membership                                             |
| `{ "gt":  { "field": <path>, "value": <number> } }`              | greater than (number-only)                             |
| `{ "gte": { "field": <path>, "value": <number> } }`              | greater than or equal (number-only)                    |
| `{ "lt":  { "field": <path>, "value": <number> } }`              | less than (number-only)                                |
| `{ "lte": { "field": <path>, "value": <number> } }`              | less than or equal (number-only)                       |
| `{ "is_null":     { "field": <path> } }`                         | row[path] is JSON null OR absent                       |
| `{ "is_not_null": { "field": <path> } }`                         | inverse                                                |

`<path>` is a dot-separated string referencing into `row_to_jsonb(NEW)`
(e.g. `to_status`, `payload.material`). `<literal>` is a JSON string,
number, boolean, or null. **No function calls, no sub-queries, no
column refs outside the source row, no template interpolation in
filter values.**

`{}` (empty filter) is shorthand for "always match" so admins can
build `INSERT-only` triggers without filter syntax.

### Source table allowlist

Enumerated in `rust-work-service/src/triggers/config.rs::ALLOWED_SOURCE_TABLES`.
Phase 9 ships with:

- `rf_putaway_operations`
- `sap_agent_jobs`
- `work_tasks`
- `shipment_queue` (when the table exists; tolerated when absent — the
  evaluator skips its listener subscribe with a one-line warn,
  inheriting the v1.8.1 agent's defensive shape)

Adding a new table requires a Rust release that ALSO adds a NOTIFY
trigger on the table (mirroring migration 276) and a `PgListener`
subscription. The DSL itself does not let admins reach a new table.

### Target endpoint allowlist

Same const file. Phase 9 ships with:

- `/sap/confirm-to`
- `/sap/process-shipment`
- `/sap/lt12`
- `/sap/import-lt22`
- `/sap/material-master-bin`
- `/sap/material-master-storage-types`

**Explicitly NOT in the allowlist**: `/sap/connect`, `/sap/disconnect`,
`/sap/select-session`, `/sap/unpin-session`, `/supabase/login`,
`/supabase/logout`, `/agent-token/rotate`, `/shutdown`. Agent-control
endpoints can never be triggered by a server-side rule — that would
escalate the trigger evaluator's blast radius from "drives SAP
operations" to "controls the agent process".

### Loop detection

Per-row depth counter via Redis (`trigger:depth:{org}:{row_id}`, TTL
60s). Each evaluation increments the counter; at >3, the evaluator
aborts with an audit log entry `{ kind: 'trigger.loop_detected',
trigger_id, source_row_id, depth }` and emits a `tracing::warn!`. The
60s TTL is much shorter than the typical inter-evaluation gap (which
is single-digit seconds for SAP-bound work), so a legitimate retry of
the same row 5 minutes later is not punished — but a runaway loop
where trigger A's post-success patch causes trigger B to re-fire on
the same row gets caught within ~2-3 cycles.

## Why this beats the prior framing's concerns

The prior ADR objected to:

> 3. RLS-aware col allowlists in Rust so the listener doesn't leak
>    unredacted PII columns through the envelope's `row_id` field.

Resolved: the WS event the FE receives (`TriggerFired`) carries ONLY
`{ trigger_id, source_row_id, target_endpoint, job_id, organization_id }`
— no row payload. The full row is read by the Rust evaluator (which is
trusted, runs server-side, and uses the same PgListener that the
existing listeners use) but never serialised to a WS subscriber.

> 4. A NOTIFY trigger added to every potentially-subscribed table.

Resolved: the allowlist gates this. Phase 9 ships with NOTIFY triggers
on the four tables in `ALLOWED_SOURCE_TABLES`. Adding a new table
requires a migration that adds the NOTIFY trigger AND a Rust release
that adds the table to the allowlist + spawns the listener. We
explicitly declined to make this auto-discovery for safety.

> 2. A new client-message variant `WsClientMessage::SubscribeTable
>    { table, filter }` plus a per-table-allowlist checked at the WS
>    layer.

Resolved: not needed. The browser is not a trigger consumer; it's a
trigger AUTHOR + observer. Authoring is REST CRUD on
`/api/v1/sap-testing/triggers` (or direct PostgREST against
`agent_triggers` — the table has RLS for "admin-only mutations,
org-member reads"). Observation is the existing `WsEvent::TriggerFired`
broadcast that the per-org WS fan-out already filters.

## When to revisit

Revisit this ADR when:

1. The DSL surface needs to grow beyond the 12 operators above. A
   request for `regex_match`, `contains_substring`, `starts_with`,
   `between` etc. is reasonable — extending the parser is mechanical;
   the security review is bounded because each new operator is a
   pure-function predicate over `row_to_jsonb(NEW)`. Just add the
   variant + tests.
2. The source-table allowlist exceeds ~10 tables. At that scale, the
   maintenance cost of per-table NOTIFY triggers + per-table
   `PgListener` subscriptions becomes material. A generic
   "table_changed" envelope (the original
   [[ADR-WsEvent-Typed-vs-Envelope]] envelope) starts to make sense as
   an internal-only primitive — still NOT exposed to FE clients, just
   deduplicating the Rust-side plumbing. The four-table footprint Phase
   9 ships with is far below that threshold.
3. A dynamic-table primitive becomes necessary for ANOTHER use case
   (i.e., a sibling to the trigger evaluator). Two cases is enough to
   amortise the security-review cost of a generic primitive — at one
   case (the trigger evaluator) the per-table allowlist is the right
   answer.

## Related

- [[ADR-WsEvent-Typed-vs-Envelope]] — the prior ADR this ADR partially
  reverses.
- [[Implement-Rust-Work-Service-Phase4]] — the foundational `WsEvent`
  + `PgListener` plumbing this phase reuses.
- [[Implementations/Implement-Rust-Work-Service-Phase9]] — implementation
  note this ADR pairs with.
- [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]] — Workstream B context
  (the trigger-runtime grandfather exception that Phase 9 removes).
- [[Roadmap-Rust-WS-Unlocks]] — broader migration roadmap.
- `realtime-policy workspace rule` — Phase 9 removes the
  `use-agent-trigger-runtime.ts` exception; the FE hook is deleted.
- `supabase/migrations/281_create_agent_triggers.sql` — table + RLS +
  NOTIFY trigger.
- `supabase/migrations/282_seed_agent_triggers.sql` — intentionally a
  no-op seed (admins create their own triggers via the CRUD UI; see
  migration comment for the three previously-hardcoded patterns).
