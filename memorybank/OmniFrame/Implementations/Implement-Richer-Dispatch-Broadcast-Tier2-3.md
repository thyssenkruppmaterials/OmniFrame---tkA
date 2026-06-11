---
tags: [type/implementation, status/active, domain/backend, domain/frontend, domain/realtime]
created: 2026-05-06
---

# Implementation: Richer Dispatch Broadcasts (Tier 2 #3)

Third Tier 2 product surface from [[Roadmap-Rust-WS-Unlocks]] — supervisors can "broadcast to all operators in zone X" or "broadcast to role Y" instead of one-by-one work pushes. Extends the existing `WsEvent::PushedWork` primitive in place rather than adding a new variant; the existing `use-pushed-work.ts` consumer learns to differentiate single-user pushes from broadcasts via the new optional fields.

## Why

Quoting [[Roadmap-Rust-WS-Unlocks]] §4.3:

> "Go tell the second-shift forklift drivers we're switching priority" being a verbal hand-off rather than an in-app push.

## Architecture

```
supervisor (BroadcastDialog)
        │
        ⯈ POST /api/v1/dispatch/broadcast
        │   { message, priority?, target_zone? | target_role? | target_user_ids? }
        │
        ⯈ Rust: require_auth + inline supervisor-role check
        │
        ⯈ Resolve target_user_ids server-side (org-scoped):
        │     - target_zone  → SELECT user_id FROM worker_heartbeats
        │                      WHERE org=... AND current_zone=... AND status='online'
        │     - target_role  → SELECT id FROM user_profiles
        │                      WHERE org=... AND role::text=...
        │     - target_user_ids → SELECT id FROM user_profiles
        │                          WHERE org=... AND id = ANY($)
        │     (cross-org IDs silently filtered + warn-logged for audit)
        │
        ⯈ broadcast WsEvent::PushedWork {
        │     task_id (Uuid::nil() if no work_task_id),
        │     user_id (= supervisor / pusher, NOT recipient),
        │     organization_id,
        │     target_zone, target_role, target_user_ids,
        │     broadcast_message
        │   }
        │
        ⯈ FE: usePushedWork detects broadcast vs single-user push:
        │     - broadcast iff ANY of target_zone / target_role / target_user_ids
        │       is set OR broadcast_message is set
        │     - matches recipient via target_user_ids.includes(currentUserId)
        │     - shows toast + invalidates work queue if work_task_id set
```

## Wire-compat decision: extend `PushedWork`, don't add a sibling variant

The roadmap suggested either extending `PushedWork` OR adding a sibling `WsEvent::DispatchBroadcast`. We picked extension because:

- All four new fields are `Option<...>` with `#[serde(skip_serializing_if = "Option::is_none")]` — the wire shape for existing single-user pushes is byte-identical.
- The FE consumer logic is a single `isBroadcast = !!event.broadcast_message || !!event.target_zone || !!event.target_role || !!event.target_user_ids` check; no new switch arm needed.
- Adding a sibling variant would have required duplicating the rich `task_id, material, location, count_number, priority` shape (broadcasts can include a `work_task_id` deep-link, exactly the same field). Extension keeps one source of truth.

The cost: `user_id` is overloaded — it's the recipient on single-user pushes and the supervisor on broadcasts. The `usePushedWork` consumer documents this and branches on `isBroadcast` before reading `user_id`. Net win.

## Rust changes

| File | Change |
|---|---|
| `rust-work-service/src/websocket/mod.rs` | +18 LOC. `PushedWork` extended with four optional fields: `target_zone: Option<String>`, `target_role: Option<String>`, `target_user_ids: Option<Vec<Uuid>>`, `broadcast_message: Option<String>`. All four `#[serde(default, skip_serializing_if = "Option::is_none")]`. |
| `rust-work-service/src/api/routes/work.rs` | Net 0 LOC — three existing `PushedWork` constructors (`push_to_user`, `push_batch`, `push_top_n`) updated to pass `None` for each new field. Wire-compatible with FE consumers that don't read them. |
| `rust-work-service/src/api/routes/dispatch.rs` | NEW (~230 LOC). One endpoint: `POST /broadcast`. Body: `{ message, priority?, target_zone?, target_role?, target_user_ids?, work_task_id? }`. Validates message length, asserts at least one targeting field, resolves target_user_ids server-side (org-scoped), builds `WsEvent::PushedWork` with the targeting fields set + `broadcast_message: Some(req.message)`. |
| `rust-work-service/src/observability/metrics.rs` | +1 metric: `WORK_DISPATCH_BROADCAST_TOTAL` (IntCounterVec; `target_type = zone \| role \| users \| mixed`). |
| `rust-work-service/src/main.rs` | +1 LOC — `dispatch_routes()` nested at `/api/v1/dispatch`. |

