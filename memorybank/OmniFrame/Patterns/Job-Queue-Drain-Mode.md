---
tags: [type/pattern, status/active, domain/backend, domain/infra]
created: 2026-05-01
---

# Pattern — Job-Queue Drain Mode (Claim-Back-to-Back)

## Problem

A poller that claims ONE job, dispatches it, then sleeps for the fallback interval (60s) before claiming the next one has a latency floor equal to the fallback interval MINUS the push-notification latency. In the happy case, a Realtime INSERT event fires on every new row and the poller wakes sub-second; in the sad case (missed event during a WebSocket reconnect blip, Citrix VDA hibernation, publication lag), the poller waits the full 60s before discovering the next job.

For a batch of N jobs enqueued near-simultaneously (e.g. N putaway completions all triggering `/sap/confirm-to`), the sad case compounds: the first missed wake-up costs 60s, the SECOND missed wake-up costs another 60s, etc. Production observed 60-180s inter-job dwell in exactly this pattern — the Realtime wake-up fired for maybe 3 out of 5 jobs, and the poller sat idle for 60s between the misses.

The naïve fix is to reduce the fallback poll interval from 60s to 5s. This works but produces 12× more claim RPCs on an idle agent (720/hour = 17k/day × N agents), which is both expensive on the Supabase side and noisy in the agent console.

## Pattern

**Claim back-to-back until the queue returns empty, then exponentially back off.** The poller stops sleeping between claims as long as work is available, and only sleeps when the claim-empty signal arrives. The sleep interval ramps exponentially from a short floor (5s) to a long ceiling (60s) across consecutive empty polls, and resets to the floor on any successful claim.

```python
_DRAIN_MIN_IDLE_SEC: float = 5.0     # floor — fresh idle
_DRAIN_MAX_IDLE_SEC: float = 60.0    # ceiling — after many empty polls
_DRAIN_MAX_CHAIN: int = 50           # cap per burst (shutdown responsiveness)

def _loop():
    idle_sleep = _DRAIN_MIN_IDLE_SEC
    consecutive_empty = 0
    while not stop_event.is_set():
        # Drain chain — claim + dispatch until queue empty OR cap hit
        drained = 0
        while drained < _DRAIN_MAX_CHAIN and not stop_event.is_set():
            did_work = _claim_and_dispatch_one()
            if not did_work:
                break
            drained += 1

        if drained > 0:
            consecutive_empty = 0
            idle_sleep = _DRAIN_MIN_IDLE_SEC
            if drained >= 5:
                print(f"[jobs] Drain mode: {drained} jobs claimed in last burst.")
            if drained >= _DRAIN_MAX_CHAIN:
                # Don't sleep — re-enter the loop to continue draining.
                # The chain cap exists purely for shutdown responsiveness.
                continue
        else:
            # Empty poll — exponential backoff on idle.
            consecutive_empty += 1
            idle_sleep = min(
                _DRAIN_MAX_IDLE_SEC,
                _DRAIN_MIN_IDLE_SEC * (2 ** max(0, consecutive_empty - 1))
            )

        drain_event.clear()
        triggered = drain_event.wait(idle_sleep)
        if triggered:
            # Realtime wake — treat as a claim hit for backoff purposes.
            consecutive_empty = 0
            idle_sleep = _DRAIN_MIN_IDLE_SEC
            drain_event.clear()
```

### Why exponential backoff on idle vs. a fixed short interval?

A fixed 5s interval solves the latency problem but creates background load on a truly-idle agent (720 claim RPCs/hour). Exponential backoff solves both:

- **Fresh idle** (last job just completed, queue might have another right behind): 5s wait. If a third job arrives during that window, we pick it up within 5s.
- **Sustained idle** (no jobs for minutes): 5 → 10 → 20 → 40 → 60s. After 5 consecutive empty polls we're at 60s — same as the v1.6.x fallback — and stay there. Total claim RPCs over 5min of idle: 5 + 4 + 2 + 1 + 1 = ~13 RPCs, compared to 60 for a fixed 5s interval.
- **Any claim hit** (Realtime wake OR timer fires and finds work): backoff resets to 5s. The next idle cycle starts short again so a trickle of jobs doesn't slowly ramp into 60s territory.

The exact numbers are tunable but these defaults work well for a human-perceptible-responsiveness target where "inter-job dwell < 5s" is the goal.

### Why a chain cap (`_DRAIN_MAX_CHAIN`)?

Two reasons:

1. **Shutdown responsiveness.** The loop checks `stop_event.is_set()` between claims. If a single iteration of the drain loop claims + dispatches 1000 jobs back-to-back (each 20s), a graceful Ctrl-C would wait up to 20000s (~5.5 hours) before the outer `while` gets a chance to re-check. The cap (50) bounds that to 50 × avg-20s = 16min max blackout before graceful shutdown — acceptable.
2. **Watchdog interaction.** The watchdog (see [[Debug/Fix-Agent-Throughput-Latency]]) fires `_kick_job_poller` after killing a stuck job. The poller picks up the kick on the next `drain_event.wait()`, which doesn't happen until the current drain burst completes. Capping the burst ensures the watchdog's kick is acted on within a bounded time.

In practice, production queues rarely have 50+ jobs simultaneously ready to claim — the cap is slack most of the time. But the cap's presence makes the behavior deterministic under pathological input.

### Why reset backoff on ANY wake-up (Realtime-push included)?

The `drain_event` is set on:

- Realtime INSERT callbacks (sub-second latency to fresh work).
- External `/jobs/claim` POST hits (a curl test from the user).
- The watchdog's kick after releasing a stuck job.

