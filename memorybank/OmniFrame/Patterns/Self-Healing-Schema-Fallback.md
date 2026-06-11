---
tags: [type/pattern, status/active, domain/backend, domain/database]
created: 2026-04-30
---

# Pattern — Self-Healing Schema-Cache Fallback

## Problem

When the agent writes a column that the database is supposed to have but doesn't (yet), PostgREST returns 400 with `"Could not find the 'X' column of 'T' in the schema cache"`. Causes:

- **Migration not yet applied** — the agent rebuild shipped before the migration ran on the target Supabase project. The column genuinely doesn't exist.
- **PostgREST schema cache stale** — the migration just ran, but PostgREST's per-instance schema cache hasn't refreshed yet (typically a few minutes; can be triggered via `NOTIFY pgrst, 'reload schema'` but rarely is in practice). The column DOES exist in Postgres, but PostgREST doesn't know about it, so the patch 400s for a brief window.
- **PostgREST + connection-pool stragglers** — multiple PostgREST replicas, only some refreshed.

The naïve fix in v1.6.5 (`_REGISTRY_DROP_PROCESS_STARTED_AT`) and v1.6.6 (`_TRIGGER_DROP_AGENT_ATTRIBUTION`) was a permanent boolean flag: on first 400, set the flag, drop the field on every subsequent call for the rest of the process lifetime. This is correct in spirit (don't keep banging on a column the schema cache says doesn't exist) but **wrong in practice**: a transient cache miss right after a fresh migration silently disables the feature for the rest of the agent session — the user sees "agent attribution doesn't work" forever, even after PostgREST's cache has caught up two minutes later. The only recovery is restarting the agent, which most users don't think to do.

## Pattern

