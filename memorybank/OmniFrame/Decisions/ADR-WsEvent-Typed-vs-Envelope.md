---
tags: [type/decision, status/active, domain/backend, domain/realtime]
created: 2026-05-06
---

# ADR — `WsEvent` Typed Variants vs. Generic Envelope

## Context

[[Roadmap-Rust-WS-Unlocks]] §6 ("Risks / things to budget for") flagged:

> **Closed enum vs generic envelope.** Tier 1 keeps adding `Sap…Changed`, `WorkEngineHealthChanged`, etc. — the `WsEvent` enum grows. Decide NOW whether to keep the closed enum (better type safety, current pattern) or move to a `WsEvent::DomainEvent { kind, payload }` envelope (easier to extend, weaker type safety). **Not deciding is the worst option — we end up with both.**

We're about to add **four** Tier 1 deferred-channel migrations ([[Migrate-Tier1-Deferred-Channels-To-Rust-WS]]) plus carry the prior two SAP / presence migrations. The enum is at 11 variants today (`TaskAssigned`, `TaskStatusChanged`, `WorkerStatusChanged`, `QueueStatsUpdated`, `PushedWork`, `Heartbeat`, `ReservationEscalated`, `SapAgentChanged`, `PresenceJoined`, `PresenceUpdated`, `PresenceLeft`) plus Worker 3's `EntityFocus` + `Notification`. After this sprint it will be at **17**.

This ADR records the decision so the next worker doesn't have to re-make it.

## Options considered

### Option α — Typed enum (current pattern)

Every new event class is a new typed `WsEvent` arm with its own field shape:

```rust
WsEvent::SapJobStatusChanged {
    job_id: Uuid,
    organization_id: Uuid,
    status: String,
    step: Option<String>,
    op: String,
}
```

**Pros:**

- Strong type safety end-to-end. Compiler catches missing fields, wrong types, removed-variants-still-being-matched-on.
- Each new variant forces a code review pass on the field shape AND the matcher arm in `organization_id()` AND the FE `WsEventType` extension AND the FE handler.
- `serde(tag = "type")` + flat-optional FE shape preserves wire-compat. Existing consumers tolerate unknown variants by falling through their switch statements.
- Mirrors the only worked Tier 1 migration template ([[Migrate-SapAgentChanged-To-Rust-WS]]).
- The `organization_id()` matcher arm is exhaustive — the deny-by-default org filter cannot accidentally bypass a new variant.
- Future migrations like `WorkEngineHealthChanged` (which has `is_healthy: bool` + `last_check_at: DateTime<Utc>`) don't fit a generic envelope cleanly.

**Cons:**

- Enum grows. ~17 variants after this sprint.
- Per-listener boilerplate is real: each new variant needs its own listener module + `tokio::spawn` line in `main.rs`. The four Tier 1 deferred migrations land ~340 LOC of mostly-duplicated Rust listener code.
- A future variant that genuinely is generic (e.g. `WsEvent::EntityChanged { table, row_id, op }` for the `use-agent-trigger-runtime.ts` runtime-configured triggers) doesn't fit at all — we'd have to add the envelope variant later as variant N+1.

### Option β — Hybrid (envelope for simple entity events, typed for everything else)

Introduce ONE generic envelope variant for entity-data hooks:

```rust
WsEvent::EntityChanged {
    table: String,                  // 'rr_cyclecount_data' | 'rr_lx03_data' | …
    row_id: serde_json::Value,      // typically Uuid as JSON
    organization_id: Option<Uuid>,
    op: String,
}
```

Use it for the four entity-data hooks (cycle-count-operations, lx03, mdm-commands, device-locations). Keep typed variants for SAP-specific ones (job-queue, import-runs) and presence / Tier 2.

**Pros:**

- ONE Rust listener module that consumes N tables via configuration; cuts ~340 LOC of duplicated listener code in this sprint.
- ONE Rust variant + ONE FE handler shape for any future generic entity-data migration.
- Future `use-agent-trigger-runtime.ts` migration becomes structurally possible (Workstream B Option b).

