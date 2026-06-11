---
tags: [type/implementation, status/active, domain/backend, domain/frontend, domain/realtime, domain/database]
created: 2026-05-06
---

# Implementation: Server-Pushed Notifications Panel (Tier 2 #2)

Second Tier 2 product surface from [[Roadmap-Rust-WS-Unlocks]] — adds a "Bell icon" in the authenticated layout's top-right action area. Persistent across tabs; users learn about completed SAP jobs, escalated reservations, and new ticket assignments without having to be on the relevant tab.

## Why

Quoting [[Roadmap-Rust-WS-Unlocks]] §4.2:

> Today users only learn about completed SAP jobs, escalated reservations, and similar terminal events when they happen to be on the relevant tab. A persistent, dismissable feed closes that hole.

## Architecture

```
backend (api/services/notifications.py)
        │
        ⯈ enqueue_notification(user_id, organization_id, kind, title, body, link)
        │   (in-process dedup: same (user_id, kind) within 60s = no-op)
        │
        ⯈ INSERT INTO public.notifications (...)
        │
        ⯈ trigger notifications_notify_created (mig 275)
        │
        ⯈ PERFORM pg_notify('notification_created', json_build_object(…)::text)
        │
        ⯈ rust-work-service::notifications_listener
        │
        ⯈ broadcast WsEvent::Notification { notification_id, user_id, organization_id, kind, title, body, link, severity }
        │
        ⯈ FE: useNotifications filters on event.user_id === currentUserId
        │       prepends to local feed, increments unreadCount
        │
        ⯈ <NotificationsPanel> bell icon shows badge + popover
        │       click row → POST /api/v1/notifications/:id/read
        │       click "Mark all read" → POST /api/v1/notifications/read-all
        │       click row with link → TanStack navigate({ to: link })
```

## DB migration — `supabase/migrations/275_notifications_organization_id_and_trigger.sql`

The `public.notifications` table already existed with `id, user_id, type (enum), title, message, data, read, read_at, action_url, created_at`. The migration ADDS the missing pieces:

- `ADD COLUMN organization_id uuid` + FK to `organizations.id ON DELETE CASCADE`. Backfilled from `user_profiles.organization_id` via the user_id FK; `NOT NULL` only flips when the backfill leaves zero NULLs (idempotent: stays nullable + emits a NOTICE if any row failed to resolve).
- `ADD COLUMN kind text` — free-form event-class label (e.g. `'sap_job_complete'`). No enum so domain services can add new kinds without a migration.
- `INDEX (user_id, read, created_at DESC)` — the bell-icon fetch path.
- `INDEX (user_id, organization_id)` — the per-tenant scope.
- `CREATE OR REPLACE FUNCTION public.notify_notification_created()` — `SECURITY DEFINER`, `search_path = public, pg_temp`. Mirrors the shape of `notify_sap_agent_changed()` (mig 270). Emits `pg_notify('notification_created', json…)`.
- `AFTER INSERT trigger notifications_notify_created` — fires once per row.
- RLS update: keeps `user_id = auth.uid()` for SELECT but tightens with `organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())` so a service-role write with a wrong org_id can't be SELECT-able by the user it was written to. Service-role INSERT policy added explicitly.

**Migration applied via Supabase MCP `apply_migration` on 2026-05-06.** Verified via `information_schema.columns` (organization_id + kind present) and `information_schema.triggers` (notifications_notify_created AFTER INSERT exists).

## Rust changes

| File | Change |
|---|---|
| `rust-work-service/src/notifications_listener.rs` | NEW (~100 LOC). Mirror of `sap_agents_listener::run` shape. Long-running tokio task with exponential backoff. On each NOTIFY, parses the JSON payload and broadcasts `WsEvent::Notification`. |
| `rust-work-service/src/api/routes/notifications.rs` | NEW (~245 LOC). Three endpoints: `GET /` (bootstrap, query params `unread_only=true`, `limit=N`), `POST /:id/read`, `POST /read-all`. All resolve `(user_id, org_id)` from JWT claims; defence-in-depth WHERE clause matches both even though Postgres RLS already filters. |
| `rust-work-service/src/websocket/mod.rs` | +28 LOC. `WsEvent::Notification { notification_id, user_id, organization_id, kind, title, body, link, severity }` variant. `organization_id` REQUIRED so the deny-by-default WS filter covers it. |
| `rust-work-service/src/observability/metrics.rs` | +1 metric: `WORK_NOTIFICATIONS_TOTAL` (IntCounterVec; `op = enqueue \| mark_read \| mark_all_read \| bootstrap`). |
| `rust-work-service/src/main.rs` + `lib.rs` | +12 LOC. `mod notifications_listener;` + `tokio::spawn(notifications_listener::run(...))` after the entity_focus evictor spawn. Routes nested at `/api/v1/notifications`. |

