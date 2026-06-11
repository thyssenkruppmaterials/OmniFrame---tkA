# Runbook — Work Service Health Failing

**Symptom.** Prometheus alert `WorkServiceHealthFailing` fires when the
5xx-rate of HTTP responses from rust-work-service exceeds 1% sustained
over 5min:

```promql
(
  sum(rate(work_http_requests_total{status=~"5.."}[5m]))
  /
  clamp_min(sum(rate(work_http_requests_total[5m])), 1)
) > 0.01
```

The `work_http_requests_total{route, method, status}` counter is
populated by the `track_http_metrics` axum middleware (Phase 2 of the
rust-work-service integration plan, 2026-05-06) for EVERY served
request — public + protected, including `/health`, `/metrics`, and
`/ws` upgrade attempts.

Critical severity: a sustained 5xx rate above 1% means the SAP
automation pipeline (post-Phase-4) is degraded for active users.

## Likely causes

1. **Database outage / saturation.** The PostgreSQL pool returns
   timeouts on `claim`, `push`, `complete` paths. Look for
   `work_claim_total{outcome="error"}` or
   `work_push_failure_total{reason="db_pool_timeout"}` spiking
   alongside the 5xx rate.
2. **Redis outage / saturation.** Presence + entity-focus + WS-token
   minting hit Redis. Watch `work_presence_redis_errors_total` and
   `work_entity_focus_redis_errors_total`.
3. **rust-core-service unavailable.** All protected routes go through
   the `require_auth` middleware which calls
   `state.auth_client.validate_token()` against rust-core-service. If
   rust-core is down, `/api/v1/*` routes return 401 (which is NOT
   5xx) — but `/api/v1/*` routes that depend on auth+org also return
   500 if the org-fallback DB query times out.
4. **Migration in flight blocking statements.** A long DDL on a hot
   table (`work_tasks`, `sap_agent_jobs`, `rr_cyclecount_data`) holds
   an `AccessExclusiveLock` and the route handlers time out.
5. **Recent deploy regression.** A handler started panicking on a
   specific input shape; the panic is mapped to 500 by the axum
   `ErrorHandler`. Check the deploy log for the most recent
   `rust-work-service` revision.

## Triage queries

### Prometheus

Identify which route is driving the 5xx rate:

```promql
topk(5,
  sum by (route, status) (rate(work_http_requests_total{status=~"5.."}[5m]))
)
```

Check the volume baseline (so you can tell whether 1% is "10 req/s of
errors" or "1000 req/s of errors"):

```promql
sum(rate(work_http_requests_total[5m]))
```

Cross-reference with the upstream-dependency error counters:

```promql
sum(rate(work_claim_total{outcome="error"}[5m]))
sum(rate(work_push_failure_total[5m])) by (reason)
sum(rate(work_presence_redis_errors_total[5m]))
```

Check service-level health:

```promql
up{job="rust-work-service"}
```

### Work-service logs

```bash
# 5xx-equivalent log lines: panic, sqlx error, redis error, axum
# tower-http TraceLayer span ending with ERROR.
railway logs rust-work-service --since 15m \
  | grep -E 'ERROR|panic|sqlx::Error|redis::RedisError' \
  | tail -100
```

The `tower_http::trace::TraceLayer` is enabled in `main.rs` so each
request gets an `INFO`/`ERROR` span; filter on its `latency=` / `status=`
fields to find the slow + error-ridden routes.

### Database (likely culprit if the alert correlates with a deploy /
migration window)

```sql
-- Long-running statements (look for AccessExclusiveLock holders)
SELECT pid, age(clock_timestamp(), query_start), state, wait_event_type, wait_event,
       LEFT(query, 200) AS q
  FROM pg_stat_activity
 WHERE state != 'idle'
   AND query_start < now() - interval '30 seconds'
 ORDER BY query_start;

-- Lock contention
SELECT blocked_locks.pid AS blocked_pid,
       blocked_activity.usename AS blocked_user,
       blocking_activity.usename AS blocking_user,
       blocked_activity.query AS blocked_query,
       blocking_activity.query AS blocking_query
  FROM pg_locks blocked_locks
  JOIN pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
  JOIN pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
                              AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
                              AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
                              AND blocking_locks.pid != blocked_locks.pid
  JOIN pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
 WHERE NOT blocked_locks.granted;
```

### Railway

Check the deploy + restart history:

```bash
railway status -s rust-work-service
railway logs rust-work-service --since 1h | grep -E 'started|stopped|restarting'
```