**Wrap the suppress flag in a self-healing primitive with a cooldown.** On the first 400, trip the flag for `cooldown_seconds` (default 5min) — during that window, calls drop the field. After the cooldown elapses, the next call **re-attempts WITH the field**. If it succeeds, the flag stays cleared (PostgREST has caught up). If it fails the same way, the cooldown restarts (migration genuinely hasn't landed yet).

```python
class _SchemaFallbackFlag:
    """Self-healing fallback flag. Once tripped, suppresses a feature
    for `cooldown` seconds (default 5min). After cooldown, the next call
    re-attempts WITH the feature; if it succeeds, the flag stays cleared;
    if it fails the same way, the cooldown restarts.
    """
    def __init__(self, label: str, cooldown_seconds: float = 300.0):
        self._label = label
        self._cooldown = cooldown_seconds
        self._tripped_at: Optional[float] = None

    @property
    def active(self) -> bool:
        if self._tripped_at is None:
            return False
        if (time.time() - self._tripped_at) > self._cooldown:
            print(f"[schema-fallback] {self._label}: cooldown expired, "
                  "re-attempting full schema on next call.")
            self._tripped_at = None
            return False
        return True

    def trip(self, reason: str) -> None:
        self._tripped_at = time.time()
        print(f"[schema-fallback] {self._label}: tripped ({reason}); "
              f"will retry full schema in {int(self._cooldown)}s.")

    def clear(self) -> None:
        if self._tripped_at is not None:
            print(f"[schema-fallback] {self._label}: cleared "
                  "(full schema works again).")
        self._tripped_at = None
```

## Call-site shape

```python
attempted_full_schema = not _FLAG.active
if not attempted_full_schema:
    body.pop("feature_column", None)
resp = requests.post(url, json=body, ...)
fallback_used = False
if (
    resp.status_code == 400
    and attempted_full_schema
    and "feature_column" in (resp.text or "")
):
    _FLAG.trip(f"PostgREST 400: {resp.text[:120]}")
    fallback_used = True
    body.pop("feature_column", None)
    resp = requests.post(url, json=body, ...)
if resp.status_code >= 400:
    return error
if attempted_full_schema and not fallback_used:
    _FLAG.clear()  # success on full schema → confirm cache is healthy
return ok
```

The `attempted_full_schema` capture at the start matters: it has to read `_FLAG.active` once and remember the answer, because `.active` has the side effect of clearing the flag if the cooldown has elapsed. If you check `.active` again later in the same request, the answer can flip — that's a subtle race we explicitly avoid by capturing once.

## Boot-print lifecycle

Because the class prints on every state transition, ops can grep the agent log for the full feature lifecycle:

```
[schema-fallback] rf_putaway_operations.agent_attribution: tripped (PostgREST 400 on rf_putaway_operations patch: {"code":"PGRST204","details":null,"hint":null,"message":"Could not find the 'confirmed_by_label' column of 'rf_putaway_operations' in the schema cache"}); will retry full schema in 300s.
[schema-fallback] rf_putaway_operations.agent_attribution: cooldown expired, re-attempting full schema on next call.
[schema-fallback] rf_putaway_operations.agent_attribution: cleared (full schema works again).
```

Three-line story: PostgREST 400'd → we backed off for 5min → recovery succeeded. No ambiguity, no "why is the agent stripping the field?" mystery.

## When to use this pattern

- The agent talks to a remote schema (PostgREST, REST API, etc.) where columns/fields may genuinely be absent OR temporarily uncached.
- A 4xx with a recognizable error fingerprint ("column not found", "unknown field", etc.) lets you tell "missing" from other 4xx classes (auth, validation).
- The feature being stripped is a nice-to-have (display label, debug fingerprint) — losing it for 5min is acceptable, but losing it forever isn't.
- The agent is a long-running process (FastAPI server, daemon) where the cost of restarting to recover is high.

## When NOT to use this pattern

- The feature is critical to correctness — losing it ANY length of time is unacceptable. Fail loudly, restart, force the user to ack.
- The 4xx isn't recoverable by stripping a field (e.g. a foreign key violation, an RLS reject). The pattern only applies when there's a meaningful "degraded" mode.
- Short-lived processes (CLI commands, Lambda functions) — the boolean flag is fine, the process exits before forever-disable matters.
- The remote schema never changes during the process lifetime (e.g. a fully-versioned API). Boolean flag is simpler.

## Cooldown choice

5 minutes was chosen because:

- **PostgREST schema cache TTL** — typically refreshes within ~30s of a migration in normal operation, but can take longer under load or with multiple replicas. 5min gives generous headroom.
- **Heartbeat cadence** — `_upsert_self_in_registry` runs every 30s. A 5min cooldown means we re-attempt 1 in every 10 heartbeats, which is cheap but reactive.
- **Trigger cadence** — `_apply_trigger_post_patch` runs only on agent-side TO confirms (sporadic). 5min means even a single trigger fire after the cache catches up will recover.

For different feature columns, tune the cooldown:

- Frequent calls (>1Hz) — bump cooldown to 30min, otherwise you re-attempt too often.
- Infrequent calls (<1/hr) — keep cooldown at 5min, otherwise recovery is too slow.

## Variants

- **Per-tenant cooldown** — if the agent serves multiple Supabase projects (it doesn't today, but might in the future), key the flag by `(tenant_id, label)` so a stale cache on one project doesn't disable the feature for others.
- **Exponential backoff** — instead of a fixed 5min cooldown, double the interval after each consecutive failure (5min → 10min → 20min → cap at 1hr). Useful when the column is genuinely missing and won't appear for hours/days.
- **Probe call** — instead of folding the recovery probe into the next real call, run a separate dedicated probe (HEAD request, PostgREST `?select=feature_column&limit=0`) to test the schema. Decoupled from real traffic, less chance of confusing log output.

## Sibling pattern: missed-event backfill (v1.6.9)

The same "self-healing without forever-disabling" mindset shows up one layer up the stack. `_SchemaFallbackFlag` recovers from **transient downstream failures** (PostgREST schema cache lag). The v1.6.9 trigger backfill poller (see [[Debug/Fix-Missed-Realtime-Events-Backfill]]) recovers from **transient upstream failures** — Realtime is at-most-once, not at-least-once, and any number of failure modes (agent restart, WebSocket reconnect blip, Supabase publication lag, Citrix VDA hibernation, pg_cron interrupting Realtime) silently drop events forever.

Both patterns share the same shape:

1. Primary path is fast and push-driven (PostgREST PATCH for schema fallback; WebSocket Realtime for backfill).
2. Primary path can fail in a recoverable way (cache miss or missed event).
3. A small defensive mechanism runs in the background to detect-and-recover (cooldown re-attempt for schema; periodic poll for missed events).
4. Bounded scope — neither mechanism has unbounded retry pressure.
5. Quiet logging — the recovery mechanism only logs when it actually does something useful.

This isn't accidental. Both classes of failure look the same from the agent's perspective: "I don't know if the column/event is real or transiently invisible, so I'll back off, then probe again." The difference is just which side of the agent the transient failure lives on.

A future agent that talks to a third upstream/downstream API where best-effort delivery is the norm should reach for the same primitive. Resist the temptation to either (a) trust the primary path absolutely (silently lose work) or (b) wire a hard restart on every failure (too aggressive, blocks healthy work).

## Related

- [[Components/Omni-Agent - Headless SAP Agent]] — where the pattern is implemented
- [[Patterns/Agent-Self-Attribution]] — the v1.6.6 feature that motivated wrapping `_TRIGGER_DROP_AGENT_ATTRIBUTION` in this primitive
- [[Implementations/Implement-Agent-SAP-AutoConnect]] — sibling defensive pattern (auto-recover from a transient downstream failure)
- [[Debug/Fix-Missed-Realtime-Events-Backfill]] — v1.6.9 sibling pattern applied to upstream Realtime delivery
- [[Sessions/2026-04-30]] — v1.6.7 implementation session
- [[Sessions/2026-05-01]] — v1.6.8 + v1.6.9 implementation sessions
