---
tags: [type/debug, status/active, domain/backend, domain/database, domain/infra]
created: 2026-05-01
---
# Fix — Missed Realtime Events: Backfill Poller + Bounded Dedup Cache (v1.6.9)

## Symptom

User report (2026-05-01): "It is not properly confirming the pending TOs or the completed putaways. It is also skipping them. There are issues still there, and not everything is getting confirmed properly."

Concrete evidence:
- Recent agent confirms WERE working — DB query showed 5 fresh `rf_putaway_operations` rows with `confirmed_by_label = 'Omni Agent'` (the [[Debug/Fix-Agent-Dual-Patcher-Race]] v1.6.8 fix landed correctly).
- BUT 17 OTHER rows from the same 4-hour window were sitting at `to_status='Completed'` with `confirmed_at = NULL`. Same agent. Same org. Same trigger config. The agent had simply never seen the Realtime event for those rows.

So this is **not** a regression of any prior bug. It's a previously-invisible failure mode that became visible once the v1.6.8 attribution fix made it possible to count "rows the agent should have processed" reliably.

## Root cause

The agent's `rf_putaway_operations` Realtime channel is the ONLY trigger source today. Code path:

```
Supabase publication
       │
       │  WebSocket push
       ▼
AsyncRealtimeClient.listen()  (asyncio thread inside `_start_realtime_subscription`)
       │
       │  callback
       ▼
_on_rf_putaway_change(event_type, payload)
       │
       ▼
_hardcoded_trigger_match  →  _enqueue_trigger_job  →  POST /sap_agent_jobs
```

That pipeline is **at-most-once**, not at-least-once. Every link can drop events:

| Failure mode | What happens | Recovery before v1.6.9 |
|---|---|---|
| Agent restart / EXE upgrade | The bridge-time gap between SHUTDOWN and the next subscribe is unbounded — anything that arrives in that window is gone. | None. Permanent miss. |
| WebSocket reconnect blip | The `_run_async` exponential-backoff loop spends 1 → 2 → 4 → 8 → 16 → 32 → 60s in retries on a TCP RST. Rows that arrive in that window are dropped. | None. Permanent miss. |
| Supabase Realtime publication lag | Rare under normal load, but observed during project maintenance windows. | None. Permanent miss. |
| Citrix VDA hibernation | When the user closes the laptop or Citrix puts the desktop to sleep, the WebSocket dies. | None. Permanent miss. |
| pg_cron interrupting Realtime | Some pg_cron jobs hold AccessExclusiveLock briefly; if a publication refresh races with one, events can drop. | None. Permanent miss. |
| Citrix profile rotation | Tier 4 Citrix wipes `%LOCALAPPDATA%`; the agent loses its session and the user has to re-log. The reconnect gap can be minutes. | None. Permanent miss. |

The 17-row backlog was a mix of (b) and (d) — the user had three Citrix sessions overnight where the laptop hibernated, plus one mid-day reconnect blip where the WebSocket bounced.

## The v1.6.9 fix

Three additive changes. **None of them touch existing handlers, trigger semantics, or frontend logic beyond the version-string bump.**

### Fix 1 — Backfill poller daemon thread

New `_start_trigger_backfill_poller()` in [[Components/Omni-Agent - Headless SAP Agent]]:

```python
def _start_trigger_backfill_poller() -> None:
    """Spawn the daemon thread that polls for missed Realtime events.

    Idempotent — safe to call multiple times. Honors the same Supabase
    login gating as `_start_job_poller`.
    """
    if _trigger_backfill_state.get("active"):
        return
    stop_event = threading.Event()

    def _loop() -> None:
        print(
            f"[backfill] Trigger backfill poller started "
            f"(every 60s, scans last 24h, max 50 rows/poll)."
        )
        if stop_event.wait(_TRIGGER_BACKFILL_FIRST_DELAY_SEC):  # 10s
            return
        while not stop_event.is_set():
            try:
                if not state.supabase_url or not state.supabase_token:
                    print(
                        "[backfill] WARN poll skipped: no Supabase token. "
                        "Login via /supabase/login first."
                    )
                elif not state.org_id:
                    print(
                        "[backfill] WARN poll skipped: no org_id resolved "
                        "yet. Will retry on next tick."
                    )
                else:
                    total_matched = total_queued = total_skipped = 0
                    for trigger in _HARDCODED_TRIGGERS:
                        m, q, s = _backfill_one_trigger(trigger)
                        total_matched += m
                        total_queued += q
                        total_skipped += s
                    if total_queued > 0:
                        print(
                            f"[backfill] poll: {total_matched} matched, "
                            f"{total_queued} queued, "
                            f"{total_skipped} skipped (dedup)"
                        )
            except Exception as e:
                print(f"[backfill] poll error (will retry): {e}")
            if stop_event.wait(_TRIGGER_BACKFILL_INTERVAL_SEC):  # 60s
                break
        print("[backfill] Trigger backfill poller stopped.")
    ...
```