## Mitigation

### Server-side (most common path)

1. **Roll back the most recent deploy** if the 5xx rate started
   within ~15min of a deploy. Railway: select the previous successful
   deploy in the dashboard and click "Rollback" — or
   `railway rollback rust-work-service <deploy-id>` via CLI.
2. **Restart the service** if logs show `panic`s without a clear
   diff trigger. `railway restart rust-work-service`. The Tier 1
   listeners (`sap_agents`, `sap_jobs`, etc.) auto-resync on startup.
3. **Verify the auth dependency.** `curl
   https://rust-core-service-production.up.railway.app/health` —
   if rust-core is degraded, fix THAT first (see its runbook).

### Database (when query is the bottleneck)

1. **Cancel the blocking statement** if it's a stale long-running
   query: `SELECT pg_cancel_backend(<pid>)` (graceful) or
   `pg_terminate_backend` (forceful).
2. **Pause the migration in flight.** If a `CREATE INDEX
   CONCURRENTLY` ran into a long lock, drop the in-progress index and
   re-schedule for a low-traffic window.

### Redis

1. **Check the bb8-redis pool health.** Redis errors propagate to
   500s on the entity-focus + presence routes. The pool max_size is
   10 in `main.rs`; if Redis is saturated AND the pool is exhausted,
   the second-order effect is queueing on `bb8::Pool::get()`.
2. **Restart the work-service** to drop and rebuild the pool if
   Redis recovered but the pool didn't auto-heal (rare; bb8 handles
   reconnect transparently in normal cases).

### Load-test guidance

The `tests/integration` harness has a `work_engine_load.rs` driver
that pushes synthetic claim+complete cycles at configurable rates.
Use `INTEGRATION_MODE=infra` against a staging copy of the production
DB schema to characterize the 5xx threshold for the next deploy:

```bash
INTEGRATION_MODE=infra pnpm test:integration:perf
```

Record the saturation point (req/s) at which the 5xx rate first
exceeds 1%; that's the implicit capacity the production deploy must
stay under.

## Escalation

- **5xx rate sustained > 5min and rising** — page the on-call
  immediately; this is the alert's purpose. Default to rollback
  unless there's a clear non-rollback fix in flight.
- **5xx rate sustained > 5% for any period** — escalate to the
  database team. The work-service alone shouldn't generate 5% of
  responses as 5xx; either a dependency is down or a hot-path
  query regressed.
- **5xx isolated to ONE route, all others healthy** — it's a
  per-handler regression. Roll back the handler-specific commit if
  the diff is clear; otherwise file a P1 and add a route-specific
  filter to the alert annotation while the team investigates.

## Related metrics + dashboards

- `work_http_requests_total{route, method, status}` — the alert's
  source. Cardinality is bounded because `route` is the matched-path
  template (e.g. `/api/v1/work/tasks/:id/complete`), not the raw URL.
- `up{job="rust-work-service"}` — service-up scrape. A `0` here
  means the scrape itself is failing — Prometheus can't tell us
  about 5xx rate because it can't reach the service. Bridges to
  the `WorkServiceScrapeFailing` alert (TODO — Phase 11 follow-up).
- `work_claim_total{outcome="error"}` — claim path errors;
  correlated with 5xx on `POST /api/v1/work/claim`.
- `work_push_failure_total{reason}` — push failures bucketed by
  reason.
- `work_presence_redis_errors_total`,
  `work_entity_focus_redis_errors_total` — Redis dependency
  health.

Grafana dashboard: `work-engine / rust-work-service`
(`docs/runbooks/work-engine/dashboards/rust-work-service.json`,
panel **HTTP Latency / Status Breakdown**).

## Related

- [Runbook — WS Lagged Events](./ws-lagged-events.md) — sibling
  alert. Sometimes a 5xx storm and lagged-events fire together
  (e.g. broadcaster wedge cascading into HTTP-handler latency).
- [Runbook — WS Auth Failure (org_mismatch)](./auth-failure-org-mismatch.md)
  — sibling auth-side alert.
- [ADR — rust-work-service Availability SLO](../../../memorybank/OmniFrame/Decisions/ADR-Rust-Work-Service-Availability-SLO.md)
  — the SLO this alert defends.
- [Implementation — Phase 2 telemetry foundation](../../../memorybank/OmniFrame/Implementations/Implement-Rust-Work-Service-Phase2.md)
  — the implementation note that introduced `work_http_requests_total`.
