# Runbook — Idempotency Replay-Hit Baseline Drift

**Symptom.** Prometheus alert `WorkIdempotencyReplayDrift` fires
because the rate of `work_idempotency_hits_total{route}` over the last
10min has drifted more than ±50% from the same-hour baseline 1h ago.
The alert spec is the symmetric pair:

```promql
(rate(work_idempotency_hits_total[10m])
  - rate(work_idempotency_hits_total[1h] offset 1h))
  / clamp_min(rate(work_idempotency_hits_total[1h] offset 1h), 0.001)
  > 0.5
```

(plus the mirrored `< -0.5` direction).

The idempotency-key middleware records `(organization_id,
idempotency_key, route, request_hash) → (status, body)` in
`work_request_idempotency` for every successful mutating request. On
replay, `lookup()` returns the stored body and the counter increments.
Steady-state replay rate is small but non-zero — clients retry on a
predictable cadence.

This is a **warning** alert. The drift is a soft signal: it usually
points at a downstream issue rather than at the work-service itself.

## Likely causes

1. **Client retry storm.** The FE or the agent started retrying
   requests aggressively because of a transient downstream failure
   (e.g. a CDN gateway 502 between FE and work-service). Each retry
   carries the same `Idempotency-Key`, so the replay-hit rate spikes
   above baseline.
2. **FE key-generation regression.** A recent FE change made a hot
   route generate a NEW idempotency key on every render — the
   replay-hit rate DROPS to zero (because no key is ever reused).
   This is the negative-direction case of the drift.
3. **Agent reconnect loop.** The on-prem agent is in a reconnect
   loop after Phase 4 cutover; each reconnect re-issues a buffered
   set of `sap_agent_jobs` POSTs, each of which carries the same
   key (idempotency-key plumbing intact) → replay rate spikes.
4. **Hash regression.** A change to `canonical_request_hash` or the
   payload schema means a SAME logical request now hashes to a
   DIFFERENT value. Replays return 409
   `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` instead of the
   stored body — replay rate drops, 409 rate spikes.
5. **TTL sweeper drift.** The `cleanup_expired` task runs on a
   schedule (Rust scheduler or pg_cron — see plan §1.5). If the
   sweeper stopped running, the replay window expands beyond 24h and
   replay rate climbs as the table fills with rows that should have
   been GC'd.

## Triage queries

### Prometheus

Identify which route is driving the drift:

```promql
topk(5,
  abs(
    rate(work_idempotency_hits_total[10m])
    - rate(work_idempotency_hits_total[1h] offset 1h)
  )
) by (route)
```

Check the absolute volume so you know whether ±50% drift is a
big-deal jump or a rounding error on a low-traffic route:

```promql
sum by (route) (rate(work_idempotency_hits_total[10m]))
sum by (route) (rate(work_idempotency_hits_total[1h] offset 1h))
```

Cross-reference with the 409 rate (the "different payload" rejection,
which is NOT the same as a replay):

```promql
sum by (route) (
  rate(work_http_requests_total{status="409"}[10m])
)
```

A spike in 409 alongside a positive drift in `_hits_total` is the
hash-regression signature.

### Database

Check the `work_request_idempotency` table size + age distribution:

```sql
SELECT route, count(*), max(created_at) AS most_recent, min(created_at) AS oldest,
       count(*) FILTER (WHERE expires_at < now()) AS expired
  FROM public.work_request_idempotency
 GROUP BY route
 ORDER BY count(*) DESC;
```

If `expired > 0` and the count is climbing, the TTL sweeper has
stopped. Look for the cleanup runner (Rust task or pg_cron job) and
restart it.

Check for hash distribution drift (spot a replay vs. a hash
regression):

```sql
SELECT route, request_hash, count(*)
  FROM public.work_request_idempotency
 WHERE created_at > now() - interval '1 hour'
 GROUP BY route, request_hash
 HAVING count(*) > 5
 ORDER BY count(*) DESC
 LIMIT 20;
```

Many distinct `request_hash` for ONE route + small count each ⇒
clients are generating new keys each time (not actually replaying).
A few `request_hash` with very high counts ⇒ a real retry storm.

### Work-service logs

```bash
# Idempotency replay-hit log lines (route handler emits a debug log
# when `lookup` returns Some(stored)):
railway logs rust-work-service --since 30m \
  | grep 'idempotency replay hit' \
  | tail -50
```