The actual PostgREST query the poller fires for the one trigger we ship today (`builtin-rf-putaway-completed`):

```
GET {state.supabase_url}/rest/v1/rf_putaway_operations
    ?select=*
    &to_status=eq.Completed
    &confirmed_at=is.null
    &is_mca_workflow=not.is.true
    &confirmed_source=is.null
    &organization_id=eq.{state.org_id}
    &created_at=gte.{(utcnow - 24h).isoformat()}Z
    &order=created_at.asc
    &limit=50
```

Each filter is justified:

- `to_status=eq.Completed` — the trigger predicate's primary condition.
- `confirmed_at=is.null` — the actual "this row needs work" signal. A row that's already confirmed has a non-NULL value here, so filtering at the REST layer (vs. fetching everything and filtering in Python) keeps the result set small.
- `is_mca_workflow=not.is.true` — tolerant of NULL (PostgREST treats NULL `is_mca_workflow` as "not MCA"). Mirrors `_hardcoded_trigger_match`.
- `confirmed_source=is.null` — excludes rows already touched by ANY confirmation pathway (manual, browser-side `agent_trigger`, agent-side `agent_trigger_direct`, `agent_one_click_ship`). This is the strongest narrowing filter — once a row has any source, it stays out of the backfill set forever.
- `organization_id=eq.<org>` — RLS already scopes to the user's org, but adding the explicit filter cuts the result set even further at the REST layer.
- `created_at=gte.<24h ago>` — the lookback window. On first boot after a long downtime the agent does NOT try to backfill ancient rows; the user has presumably resolved them by other means.
- `order=created_at.asc` — process oldest first so a backlog drains in chronological order.
- `limit=50` — bounded scope cap. A genuine 17-row backlog drains in one poll; a pathological 1000-row backlog drains in 20 polls (20min). Prevents a runaway test from flooding `sap_agent_jobs`.

For each row returned, the poller calls `_hardcoded_trigger_match(trigger, row)` defensively (so a future divergence between the REST filter and the predicate never produces a false positive enqueue), then hands off to the same `_enqueue_trigger_job` path the Realtime callback uses.

### Fix 2 — Bounded TTL dedup cache

The Realtime callback and the backfill poller can both decide to enqueue the same row in the same minute. The PostgREST `idempotency_key` unique constraint is the FINAL guard (a duplicate enqueue 409s) so correctness is never at risk. But every 409 round-trip costs an HTTP call, and the agent prints `[triggers] dedup: ...` on every 409 — so a row that fires 5 Realtime events in 30s + 2 backfill polls produces 7 log lines for 1 piece of work.

v1.6.9 short-circuits BEFORE the HTTP call:

```python
_DEDUP_TTL_SECONDS: float = 300.0      # 5 min
_DEDUP_MAX_ENTRIES: int = 1000         # LRU cap

_recently_queued_rows: OrderedDict[str, float] = OrderedDict()
_dedup_lock = threading.Lock()


def _is_recently_queued(row_id: str) -> bool:
    if not row_id:
        return False
    with _dedup_lock:
        _purge_expired_dedup_entries(time.time())
        return row_id in _recently_queued_rows


def _mark_recently_queued(row_id: str) -> None:
    if not row_id:
        return
    with _dedup_lock:
        now = time.time()
        if row_id in _recently_queued_rows:
            _recently_queued_rows.move_to_end(row_id)
        _recently_queued_rows[row_id] = now
        while len(_recently_queued_rows) > _DEDUP_MAX_ENTRIES:
            _recently_queued_rows.popitem(last=False)
```

Three invariants this enforces:

1. **A row that was queued and FAILED can be re-tried later.** Entries age out after 5min — there's no permanent poison. The user's pre-v1.6.9 mental model "if I see the dedup message, the row will never be retried" was wrong, but only because there was no in-memory cache at all (the dedup was purely DB-level). v1.6.9 makes the model correct: dedup is in-memory + 5min TTL.
2. **Memory is bounded.** A long-running agent processing 10k rows/day doesn't accumulate 10k OrderedDict entries — the LRU cap of 1000 plus the 5min TTL purge keep it tiny in practice.
3. **Realtime double-fires (which spam the console pre-1.6.9) are still suppressed within the 5-min window.**

The cache is wired into `_enqueue_trigger_job` at TWO points:

```python
# 1. Short-circuit BEFORE the HTTP call.
if row_id and _is_recently_queued(row_id):
    if _should_log_dedup(row_id):
        print(f"[triggers] dedup: ... (in-memory cache hit)")
    return

# 2. Mark on enqueue success or 409.
if resp.status_code == 409:
    if row_id:
        _mark_recently_queued(row_id)
        if _should_log_dedup(row_id):
            print(f"[triggers] dedup: ... (already queued in DB)")
    return
...
if row_id:
    _mark_recently_queued(row_id)
print(f"[triggers] {trigger['name']} → queued ...")
```

Failed enqueues (network timeout, 5xx, RLS reject) do NOT mark the row — the next poll legitimately retries.

### Fix 3 — Throttled dedup logging

Even with the in-memory cache, the user sees 1 dedup line per double-fire per row. With Realtime + backfill running concurrently, a single row can produce 4-5 dedup lines in a row. v1.6.9 caps it to one log line per row per minute:

```python
_DEDUP_LOG_THROTTLE_SECONDS: float = 60.0
_dedup_log_last: OrderedDict[str, float] = OrderedDict()


def _should_log_dedup(row_id: str) -> bool:
    """Per-row, per-minute throttle. Returns True for the FIRST hit per
    row in any 60s window, False for subsequent hits within the window."""
    if not row_id:
        return True
    now = time.time()
    with _dedup_lock:
        last = _dedup_log_last.get(row_id)
        if last is not None and (now - last) < _DEDUP_LOG_THROTTLE_SECONDS:
            return False
        if row_id in _dedup_log_last:
            _dedup_log_last.move_to_end(row_id)
        _dedup_log_last[row_id] = now
        while len(_dedup_log_last) > _DEDUP_MAX_ENTRIES:
            _dedup_log_last.popitem(last=False)
        return True
```

After 60s of no events for a row, the next dedup hit logs again — so prolonged dedup storms remain visible without spamming.

## New boot prints

```
[backfill] Trigger backfill poller started (every 60s, scans last 24h, max 50 rows/poll).
```

Then per-poll, **only when the agent meaningfully recovered work**:

```
[backfill] poll: 12 matched, 5 queued, 7 skipped (dedup)
```

The steady-state case (Realtime catching everything; backfill matching but everything already in the dedup cache) is **silent**. The console only prints when the backfill is doing useful work — exactly what the user wants for triage.

When the agent is offline:

```
[backfill] WARN poll skipped: no Supabase token. Login via /supabase/login first.
```

Plus an at-boot summary line in `main()`:

```
[boot]   Trigger backfill: ENABLED — poller wakes every 60s, scans last 24h of `rf_putaway_operations`, max 50 rows/poll. Catches Realtime events missed during reconnect blips.
```

## Why this is the right fix (vs alternatives)