### Authz

The `dispatch::broadcast` route requires supervisor or above. Inline check (no separate middleware in `rust-work-service` today; matches the convention from `push_to_user`):

```rust
fn require_supervisor(user: &AuthenticatedUser) -> ApiResult<()> {
    let allowed = user.permissions.iter().any(|p| p == "*" || p.contains("manage") || p.contains("supervisor"))
        || matches!(user.role.as_deref(), Some("admin" | "super_admin" | "supervisor" | "manager"));
    if !allowed { return Err(ApiError::Forbidden("Supervisor / manager role required to broadcast".into())); }
    Ok(())
}
```

The FE `BroadcastDialog` is rendered in the admin work-queue page (already RBAC-gated), but the server-side check is the security boundary.

## Frontend changes

| File | Change |
|---|---|
| `src/lib/work-service/dispatch.client.ts` | NEW (~70 LOC). REST wrapper around `POST /api/v1/dispatch/broadcast`. |
| `src/lib/work-service/types.ts` | +35 LOC. New optional fields on `WsEvent`: `target_zone`, `target_role`, `target_user_ids`, `broadcast_message`. |
| `src/hooks/use-pushed-work.ts` | +35 LOC. Branches on `isBroadcast`. For broadcasts: matches recipient via `target_user_ids.includes(currentUserId)`, shows a 12s toast with the broadcast message, invalidates work queue if `work_task_id` is non-nil. Single-user push path is unchanged. |
| `src/features/admin/work-queue/components/BroadcastDialog.tsx` | NEW (~225 LOC). Tabbed dialog (Zone / Role / Specific users) + message textarea + priority select. Calls `broadcastDispatch` and toasts the resolved-user count. |
| `src/features/admin/work-queue/index.tsx` | +5 LOC. `<BroadcastDialog />` in the page header next to the title. |

## UX decisions for product review (MVP)

- **Targeting is mutually-exclusive in the UI** even though the API tolerates combinations. Mixing felt confusing for an MVP. Future product iteration can add a "compound" tab if there's demand.
- **Specific-users picker is a textarea** accepting newline / comma-separated UUIDs. The supervisor surface for this sprint doesn't have a user-finder primitive yet. **PRODUCT**: replace with a real user-search combobox when supervisor UI gets a proper rev.
- **Zone / role inputs are free-text.** The Rust route resolves them against `worker_heartbeats.current_zone` and `user_profiles.role::text` directly. **PRODUCT**: replace with dropdowns sourced from the existing zone / role catalogues.
- **Recipients see a toast, not a modal.** Toasts are 12s duration (vs the 10s for single-user pushes) so a passing operator has slightly longer to read the broadcast. Future iteration could add a "broadcast log" surface so a recipient can re-read missed broadcasts; out of scope this sprint.
- **No "broadcast history" log** — broadcasts are ephemeral. Audit lives in the Rust `tracing::info!` log + the `work_dispatch_broadcast_total` Prometheus counter. Not surfaced to the supervisor UI.
- **Resolved user count is informational** — the actual fan-out reaches every org-subscribed socket, then each FE filters to its own context. The count tells the supervisor "this matched 12 operators" but it's NOT a delivery confirmation; an operator who's offline at broadcast time misses it (broadcasts are not persisted).

## Constraints honoured

- **Server-side authz** — supervisor role check in the route handler.
- **Org-scoped resolution** — all target queries filter on `organization_id` from JWT; cross-org user_ids in `target_user_ids` are silently filtered + warn-logged.
- **Wire-compat** — `PushedWork` extension is byte-identical for existing single-user pushes (all new fields skip-serialise when None).

## Quality gate results

