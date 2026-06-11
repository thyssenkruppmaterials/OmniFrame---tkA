# Runbook — WS Auth Failure (org_mismatch)

**Symptom.** Prometheus alert `WorkWsAuthFailureOrgMismatch` fires
because `work_ws_auth_failure_total{reason="org_mismatch"}` was
incremented in the last 1min. The corresponding `tracing::warn!` line
in the work-service log is:

```
ws subscribe org mismatch — closing socket
  token_org=…
  requested_org=…
  metric=work_ws_auth_failure_total
  reason=org_mismatch
```

This means a client connected with a `WS-Subscribe-Token` minted for
org A and then sent a `Subscribe { organization_id: B }` message with
B ≠ A. The work-service handler closes the socket without delivering
events (defence-in-depth holds — no cross-tenant leak), but the
attempt itself is a **security event**: page on the first occurrence.

## Likely causes

1. **FE bug — token reuse across user-switch.** A user signed out and
   back in with a different account whose default org differs, but the
   `WorkServiceWebSocket` singleton retained the prior `WS-Subscribe-Token`
   and reused it after the new sign-in's `Subscribe`. (FE invariant:
   `singletonAuthManager` should call
   `workServiceWs.disconnect()` on sign-out so the token is dropped.)
2. **FE bug — Subscribe race.** A user has multiple tabs open across
   two orgs (e.g. consultant flipping between client envs); a tab in
   org A picked up a token broadcast from a peer tab in org B via
   shared `BroadcastChannel` / localStorage. Cross-tab token sharing
   is NOT supported — each tab MUST mint its own.
3. **Stale token on backgrounded tab.** A tab was suspended for >1h,
   the user switched orgs in another tab, the suspended tab woke and
   re-subscribed using the stale token. Symptom is bursty (one alert
   per wake) rather than sustained.
4. **Deliberate cross-tenant attempt.** A malicious or curious user
   manually crafted a Subscribe message with a different `organization_id`.
   The handler refuses; we still want to know who.
5. **Token-mint regression.** A recent `POST /api/v1/work/ws-token`
   change started embedding the wrong `organization_id` claim. Cross-
   reference the `Subscribe` org with `user_profiles.organization_id`
   for the `user_id` carried in the token.

## Triage queries

### Prometheus

Confirm the alert is current and identify which org_hash is involved:

```promql
sum(rate(work_ws_auth_failure_total{reason="org_mismatch"}[5m])) by (reason)
```

Cross-reference with the per-org subscriber gauge to see whether the
attempt is concentrated on one org:

```promql
sum(work_websocket_subscribers) by (org_hash)
```

### Work-service logs

```bash
railway logs rust-work-service --since 30m \
  | grep 'ws subscribe org mismatch' \
  | tail -50
```

Each line includes `token_org`, `requested_org`, and (because the
upgrade carried a token) the issuing user via the upstream
`tracing::info!` "WebSocket connection request received" lines. Match
on timestamp to identify the user.

### Database

Once you have the `user_id` from the log, confirm membership:

```sql
SELECT id, organization_id, role, last_sign_in_at, raw_user_meta_data->>'email' AS email
  FROM auth.users u
  JOIN public.user_profiles p ON p.id = u.id
 WHERE u.id = '<user_id from log>';
```

Cross-reference with the audit trail of org switches:

```sql
SELECT changed_at, old_org_id, new_org_id, changed_by
  FROM public.user_org_changes
 WHERE user_id = '<user_id>'
 ORDER BY changed_at DESC
 LIMIT 10;
```

(If `user_org_changes` doesn't exist in your env, fall back to the
`user_profiles` history via `pg_audit` or the deploy log of the
relevant migration.)

## Mitigation

### Per-incident

1. **Confirm the failure was rejected.** The handler closes the socket
   on org_mismatch (`break;` out of the receive loop after counter
   inc). Check the corresponding `WebSocket client disconnected` line
   that follows the warning — its absence would be a P0.
2. **Check for a downstream burst.** If the client is in a reconnect
   loop, the same `(token_org, requested_org)` pair will repeat at
   short intervals. The FE singleton has a backoff but a regression
   could remove it. Check
   `rate(work_ws_auth_failure_total[1m])` — sustained > 1/s ⇒ FE bug.
3. **Talk to the user.** Once you have the user_id, reach out
   directly. "Are you currently switching between orgs?" is usually
   the answer; if not, treat as a security event.

### FE-side fix (most likely path)

Audit the cross-tab broadcast plumbing in
`src/lib/work-service/websocket.ts` and the
`src/lib/auth/singleton-auth-manager.ts`:

- Sign-out MUST trigger `workServiceWs.disconnect()` AND clear the
  cached token.
- Cross-tab `BroadcastChannel` MUST NOT relay the token — only
  reconnect signals.
- The Subscribe message MUST be mint-time-locked to the current
  user's org (don't read from a global org-id var that might be
  in-flight stale).

### Server-side fix (rare)

If the issue is the token-mint claim, the regression is in
`rust-work-service/src/api/routes/work.rs::ws_token_handler`. Check
the recent diff:

```bash
git log -p --since='1 week' -- rust-work-service/src/api/routes/work.rs \
  | grep -E '\borganization_id\b|\bws_token\b'
```

Roll back if the diff doesn't pass review.

## Escalation

- **First fire** — page Phase-4 on-call. Confirm the affected user
  is real and the token wasn't leaked via cross-tab sharing.
- **Sustained fire (>1 increment/min for 10min)** — escalate to the
  full security on-call. A reconnect-storm bug in the FE is a P1; an
  actual cross-tenant attempt is a P0.
- **Multiple distinct `(token_org, requested_org)` pairs in 1h** — go
  hunt the FE for token-cache leaks. Do NOT relax the alert
  threshold; the cost of a real cross-tenant leak is much higher than
  the cost of false-positive pages.

## Related metrics + dashboards

- `work_ws_auth_failure_total{reason}` — the alert's source. Other
  `reason` labels (`bad_sig`, `expired`, `missing_token`) are
  bucketed separately and don't trip this alert; they're tracked on
  the dashboard for context.
- `work_websocket_subscribers{org_hash, task_type}` — current
  subscribers; a sudden drop in the affected org_hash alongside an
  org_mismatch fire confirms the rejected client was bouncing.
- `work_http_requests_total{route="/api/v1/work/ws-token"}` —
  token-mint volume. A spike here paired with org_mismatch is a
  signature of "FE in a reconnect loop, minting a new token each
  cycle".

Grafana dashboard: `work-engine / rust-work-service`
(`docs/runbooks/work-engine/dashboards/rust-work-service.json`,
panel **WebSocket Auth Failures**).

## Related

- [Runbook — WS Lagged Events](./ws-lagged-events.md) — the sibling
  alert; sometimes a reconnect-storm shows up on both.
- [ADR — Presence Architecture Next Steps](../../../memorybank/OmniFrame/Decisions/ADR-Presence-Architecture-Next-Steps.md)
  — the cross-tenant leak that motivated the WS-Subscribe-Token gate
  in the first place.
- [Implementation — Migrate Tier 1 Deferred Channels to Rust WS](../../../memorybank/OmniFrame/Implementations/Migrate-Tier1-Deferred-Channels-To-Rust-WS.md)
  — the cutover that made cross-tenant defence-in-depth a hard
  requirement.