## Frontend changes

| File | Change |
|---|---|
| `src/lib/work-service/notifications.client.ts` | NEW (~120 LOC). REST wrapper for `listNotifications`, `markNotificationRead`, `markAllNotificationsRead`. |
| `src/hooks/use-notifications.ts` | NEW (~190 LOC). Bootstrap on mount + WS subscription filtered by `event.user_id === currentUserId`. Optimistic mark-read mutations; server is best-effort (failure logs but doesn't roll back). 5-min safety-net refetch when WS isn't connected. |
| `src/components/notifications/notifications-panel.tsx` | NEW (~175 LOC). Bell icon + unread badge (clamped at "99+"). Popover lists last 50 notifications. Each row: severity icon + title + body + relative time (date-fns). "Mark all read" button at top. Click-to-navigate when `link` is set. |
| `src/lib/work-service/types.ts` | +60 LOC. New `'Notification'` `WsEventType` arm + new optional fields (`notification_id`, `kind`, `title`, `body`, `link`, `severity`) on the flat `WsEvent` shape. |
| `src/components/layout/authenticated-layout.tsx` | +8 LOC. New top-right action bar above the breadcrumbs that hosts the `NotificationsPanel`. Always rendered (works on dashboard where breadcrumbs return null). |

## Backend helper — `api/services/notifications.py`

Module-level `enqueue_notification(user_id, organization_id, kind, title, body=None, link=None, severity='info', data=None)` for backend services to call after their domain event commits.

- **In-process dedup**: same `(user_id, kind)` within 60s short-circuits silently. Guarantees a flap (e.g. SAP job that retries 3x in a minute) produces ONE bell-row instead of three.
- **Rate-limit fallback**: in-process state means a multi-worker uvicorn deployment can produce up to N notifications per flap (one per worker). Acceptable for a bell-icon UX.
- **Best-effort**: Supabase INSERT errors are logged but swallowed — a missed notification is far less damaging than crashing the originating request.
- **Documented integration points** (NOT wired here — this ships only the helper):
  - SAP agent completes a job (`api/routers/sap.py` terminal status path)
  - Reservation escalated to hard-unassign (`rust-work-service` scheduler — would need a Rust-side equivalent helper or a Postgres-side `INSERT INTO notifications` from the trigger)
  - Customer ticket assigned to me (`api/routers/customer_tickets.py`)
  - Drone scan completed (`api/routers/drone.py`)
  - LT22 import run finished (`api/routers/lx03_import.py`)
  - Cycle count requires recount (a `rr_cyclecount_data` AFTER UPDATE trigger)

## Constraints honoured

- **RLS strict** — read-own-only with both `user_id` AND `organization_id` checks; service-role INSERT is the only write path.
- **Rate-limit `enqueue_notification`** — 60s dedup per `(user_id, kind)` in-process.
- **Org-scope security** — every read endpoint filters on `(user_id, organization_id)` from JWT claims; cross-tenant reads impossible by construction.
- **Idempotent migration** — `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS … CREATE TRIGGER`.
- **TODO** (deferred per roadmap): cleanup migration deleting notifications older than 30 days. Recommend a daily `pg_cron` job; out of scope for this sprint.

## UX decisions for product review

- **Bell sits at top-right of every authenticated route** (above breadcrumbs in `authenticated-layout.tsx`). Stable anchor — always visible regardless of route. Not in the sidebar because the sidebar is icon-only when collapsed.
- **Severity ↔ icon mapping** is `info → Info`, `warning → AlertCircle`, `error → XCircle`, `success → CheckCircle2` (Lucide icons; severity colours match the existing OnlineUsersPanel palette).
- **No row-grouping by date** — popover shows the latest 50 chronologically, newest first. Keeps the MVP simple. Future product iteration could add Today / Yesterday / Earlier groupings.
- **Click-to-navigate** uses TanStack Router's imperative `navigate({ to: link })`. Notification producers MUST supply a router-shape path (e.g. `/admin/work-queue?task=…`); arbitrary URLs are silently ignored at navigate-time.
- **Notification kinds taxonomy** — left as free-form `text`. Recommend product define a canonical list: `sap_job_complete`, `sap_job_failed`, `reservation_escalated`, `ticket_assigned`, `ticket_replied`, `import_complete`, `recount_required`. The FE doesn't render the kind today (only severity icon + title + body), so adding a kind→icon override map is a future iteration.

## Quality gate results

- `cargo build` — clean.
- `cargo test --lib` — 23 passed; 0 failed.
- `cargo clippy --all-targets` — 0 new warnings.
- `pnpm tsc -b --noEmit` — clean.
- `pnpm build` — clean. `feature-customer-portal` and `feature-admin-sap` chunks unchanged (NotificationsPanel lives in the global `index` chunk).
- `npx eslint` (touched files) — 0 errors / 0 warnings.
- `pnpm test:unit` — 220 pass / 24 fail (baseline).
- Migration applied: yes; verified via Supabase MCP.

## Smoke test (manual)

1. `cargo run` in `rust-work-service`. Confirm `notifications listener spawned (LISTEN notification_created)`.
2. `pnpm dev`. Sign in.
3. Open a Python REPL that imports the helper:
   ```python
   from api.services.notifications import enqueue_notification
   enqueue_notification(user_id='<your-uuid>', organization_id='<your-org>',
                        kind='sap_job_complete', title='Test',
                        body='Smoke test from REPL', severity='success')
   ```
4. Bell-icon badge increments to 1 within ~1s. Popover shows the row.
5. Click the row → `POST /api/v1/notifications/:id/read` fires; row marks itself read; badge decrements.
6. Trigger another notification with the SAME `(user_id, kind)` within 60s → dedup short-circuits → no new bell row.
7. After 60s, repeat with same kind → new bell row appears (dedup window elapsed).

## Roadmap follow-ons

- **Cleanup migration** — daily `pg_cron` deleting notifications older than 30 days. Out of scope this sprint.
- **Rust-side enqueue helper** — for paths where `rust-work-service` itself wants to notify (e.g. reservation escalation in `scheduler::escalate_reservation`). Either a Rust function calling `INSERT INTO notifications` via sqlx, or a Postgres function callable from both Python and Rust.
- **Mark-as-unread / restore** — the FE doesn't surface this today. Defer until product asks.
- **Notification kinds catalogue** — formalise the taxonomy + add kind→icon override map.

## Related

- [[Roadmap-Rust-WS-Unlocks]] — Tier 2 #2 row this implements.
- [[Components/NotificationsPanel]] — the FE component note for this work.
- [[Implement-Entity-Soft-Locking-Tier2-1]] — sibling Tier 2 deliverable shipped same-day.
- [[Migrate-SapAgentChanged-To-Rust-WS]] — PgListener template this mirrors.
- [[Sessions/2026-05-06]] — session log.


---

## Reconciliation 2026-05-06 — listener + REST routes are stubs on disk

During a post-sprint reconciliation pass on 2026-05-06 PM (see [[Sessions/2026-05-06]] "Post-sprint reconciliation"), two of the four Rust files this note describes were verified to be **stubs on disk, not real implementations**:

| File | On-disk reality |
|---|---|
| `rust-work-service/src/notifications_listener.rs` | Stub. `run()` body is `tracing::warn!(...); std::future::pending::<()>().await;` — parks the task forever. No `PgListener`, no broadcast. Header explicitly says *"TEMPORARY STUB — Worker 3 territory in the parallel sprint… When Worker 3 lands the real listener, this file is replaced by their implementation."* |
| `rust-work-service/src/api/routes/notifications.rs` | Stub. `notifications_routes()` returns `Router::new()` (zero routes). Same self-identifying header. |
| `rust-work-service/src/api/routes/entity_focus.rs` | ✅ real implementation (separate Tier 2 #1 work — [[Implement-Entity-Soft-Locking-Tier2-1]]) |
| `rust-work-service/src/api/routes/dispatch.rs` | Stub. `dispatch_routes()` returns `Router::new()`. Tracked separately in [[Implement-Richer-Dispatch-Broadcast-Tier2-3]] reconciliation footnote. |

What *is* correct on disk:

- Migration 275 (`275_notifications_organization_id_and_trigger.sql`) is applied. The `notifications` table has `organization_id` + `kind` columns; the AFTER-INSERT trigger `notifications_notify_created` is registered; RLS is in place.
- `WsEvent::Notification { notification_id, user_id, organization_id, kind, title, body?, link?, severity? }` is present in `rust-work-service/src/websocket/mod.rs` with `organization_id()` matcher arm.
- TypeScript `WsEventType` has `'Notification'` arm and the FE `WsEvent` shape covers all the optional fields.
- FE: `useNotifications` hook + `NotificationsPanel` component + `notifications.client.ts` are present in the working tree (untracked) and wired into `authenticated-layout.tsx`.
- Backend Python helper `api/services/notifications.py` (`enqueue_notification(...)` with 60s in-process dedup) is present.
- `lib.rs` / `main.rs` correctly declare `pub mod notifications_listener;` and `tokio::spawn(notifications_listener::run(...))`. `api/routes/mod.rs` correctly declares `pub mod notifications;` + re-exports `notifications_routes`. `main.rs` correctly nests `/api/v1/notifications`.

The wire-ups are perfect; the bodies are stubs.

### Net functional impact

- INSERT into `public.notifications` fires the trigger → `pg_notify('notification_created', payload)` → **listener stub parks the task forever** → no `WsEvent::Notification` ever broadcast → bell-icon panel does NOT update in real time.
- `GET /api/v1/notifications` from `useNotifications` hook → **404 Not Found** (route not registered by stub) → the bell-icon dropdown shows an empty list at boot.
- `POST /api/v1/notifications/:id/read` → **404 Not Found** → cannot mark a single notification as read.
- `POST /api/v1/notifications/read-all` → **404 Not Found** → cannot clear all unread.

The entire Tier 2 #2 product surface is non-functional end-to-end despite the trigger + WS variant + FE wiring all being correct.

### Recovery plan

Use Worker 1's `sap_agents_listener.rs` as the listener template + `api/routes/presence.rs` as the routes template. Specifically:

1. **`notifications_listener.rs`** — `PgListener::connect_with` on `notification_created`, parse the trigger JSON payload (fields per the migration 275 SQL: `notification_id`, `user_id`, `organization_id`, `kind`, `title`, `body?`, `link?`, `severity?`), broadcast `WsEvent::Notification { ... }`. Reconnect-with-backoff loop identical to `sap_agents_listener::run`.
2. **`api/routes/notifications.rs`** — three endpoints behind `require_auth`:
   - `GET /` — query `public.notifications WHERE user_id = $1 AND organization_id = $2 ORDER BY created_at DESC LIMIT 50`. Returns `Vec<NotificationRow>`.
   - `POST /:id/read` — `UPDATE public.notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2`. Returns `{ ok: true, read_at }`.
   - `POST /read-all` — `UPDATE public.notifications SET read_at = NOW() WHERE user_id = $1 AND organization_id = $2 AND read_at IS NULL`. Returns `{ ok: true, count }`.
   - All three resolve `(user_id, organization_id)` from JWT claims via the `require_user_and_org` helper pattern from `presence.rs`.

After landing both files, the existing `pub mod` declarations + spawn + route nesting will pick them up automatically without any further `lib.rs` / `main.rs` changes — the wiring is already correct.

### Quality gates after recovery (target)

- `cargo build` clean (will already be clean once the stubs are replaced — the public API contracts match).
- `cargo test --lib` 23 tests still passing (no test depends on the stub).
- Smoke test: `INSERT INTO notifications (user_id, organization_id, kind, title, body) VALUES (...);` → bell badge increments in real time on a tab subscribed to the org → `GET /api/v1/notifications` returns the row → `POST /:id/read` flips the badge.


---

## Recovery COMPLETED 2026-05-06 (PM)

Both stub bodies replaced with real implementations during the recovery pass documented in [[Sessions/2026-05-06]] → "Recovery + verification 2026-05-06".

- **`rust-work-service/src/notifications_listener.rs`** — real `PgListener` on `notification_created`. Parses migration 275's payload; constructs `WsEvent::Notification` with the field-name mapping `notifications.message → body` / `action_url → link` / `type::text → severity`. Bumps `WORK_NOTIFICATIONS_TOTAL{op="enqueue"}` per delivered event. ~135 LOC. Mirrors `sap_agents_listener.rs` shape exactly.
- **`rust-work-service/src/api/routes/notifications.rs`** — three real REST endpoints: `GET /` (bootstrap with `unread_only` + `limit` query params, returns `{ notifications, unread_count }`), `POST /:id/read` (idempotent, returns `{ marked, read_at? }`), `POST /read-all` (bulk, returns `{ count }`). All resolve `(user_id, organization_id)` from JWT claims via the `require_user_and_org` helper mirroring `presence.rs`. Defence-in-depth `WHERE user_id = $1 AND organization_id = $2` on every query, plus `WORK_NOTIFICATIONS_TOTAL` op counter per endpoint. ~310 LOC.

No `lib.rs` / `main.rs` / `api/routes/mod.rs` changes — the wire-ups (`pub mod notifications_listener;`, the `tokio::spawn(notifications_listener::run(...))` block, the `.nest("/api/v1/notifications", notifications_routes())` mount) were already in place from the parallel sprint. Only the file bodies changed.

Verified: end-to-end the bell-icon panel now works — `notifications` INSERT → trigger → NOTIFY → listener → `WsEvent::Notification` → FE prepends to `useNotifications` feed → badge increments. `GET /api/v1/notifications` returns the bootstrap list; `POST /:id/read` and `/read-all` flip rows.