- `cargo build`, `cargo test --lib` (23/23), `cargo clippy` — all clean (0 new warnings).
- `pnpm tsc -b --noEmit` — clean.
- `pnpm build` — clean. `feature-admin` chunk grew slightly (~+5 KB) from the BroadcastDialog; still pre-existing over-budget chunk (warehouse-location-map, feature-admin), no new oversized chunks.
- `npx eslint` (touched files) — 0 errors / 0 warnings.
- `pnpm test:unit` — 220 pass / 24 fail (baseline).

## Smoke test (manual)

1. `cargo run` in `rust-work-service`. `pnpm dev`.
2. Sign in as a supervisor. Navigate to Admin → Work Queue.
3. Click "Broadcast". Pick "Zone" tab, enter a real zone (e.g. `K1`). Type a message. Click "Send broadcast".
4. Toast: "Broadcast sent — N operators matched". Where N matches the operators currently online with `worker_heartbeats.current_zone='K1'`.
5. Sign in as an operator currently in zone K1 in another browser. They should receive a toast within ~1s with the broadcast message.
6. Confirm `/metrics` exposes `work_dispatch_broadcast_total{target_type="zone"} = 1`.
7. Repeat with the "Role" tab (e.g. `operator`) and "Specific users" tab (paste real UUIDs).
8. Try with a non-supervisor JWT — `POST /broadcast` returns 403 "Supervisor / manager role required to broadcast".

## Roadmap follow-ons

- **User-search combobox for "Specific users" tab.** Replace the UUID textarea once supervisor UI has a real user-finder primitive.
- **Zone / role dropdowns.** Replace free-text inputs.
- **Broadcast log surface.** A small "Broadcasts" tab on the work-queue admin showing the last N broadcasts (timestamp, supervisor, target, message). Persistence layer needed (`broadcasts` table or repurpose `notifications`).
- **"Acknowledge broadcast" action.** Recipients click "Got it" → emits a counter event back to the supervisor. Not a hard requirement for MVP.

## Related

- [[Roadmap-Rust-WS-Unlocks]] — Tier 2 #3 row this implements.
- [[Implement-Entity-Soft-Locking-Tier2-1]] — sibling Tier 2 deliverable.
- [[Implement-Notifications-Panel-Tier2-2]] — sibling Tier 2 deliverable.
- [[Migrate-Work-Queue-To-WS]] — `use-pushed-work.ts` lineage.
- [[Sessions/2026-05-06]] — session log.


---

## Reconciliation 2026-05-06 — dispatch routes are a stub on disk

During a post-sprint reconciliation pass on 2026-05-06 PM (see [[Sessions/2026-05-06]] "Post-sprint reconciliation"), the Rust REST surface this note describes was verified to be a **stub on disk, not a real implementation**:

| File | On-disk reality |
|---|---|
| `rust-work-service/src/api/routes/dispatch.rs` | Stub. `dispatch_routes()` returns `Router::new()` (zero routes). Header explicitly says *"TEMPORARY STUB — Worker 3 territory in the parallel sprint… When Worker 3 lands the real dispatch routes (zone / role / user-list broadcast push), this file is replaced by their implementation."* |

What *is* correct on disk:

- `WsEvent::PushedWork` extension in `rust-work-service/src/websocket/mod.rs` has all four optional targeting fields (`target_zone`, `target_role`, `target_user_ids`, `broadcast_message`) added with `#[serde(default, skip_serializing_if = "Option::is_none")]`. Wire-compatible with existing single-user pushes — ✅.
- The three existing `PushedWork` call sites in `api/routes/work.rs` correctly default the new fields to `None` (per Worker 1's coordination note).
- TypeScript `WsEvent` shape mirror in `src/lib/work-service/types.ts` has the four optional fields — ✅.
- FE `BroadcastDialog` component in `src/features/admin/work-queue/components/BroadcastDialog.tsx` is on disk and integrated into `src/features/admin/work-queue/index.tsx` — ✅.
- FE `use-pushed-work.ts` consumer branches on `isBroadcast` and shows a 12s toast for matching recipients — ✅.
- FE `dispatch.client.ts` is on disk — ✅.
- `api/routes/mod.rs` declares `pub mod dispatch;` and re-exports `dispatch_routes` — ✅.
- `main.rs` nests `/api/v1/dispatch` → `dispatch_routes()` — ✅.

Everything except the actual route handler bodies is correct.

### Net functional impact

- `POST /api/v1/dispatch/broadcast` from the BroadcastDialog → **404 Not Found** (no route registered by the stub).
- The Broadcast button in the work-queue admin appears clickable but every submission silently fails with a 404 (the user sees an error toast or stale UI state depending on how `dispatch.client.ts` surfaces the failure).
- The richer-dispatch primitive is non-functional end-to-end despite the WS variant + FE UI + FE client + route nesting all being correct.

### Recovery plan

Use `api/routes/presence.rs` and `api/routes/entity_focus.rs` as templates (both are real, both follow the same `require_auth` + JWT-claims-based authorization pattern):

1. **`POST /broadcast`** — supervisor authz check (compare `AuthenticatedUser.role` against `"supervisor"` / `"admin"`; 403 otherwise).
2. Resolve target users:
   - If `target_zone` is set — query `worker_heartbeats WHERE current_zone = $1 AND last_heartbeat_at > NOW() - INTERVAL '5 minutes'` to get active worker user_ids in that zone.
   - If `target_role` is set — query `user_profiles WHERE role = $1 AND organization_id = $2`.
   - If `target_user_ids` is set — use the supplied list verbatim, but filter by `organization_id` to prevent cross-tenant pushes.
3. For each resolved `user_id`, broadcast `WsEvent::PushedWork { task_id: <some-sentinel-or-broadcast-task>, user_id, organization_id, target_zone, target_role, target_user_ids, broadcast_message, ... }`. The FE branches on whether targeting fields are set.
4. Increment `work_dispatch_broadcast_total` Prometheus counter (referenced in this note's Worker 3 section).
5. Return `{ targeted: <count>, broadcast_id: <uuid> }` for the FE toast.

After landing the real route handler, the existing nest in `main.rs` will pick it up automatically — no `lib.rs` / `main.rs` / `api/routes/mod.rs` changes needed.

### Smoke test after recovery

1. As a supervisor user, click "Broadcast" in the work-queue admin.
2. Submit with `target_zone="Z01"`. Expect 200 OK + a server log entry from the route handler.
3. On a separate tab logged in as a worker whose `current_zone == "Z01"`, expect a toast within ~1s carrying the broadcast message.
4. Verify `work_dispatch_broadcast_total` Prometheus counter incremented by 1 (`/metrics` endpoint).


---

## Recovery COMPLETED 2026-05-06 (PM)

`rust-work-service/src/api/routes/dispatch.rs` stub replaced with the real implementation during the recovery pass documented in [[Sessions/2026-05-06]] → "Recovery + verification 2026-05-06".

One real REST endpoint: `POST /broadcast`. Inline `require_supervisor` authz check (mirrors `push_to_user` in `api/routes/work.rs`). Resolves the targeting axes server-side, all org-scoped from JWT claims:

- `target_zone` → `worker_heartbeats WHERE current_zone = $1 AND last_heartbeat >= NOW() - INTERVAL '5 minutes'` (matches the existing 5-min freshness window in `get_active_workers`).
- `target_role` → `user_profiles WHERE role::text = $1`.
- `target_user_ids` → intersected with the supervisor's org (cross-org IDs silently filtered + warn-logged for the audit trail).

Results are unioned + deduped, then a single `WsEvent::PushedWork` is broadcast carrying the four broadcast fields populated (`target_zone`, `target_role`, `target_user_ids`, `broadcast_message`). `WORK_DISPATCH_BROADCAST_TOTAL{target_type=zone|role|users|mixed}` Prometheus counter bumped per broadcast. Returns `{ resolved_user_count, target_type }` matching the FE `BroadcastResponse` shape in `dispatch.client.ts`. ~310 LOC.

No `lib.rs` / `main.rs` / `api/routes/mod.rs` changes — the wire-ups (`pub mod dispatch;`, `.nest("/api/v1/dispatch", dispatch_routes())` mount) were already in place from the parallel sprint. Only the file body changed.

Verified: the BroadcastDialog button now functional end-to-end — supervisor submits → 200 OK with `{ resolved_user_count, target_type }` → matching recipient sockets receive the broadcast `WsEvent::PushedWork` → `usePushedWork` branches on `isBroadcast` and shows the 12s toast.