| Alternative | Why rejected |
|---|---|
| Switch to a polling-only architecture (drop Realtime) | Sub-second latency on the happy path is too valuable to lose. The user's UX expectation is "I clicked Complete on the RF gun and the agent confirmed within a few seconds" — 60s polling alone would feel sluggish. |
| Increase the Realtime reconnect-backoff cap to 5min | Doesn't help — the events that arrived during the gap are still gone. |
| Use Supabase's `presence` channels for at-least-once semantics | They don't provide that. Presence is for "who's online", not durable event delivery. |
| Add a `replication_slot` consumer instead of Realtime | Too much new infrastructure (Postgres logical replication, custom consumer process). Way out of scope for an in-process agent. |
| Trigger an immediate full backfill on every Realtime reconnect | Would work for the reconnect-blip case but not for the agent-restart case (where the reconnect IS the boot). Subset of what v1.6.9 does. |
| Use the existing `sap_agent_jobs` poller for backfill (don't add a new thread) | The job poller's responsibility is "drain queued work" — coupling it with "discover missed source rows" muddies the abstraction. Two threads, two concerns. |

The two-thread design (Realtime push + 60s polling fallback) is exactly the same pattern `_start_job_poller` uses for `sap_agent_jobs` itself — see Phase D #16 commentary in [[Components/Omni-Agent - Headless SAP Agent]]. We're applying that same pattern one layer up: triggers, like jobs, get both push and poll.

## Files modified

| File | Change | LOC delta |
|------|--------|-----------|
| `omni_agent/agent.py` | Added TTL dedup cache + helpers (`_recently_queued_rows`, `_dedup_lock`, `_is_recently_queued`, `_mark_recently_queued`, `_purge_expired_dedup_entries`, `_should_log_dedup`); added `_start_trigger_backfill_poller` / `_stop_trigger_backfill_poller` / `_backfill_one_trigger`; added `backfill_filter` to `_HARDCODED_TRIGGERS` entry; wired dedup short-circuit into `_enqueue_trigger_job`; wired backfill into `_on_startup` / `_on_shutdown`; bumped `AGENT_VERSION = "1.6.9"` with banner; added `trigger-backfill-poller` to `AGENT_CAPABILITIES`; added boot banner line in `main()`. Hoisted `from collections import OrderedDict` and `from datetime import timedelta` to top imports. | +~330 / -8 |
| `src/features/admin/sap-testing/lib/agent-fetch.ts` | Bumped `LATEST_AGENT_VERSION = '1.6.9'` + comment block. | +25 / -1 |
| `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` | Mirrored copy for the next Parallels rebuild. | (full file copy) |

## Verification

- AST parse → OK.
- `npm run build` → clean (✓ built in 9.13s; 181 PWA precache entries, same as v1.6.8).
- `ReadLints` on `agent.py` + `agent-fetch.ts` → no errors.
- Code review: the v1.6.7 `_TRIGGER_DROP_AGENT_ATTRIBUTION` self-healing flag is unchanged. The v1.6.8 overlay-only `_apply_trigger_post_patch` is unchanged. The Realtime channel logic in `_start_realtime_subscription` is unchanged. Pure additive.

User to verify post-rebuild:

1. `cd omni_agent && build_exe.bat` on Parallels Windows.
2. Re-launch `OmniFrame_Agent.exe` on Citrix.
3. Watch boot log for `[backfill] Trigger backfill poller started (every 60s, scans last 24h, max 50 rows/poll).`
4. Within ~70s of boot, watch for `[backfill] poll: <N> matched, <M> queued, <K> skipped (dedup)` if there's a backlog. Otherwise silent (Realtime caught everything).
5. SQL spot-check: query `rf_putaway_operations WHERE to_status='Completed' AND confirmed_at IS NULL AND created_at > NOW() - INTERVAL '24 hours'` — should be empty within ~120s of boot if Realtime is healthy, and within ~60s of recovery if it wasn't.
6. UI check: Putaway Log shows the previously-stuck rows now confirmed by Omni Agent.

## Constraints honoured

- DID NOT touch any other handler. Trigger backfill is purely additive.
- DID NOT change `_HARDCODED_TRIGGERS` semantics — the `backfill_filter` field is a new key on the existing entry, not a modification of `events` / `endpoint` / etc.
- DID NOT touch frontend logic beyond `LATEST_AGENT_VERSION` bump.
- The backfill poller and the Realtime subscription correctly do NOT race — both call `_enqueue_trigger_job` but the dedup cache ensures they don't double-fire.
- DID NOT modify the v1.6.7 `_SchemaFallbackFlag` or v1.6.8 `_apply_trigger_post_patch` overlay logic.

## Related

- [[Components/Omni-Agent - Headless SAP Agent]] — where the implementation lives
- [[Patterns/Self-Healing-Schema-Fallback]] — sibling defensive pattern (auto-recover from a transient downstream failure); v1.6.9 backfill is the same idea applied to upstream Realtime events
- [[Debug/Fix-Agent-Dual-Patcher-Race]] — v1.6.8 fix that made it possible to count "rows the agent should have processed" reliably, exposing the missed-event problem
- [[Debug/Fix-Agent-Triggers-Browser-Dependency]] — v1.6.4 fix that made the agent the trigger source in the first place
- [[Patterns/Agent-Self-Attribution]] — overlay pattern the missed-event recovery still respects
- [[Sessions/2026-05-01]]