Every one of these signals "there might be work now" — the right response is to drop any idle backoff and re-enter the drain chain. False positives (Realtime fires but the DB already had the row claimed by a faster agent on the same org) cost at most one claim-empty cycle, which is fine.

The "reset on Realtime wake" is important for fleet scenarios: if the local agent is behind a slow Citrix VDA and a faster agent on the same org beat it to the claim, the local agent's Realtime callback still fires. Without the reset, the slow agent would stay at whatever backoff level it was at, potentially missing the NEXT job it could have claimed legitimately.

## Call-site responsibilities

`_claim_and_dispatch_one()` is the per-job atomic unit. It must:

1. Return `True` if a job was claimed (even if dispatch failed — the job is still "done" from the drain loop's perspective, just with `status = failed` in the DB).
2. Return `False` if the queue was empty OR the claim itself failed (network error, 4xx). A return of False means "no claim, drop to idle backoff."
3. Handle the full complete/fail lifecycle synchronously — the drain loop doesn't wait separately for dispatch to finish.
4. Update shared active-job state (see [[Debug/Fix-Agent-Throughput-Latency]] Fix B) BEFORE dispatch and clear it in `finally:` so the watchdog can detect hangs.
5. Never raise — exceptions are caught and treated as `status = failed`.

## When to use this pattern

- The work items are independent (no ordering dependency between sequential claims — safe to drain as fast as possible).
- Dispatch is cheap enough that chaining 50 in a burst doesn't block shutdown signals unreasonably long.
- A push notification (Realtime, webhook, message queue) exists as the primary wake-up path but is best-effort (at-most-once, not at-least-once).
- The fallback polling interval is non-trivial (60s+) so reducing the dwell by claim-back-to-back is a meaningful improvement.
- The queue backend supports atomic claim semantics (`FOR UPDATE SKIP LOCKED` in Postgres, `ReceiveMessage` with `MessageGroupId` in SQS, `LPOP` in Redis, etc.) so two agents can drain the same queue safely.

## When NOT to use this pattern

- Work items have per-claim side effects (rate-limited API calls, resource quotas) where sustained bursting would exceed downstream capacity. In that case, keep the fixed inter-claim sleep as a rate-limit backstop.
- Dispatch is expensive (minutes per job) — the chain cap becomes the dominant latency factor, not the per-claim sleep. Drain mode is orthogonal; still useful but the win is smaller.
- The queue has strict ordering requirements (FIFO with in-flight gaps) — back-to-back parallelism breaks the ordering. FIFO queues with drain-mode single-threaded claim are fine (that's our case — single SAP COM session).
- The push notification path is authoritative (at-least-once with dedup). Then the fallback poll is only for paranoia and the short polling interval doesn't matter. Most real-world systems are at-most-once, though, so this case is rarer than you'd think.

## Observability — drain burst log line

Bursts of 5+ jobs emit a single summary line:

```
[jobs]   Drain mode: 12 jobs claimed in last burst.
```

Purpose:

- **Distinguish drain-mode work from steady-state work** in the console. A user skimming the log sees "oh the agent just drained a backlog" instead of wondering why they're seeing 12 `Claimed job ...` lines in 30 seconds.
- **Diagnose the "queue was stuck" scenario** — a burst of 20+ jobs usually means Realtime dropped events for a while and the backfill poller + drain combined caught the catch-up. Knowing that happened helps tune the upstream reliability.
- **Validate the drain cap isn't being hit regularly.** If the log consistently shows "Drain mode: 50" (the cap), it means the queue is perpetually deep and the cap is the bottleneck — that's a signal to scale horizontally (more agents) rather than tune the cap up.

The 5-job threshold keeps the log clean during normal traffic (1-3 jobs per burst is typical).

## Sibling patterns

- [[Patterns/Self-Healing-Schema-Fallback]] — also a "defensive recovery from a transient downstream failure" pattern, but at the PostgREST schema-cache layer rather than the queue-claim layer.
- [[Debug/Fix-Missed-Realtime-Events-Backfill]] (v1.6.9) — the complement to drain mode at the Realtime event layer. Drain mode reduces latency when the agent KNOWS about a job; backfill recovers when the agent MISSED the event entirely.

The three patterns form a defensive trio:

| Layer | Primary fast path | Recovery mechanism |
|-------|-------------------|-------------------|
| Realtime event delivery | WebSocket push callback | Backfill poller (60s sweep of last 24h) |
| Job claim | Drain-back-to-back on wake | Exponential backoff (5s → 60s) |
| PostgREST schema | Full schema PATCH | Self-healing fallback flag (5min cooldown) |

Each layer's recovery mechanism is cheap, bounded, and quiet at steady state. Put together, the agent survives transient failures across all three layers without silent work loss.

## Variants

- **Fair-share drain across queues** — if the agent polls multiple queues (e.g. per-user or per-priority), round-robin the drain across queues within a burst so no single queue monopolizes the chain cap.
- **Adaptive chain cap** — tune `_DRAIN_MAX_CHAIN` dynamically based on average dispatch duration (keep total burst time under N seconds for shutdown SLA).
- **Async drain with bounded concurrency** — if dispatch is truly independent and the handler runtime allows, dispatch multiple jobs concurrently up to a bound (e.g. `asyncio.gather` with semaphore). Our SAP single-thread constraint forbids this; most other queue consumers can.

## Related

- [[Debug/Fix-Agent-Throughput-Latency]] — v1.7.0 implementation of this pattern
- [[Components/Omni-Agent - Headless SAP Agent]] — the consumer of this pattern
- [[Patterns/Self-Healing-Schema-Fallback]] — sibling defensive pattern
- [[Debug/Fix-Missed-Realtime-Events-Backfill]] — complementary Realtime-layer recovery
- [[Sessions/2026-05-01]] — implementation session
