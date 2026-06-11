---
tags: [type/decision, status/active, domain/backend, domain/infra, domain/realtime]
created: 2026-05-06
---

# ADR — `rust-work-service` `broadcast::channel` Sizing

## Context

`rust-work-service`'s WebSocket fan-out runs on `tokio::sync::broadcast::channel(1000)` (a single channel, cloned per WS connection). Each per-socket task does `rx.recv().await` to drain events into the client.

When a slow consumer falls behind by more than 1000 events, the channel emits `RecvError::Lagged(n)` and the receiver auto-resyncs to the front of the buffer — dropping `n` events. Today the work-engine event volume is well below the threshold; presence + the four Tier 1 deferred-channel migrations ([[Migrate-Tier1-Deferred-Channels-To-Rust-WS]]) push more volume through the same channel.

[[Add-WsEvent-Lagged-Metric]] added a Prometheus counter `work_ws_lagged_events_total{org_hash}` so we can SEE if/when the buffer pressure starts dropping events. The runbook for diagnosing it is `docs/runbooks/work-engine/ws-lagged-events.md` (Workstream D1 of the same sprint).

This ADR records the **explicit decision NOT to resize the channel today** and the criteria for revisiting.

## Options considered

### Option A — Keep at 1000 (status quo)

**Pros:**

- Memory bounded: 1000 slots × sizeof(WsEvent) × N subscribers. Per-subscriber memory is the binding constraint, not the channel's own.
- Pre-existing observed behaviour. Zero surprise vs. shipped state.
- The `RecvError::Lagged` metric will tell us when this is undersized. Acting on data, not speculation.

**Cons:**

- If Tier 1 + Tier 2 collectively push event rate past the buffer, slow consumers (browser tab paused, JS event loop blocked, etc.) silently lose events. Mitigated by per-FE-consumer 5-min safety-net polls but not eliminated.

### Option B — Double to 2000

**Pros:**

- 2x headroom against bursts. Reduces Lagged-tick frequency for a given event rate.
- Cheap to flip in code (one literal change).

**Cons:**

- Memory per consumer doubles. Currently each subscriber holds up to 1000 `WsEvent` slots; doubling the channel does NOT directly double memory in tokio (the Vec is shared across receivers via the broadcast slot ring), but it does increase the live-event footprint when the producer is fast and consumers are slow.
- **Masks the underlying problem.** A bigger buffer doesn't fix a slow consumer; it just lets it lag further before we notice. The right intervention for a slow consumer is to fix the consumer, not the buffer.
- Sized blindly without load-test data. Could be too small (still drops under burst) OR too large (wastes memory).

### Option C — Per-org or per-subscriber buffers

Replace the single global broadcast channel with a per-org or per-socket buffer.

**Pros:**

- One slow consumer can't pressure other consumers' buffers.
- Sizing decision becomes per-tenant, scaling with subscriber count.

**Cons:**

- Significant architectural change. The current single-channel design is the simplest possible fan-out and matches the FE singleton.
- New synchronization complexity. Per-org buffers need their own lifecycle (when does an empty buffer go away?).
- Out of scope for a sizing decision; would need its own ADR.

## Decision

**Keep at `broadcast::channel(1000)` until the `work_ws_lagged_events_total` metric tells us otherwise.** Defer doubling until we have steady-state load data.

The buffer size + the Lagged metric + the runbook are a unit: the metric exists so the SRE can see the buffer's behaviour under real load, the runbook says how to diagnose, and this ADR commits to acting on data rather than speculation.

## Trigger to revisit

This ADR's status flips from `active` to `superseded` (with a new sizing decision) when ANY of the following holds:

1. **Steady-state non-zero rate** (> 0 events/min over 5-min window) on `work_ws_lagged_events_total{org_hash=<any>}` for **≥ 1 hour** in production. Indicates a sustained slow-consumer scenario or a producer outpacing the buffer; a sizing bump would help even if the underlying slow consumer also gets fixed.
2. **Burst rate** (> 100 events/min over a 1-min window) on **≥ 3 distinct `org_hash` labels simultaneously**. Indicates the broadcaster itself is undersized — multiple unrelated consumers shouldn't be lagging at the same time.
3. **Subscriber count crosses N=200** per process (`sum(work_websocket_subscribers)`). Even with no Lagged events today, that's enough load that we should re-test the buffer before the next sprint of WsEvent additions.
4. **A new WsEvent variant is added with a fundamentally different volume profile** — e.g. an event that fires per second per agent instead of per minute per agent. Don't add such a variant without re-running the buffer math first.

## Tradeoffs (for the next decision)

When we DO revisit, the relevant tradeoffs are:

- **Memory per consumer × buffer size.** `sizeof(WsEvent)` is on the order of ~200 bytes today (largest variant is `PushedWork` with several `Option<String>`/`Option<Vec<Uuid>>` targeting fields). 1000 slots = ~200 KB peak per slow consumer. 2000 = ~400 KB. 5000 = ~1 MB. This bounds production memory if a tenant signs in 1000 tabs at once during an outage.
- **Eviction risk.** Smaller buffer → more Lagged ticks for a given event rate. Bigger buffer → fewer Lagged ticks but slow consumers fall further behind reality before noticing.
- **Producer-consumer ratio.** The buffer protects against burst-y producers + steady consumers. A buffer that's 10× the steady-state per-second event rate × the slowest consumer's response time gives you a 10× burst tolerance. Need both numbers from telemetry to size deliberately.
- **Per-event-type rate proxies.** Today we have `work_websocket_messages_total{direction, message_type}` as a proxy for outbound rate, but no per-WsEvent-variant counter. Adding per-variant rate meters before the next sizing decision is cheap (one `inc()` per `ws_tx.send`) and would let us split the tradeoff per-variant.

## Related

- [[Add-WsEvent-Lagged-Metric]] — the metric this decision parks-pending.
- [[Roadmap-Rust-WS-Unlocks]] — §6 raised the silent-loss hazard.
- [[Migrate-Tier1-Deferred-Channels-To-Rust-WS]] — the migrations that materially increase event volume; sized against the existing 1000 buffer.
- `docs/runbooks/work-engine/ws-lagged-events.md` — runbook for diagnosing the metric.
- [[ADR-WsEvent-Typed-vs-Envelope]] — sibling ADR shipped same day; both decisions influence steady-state event volume.
- [[Sessions/2026-05-06]] — session log.