The `route` and the `idempotency_key` are structured fields on the
log line; group by `idempotency_key` to identify the storm-driving
client.

## Mitigation

### Client-side (most common — retry storm)

1. **Identify the retrying client.** The work-service log carries
   `idempotency_key` per replay; it's typically a UUID-shaped value
   the FE / agent generated. Track it back to the client via the
   `User-Agent` header (logged by the `tower_http::trace::TraceLayer`).
2. **Talk to the source.** Common cases:
   - FE bug → file a P2 against the relevant feature.
   - Agent bug → roll back the recent agent build, or set
     `OMNIFRAME_AGENT_USE_RUST_WS=0` to fall back to the legacy
     Realtime path while the issue is investigated.
   - Network flap → the retry storm is symptomatic; the underlying
     cause needs network-team triage.

### FE key-generation regression (negative-direction drift)

1. **Diff the recent FE deploys** for hot routes
   (`/api/v1/work/claim`, `/api/v1/work/push`,
   `/api/v1/work/tasks/:id/complete`).
2. **Confirm the regression** by sending two identical requests with
   the SAME `Idempotency-Key` — the second should return the stored
   body, not a fresh execution. If the second runs fresh, the FE
   isn't sending the key.
3. **Roll back the FE commit** that broke key generation.

### Server-side (TTL sweeper drift)

1. **Restart the cleanup task** if `work_request_idempotency` rows
   are accumulating without expiry. The task is currently the Rust
   path (`observability::middleware::cleanup_expired`); a quick
   service restart re-arms it.
2. **One-shot manual cleanup** if the table grew large enough to
   slow down `lookup()`:
   ```sql
   DELETE FROM public.work_request_idempotency WHERE expires_at < now();
   VACUUM ANALYZE public.work_request_idempotency;
   ```

### Hash regression

If `canonical_request_hash` was recently changed, the previously
stored hashes are obsolete. Two options:

1. **Roll back the hash change** (preferred — preserves replay
   semantics for in-flight requests).
2. **Truncate the table** and accept that all in-flight replays will
   re-execute once. Only safe if the affected routes are idempotent
   at the SQL level (most are; verify before truncating).

### Load-test guidance

The integration-test rig has a `work_idempotency_replay.rs` driver
that exercises:

- Same key + same hash → replay (counter inc).
- Same key + different hash → 409.
- Distinct keys → fresh execution every time.

Run it after any change to either the canonicalizer or the storage
schema:

```bash
pnpm test:integration -t idempotency
```

A hash regression shows up here as a 409 on input that should have
replayed; a sweeper regression shows up as in-flight replays that
should have expired but didn't.

## Escalation

- **Drift sustained for 30min** — open a ticket and tag the relevant
  client team (FE for `/api/v1/work/*`, agent for `/api/v1/sap/*`).
- **Drift PAIRED with a 409 rate spike** — escalate to a P1; the
  hash regression is likely active and clients are getting failures
  instead of clean replays.
- **Drift PAIRED with `WorkServiceHealthFailing` (5xx rate)** — the
  retry storm is amplifying load. Roll back the suspected trigger
  commit and re-evaluate; do NOT raise the alert threshold.

## Related metrics + dashboards

- `work_idempotency_hits_total{route}` — the alert's source. The
  `route` label is the request's matched path; bounded by axum's
  `MatchedPath`.
- `work_idempotency_cleanup_total` — rows deleted per sweep pass.
  If this stops incrementing for > 1 hour, the sweeper has wedged.
- `work_http_requests_total{status="409"}` — paired indicator for
  the hash-regression case.
- `work_http_requests_total{status=~"4.."}` — broader 4xx pattern;
  helps distinguish "client problem" from "server problem".

Grafana dashboard: `work-engine / rust-work-service`
(`docs/runbooks/work-engine/dashboards/rust-work-service.json`,
panel **Idempotency Replay Health**).

## Related

- [Runbook — Service Health Failing](./service-health-failing.md) —
  sibling alert; idempotency drift sometimes precedes a 5xx storm.
- [Implementation — Phase 2 telemetry foundation](../../../memorybank/OmniFrame/Implementations/Implement-Rust-Work-Service-Phase2.md)
  — the implementation note that locked in this alert.