**Cons:**

- Loses type safety on the entity-data path. The FE has to cast `row_id` from `serde_json::Value`; the typed Rust column shape is gone.
- The send-loop's `organization_id()` matcher arm becomes `Option<Uuid>` for this variant — NULL-org rows broadcast system-wide. Not unsafe per se, but harder to reason about than the deny-by-default flow that exists for typed variants with required `Uuid`.
- A generic Subscribe-to-table primitive, if added later, expands the WS attack surface: we'd need per-table RLS-aware col allowlists + a deny-by-default policy. NOT a generic envelope's fault per se, but the two changes go hand-in-hand for the trigger-runtime use case.
- The FE handler for the entity-data variant has to switch on `event.table` anyway — the Rust LOC saved doesn't translate to FE LOC saved.
- Inconsistent shape across the codebase: SAP migrations are typed, entity migrations are envelope. New developers have to learn two patterns.

## Decision

**Option α — typed enum.** All four Tier 1 deferred migrations ship as new typed variants:

- `WsEvent::SapJobStatusChanged`
- `WsEvent::ImportRunStatusChanged`
- `WsEvent::CycleCountOperationChanged`
- `WsEvent::Lx03DataChanged`

The per-listener boilerplate cost is real but bounded; we accept it in exchange for type safety + consistency with the existing template.

## Workstream B context — `use-agent-trigger-runtime.ts`

The original prompt asked us to ALSO decide the fate of `use-agent-trigger-runtime.ts`. Our reasoning:

The trigger-runtime is the ONE existing channel callsite that genuinely needs a dynamic-table envelope (admin picks the table + filter at trigger-setup time, not deploy-time). Migrating it requires:

1. A `WsEvent::EntityChanged { table, row_id, op, organization_id }` envelope variant.
2. A new client-message variant `WsClientMessage::SubscribeTable { table, filter }` plus a per-table-allowlist checked at the WS layer.
3. RLS-aware col allowlists in Rust so the listener doesn't leak unredacted PII columns through the envelope's `row_id` field (today triggers can return arbitrary columns; with the envelope we'd return only the row id).
4. A NOTIFY trigger added to every potentially-subscribed table.

That's 1–2 weeks of work plus a security review. The trigger-runtime is admin-gated and typically <10 triggers per org, so the load case is weak.

**Decision: grandfather `use-agent-trigger-runtime.ts` per Option a.** Document the architectural mismatch in `realtime-policy.mdc`'s Exceptions list. Revisit only on a real load complaint or a separate ADR proposing the envelope.

This decision keeps Option α honest: we don't "end up with both" because the grandfathered channel is documented as an exception, not a precedent.

## When to revisit

Revisit this ADR when:

1. The `WsEvent` enum crosses ~25 variants. At that scale the doc-comment + matcher-arm boilerplate starts feeling material; an envelope-for-trivial-events bucket may pay for itself. The four Tier 1 migrations adding ~5 variants gets us to 17; comfortable headroom.
2. A second use case needs a runtime-configured table subscription (i.e., a sibling to `use-agent-trigger-runtime.ts`). Two cases is enough to amortise the security-review cost of a generic primitive.
3. The per-listener boilerplate becomes a measurable bottleneck on the team's PR throughput. If a junior dev needs more than 30 minutes to land a new listener module, the template is too verbose; consider a `pg_listener_runner` helper that takes (channel_name, payload_parser, event_constructor).

## Related

- [[Roadmap-Rust-WS-Unlocks]] — §6 raised this question.
- [[Migrate-SapAgentChanged-To-Rust-WS]] — the typed-variant template.
- [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]] — the implementation that consumed this decision.
- [[ADR-Presence-Architecture-Next-Steps]] — the broader Option-2 framing.
- [[ADR-Broadcast-Channel-Sizing]] — sibling sizing decision (also parked-pending-data).
- `realtime-policy workspace rule` — carries the `use-agent-trigger-runtime.ts` grandfather exception that follows from the Option-a decision above.
- [[Sessions/2026-05-06]] — session log.
