---
tags: [type/implementation, status/active, domain/frontend, domain/realtime]
created: 2026-05-06
---

# Implementation: Harden Browser-Side Presence Service Against Tenant Overload

## Why

Follow-up to the agent v1.8.4 fix ([[Debug/Fix-Realtime-Tenant-Overload]]). The Customer Portal's always-on `<PresenceProvider>` was the originally-named source of the `Presence_shard112` GenServer crash for tenant `c9d89a74`. See [[Debug/Fix-CustomerPortal-Presence-Tenant-Overload]] for the full audit + diagnosis.

## Scope

Surgical hardening inside `src/lib/presence/`. No schema, no migration, no RLS, no consumer hooks changed. The contract between `PresenceService` and `usePresenceTracker` / `usePresence` is unchanged.

## Changes

### `src/lib/presence/constants.ts` — rewrite (~140 LOC)

- Added: `DB_HEARTBEAT_INTERVAL_HIDDEN = 5 * 60_000` (5× backoff when tab hidden).
- Added: `TRACK_DEBOUNCE_MS = 1_500` (track-call coalescing window).
- Added: `CHANNEL_ERROR_WINDOW_MS = 60_000`, `CHANNEL_ERROR_THRESHOLD = 3`, `CHANNEL_BREAK_INITIAL_COOLDOWN_MS = 5min`, `CHANNEL_BREAK_MAX_COOLDOWN_MS = 30min`, `CHANNEL_STABLE_CONNECTION_MS = 60s` — channel-error breaker tuning.
- Bumped: `PRESENCE_SYNC_THROTTLE` 500ms → 1000ms.
- Added: `PRESENCE_DISABLED_ENV` (resolves `import.meta.env.VITE_PRESENCE_DISABLED` at module load).
- Added: `PRESENCE_KIOSK_ROUTE_PATTERNS` + `isPresenceKioskRoute(pathname)` helper.
- Kept: all existing exports (`DB_HEARTBEAT_INTERVAL`, `IDLE_TIMEOUT`, `TAB_HIDDEN_TIMEOUT`, `PRESENCE_CHANNEL_PREFIX`, `PRESENCE_TOAST_THROTTLE`, `STATUS_PREFERENCE_KEY`, `CUSTOM_STATUS_KEY`).

### `src/lib/presence/presence.service.ts` — rewrite (~530 LOC)

- Renamed direct `.track()` / `.untrack()` calls to `scheduleTrack()` / `scheduleUntrack()` / `scheduleRetrack()`. All three schedule a single coalesced `flushTrack()` per `TRACK_DEBOUNCE_MS` window. `flushTrack()` always sends the LATEST payload and re-resolves `getEffectiveStatus()` so the local state can change between schedule and flush without sending stale data.
- Channel-error breaker: `recordChannelError()` keeps a rolling timestamp window; trips on threshold breach → untrack, `removeChannel`, schedule auto re-join after exponential cooldown + 250ms jitter. `consecutive_trips` counter resets to 0 once a connection survives `CHANNEL_STABLE_CONNECTION_MS` (timer scheduled inside `SUBSCRIBED` handler).
- Page-Visibility integration: `startVisibilityWatcher()` re-runs `startDbHeartbeat()` whenever `document.hidden` flips, which picks the correct cadence (`DB_HEARTBEAT_INTERVAL` vs `DB_HEARTBEAT_INTERVAL_HIDDEN`). `setStatus('offline')` calls `stopDbHeartbeat()` directly; `setStatus(<non-offline>)` after offline restarts it.
- Kill switch + kiosk opt-out: `initialize()` checks `PRESENCE_DISABLED_ENV` first, then `config.kioskRoute`. Either path stores user identity for downstream consumers but skips channel join + heartbeat + visibility watcher; `disabledReason` exposed via `isDisabled` / `disabledReasonValue` getters.
- Defensive `destroy()`: clears every timer (`syncThrottleTimer`, `trackDebounceTimer`, `stableConnectionTimer`, `dbHeartbeatTimer`), removes the visibility listener, best-effort untracks before `removeChannel`, resets all breaker state.

### `src/hooks/use-presence-tracker.ts` — +~10 LOC

- Added `import { isPresenceKioskRoute }`.
- `initialKioskRoute = useMemo(() => isPresenceKioskRoute(location.pathname), [])` (snapshotted once on mount; the deps array is intentionally empty so the kiosk decision is taken at mount time, not on every navigation).
- Passes `kioskRoute: initialKioskRoute` into `presenceService.initialize()`.
- Added `initialKioskRoute` to the init effect's deps array so a subsequent re-mount re-evaluates.

### `.env.example` — +~10 LOC

Added `# VITE_PRESENCE_DISABLED=true` block under the frontend env section, with the same "build-time inlined" caveat as the agent's `OMNIFRAME_DISABLE_REALTIME` documentation.

## Behaviour matrix — before vs after

| Scenario | Before | After |
|---|---|---|
| Single track call (e.g. status change) | 1 RPC | 1 RPC (after 1.5s debounce) |
| Status flip + custom-text edit + idle re-entry within 1s | 3 RPCs | 1 RPC |
| Reconnect storm (10 SUBSCRIBED in 5s) | 10 RPCs | ~3 RPCs |
| 3 CHANNEL_ERROR in 60s | retried indefinitely | breaker trips, channel removed, 5min cooldown, auto re-join |
| Tab hidden for 8 hours | 480 DB writes | ~95 DB writes |
| `Appear Offline` selected | DB heartbeat keeps writing | DB heartbeat stops |
| RF terminal mounted at `/rf-interface` | joins org channel + tracks | no channel, no heartbeat |
| `VITE_PRESENCE_DISABLED=true` | no effect | service no-ops at boot |

## Quality

- `pnpm tsc -b --noEmit` — clean.
- `pnpm build` — clean in 9.59s; bundle-budget OK; PWA precache regenerated cleanly.
- `npx eslint` on touched files — 0 warnings, 0 errors.

## What was deliberately NOT done (Phase B)

- Multi-tab leader election via `BroadcastChannel` — the highest-leverage remaining win, but adds real complexity (leader handoff, crash recovery, state relay protocol). Deferred to a dedicated session.
- Visibility-permission-gated subscription — needs an org-policy hint at sign-in; not surgical-enough to fold into Phase A.
- Dropping `current_page` from the broadcast payload — product decision; the affordance is currently consumed by `OnlineUsersPanel` tooltips.

## Related

- [[Debug/Fix-CustomerPortal-Presence-Tenant-Overload]] — the diagnosis + recovery plan.
- [[Debug/Fix-Realtime-Tenant-Overload]] — agent-side companion (v1.8.4).
- [[Patterns/Realtime-Presence-Browser-Hardening]] — distilled pattern.
- [[Patterns/Async-Library-Circuit-Breaker]] — the broader breaker pattern.
- [[Components/PresenceUI - Status Indicators]] — consumer surface (unchanged).
- [[Sessions/2026-05-06]] — this session.


## Phase B2 + B3 follow-up (2026-05-06)

Two more surgical Phase B items shipped same-day, on top of the Phase A six-fix pass. Phase B1 (multi-tab leader election via `BroadcastChannel`) stays deferred — it's the highest remaining ROI but adds real complexity (leader handoff, crash recovery, state relay protocol). B2 and B3 were small-scope and high-leverage enough to fold in immediately.

### B2 — Visibility-permission-gated subscription

**Goal:** stop users with no need to participate in the org-wide presence channel from joining it. They wasted a Realtime worker slot and a `.track()` RPC per such session.

**Strategy chosen:** Strategy A (opt-out via a new `presence:hidden` permission). Picked over Strategy B ("query the org for any `presence:view*` user at sign-in and skip everyone if none") because it's surgical — no auth-flow change, no Supabase roundtrip at sign-in, no migration. The win is largest when admins want to opt SPECIFIC roles out of presence (e.g. a back-office automation role); Strategy B's win only materialises if the WHOLE org has presence disabled, which is the existing `VITE_PRESENCE_DISABLED` env-var fleet kill switch's job anyway.

**Logic** (in `useIsPresenceCandidate()` — see `src/hooks/use-presence-visibility.ts`):

| `presence:view` or `presence:view_details` | `presence:hidden` | Result |
|---|---|---|
| ✓ | * | candidate (sees others) |
| ✗ | ✗ | candidate (DEFAULT — be seen by view-permitted colleagues) |
| ✗ | ✓ | NOT candidate (skip channel entirely) |

Default behaviour for orgs that don't define `presence:hidden` is unchanged — every user stays a candidate, exactly as in Phase A.

**Wiring:**

- `src/lib/presence/constants.ts` — added `PRESENCE_PERMISSION_VIEW`, `PRESENCE_PERMISSION_VIEW_DETAILS`, `PRESENCE_PERMISSION_HIDDEN` constants so the candidate hook + visibility hook can never disagree about the wire string.
- `src/hooks/use-presence-visibility.ts` — added `useIsPresenceCandidate()` hook (separate from `usePresenceVisibility()` because the candidate hook is consumed by `usePresenceTracker()` BEFORE the presence context exists; touching the context would deadlock the provider). Updated the JSDoc on `usePresenceVisibility()` to document the new `presence:hidden` key.
- `src/lib/presence/presence.service.ts` — added a third `'permission'` value to the `DisabledReason` union, plus a third gate in `initialize()` after env + kiosk: `if (config.presenceCandidate === false) { this.disabledReason = 'permission'; ...; return }`. Order is **env → kiosk → permission** so a `/rf-*` route always reports `disabledReason='kiosk'` even if the user also lacks view permission (logs stay accurate).
- `src/hooks/use-presence-tracker.ts` — calls `useIsPresenceCandidate()` and passes the boolean to `presenceService.initialize({ ..., presenceCandidate })`. Added `candidateRef` ref + extended the same-org bypass guard to include the candidate value, and added `presenceCandidate` to the init effect's deps array. A permission-store hydration after mount (e.g. permissions arriving from the cache → DB roundtrip a beat after the provider mounts) re-runs the effect cleanly: previous `destroy()` → fresh `initialize()` with the new decision.

**Hook surface unchanged.** `usePresenceVisibility()` still returns the same `{ visibility, canViewPresence, canViewDetails, canViewCurrentPage, filteredOnlineState }`. Existing consumers (`optimized-app-sidebar.tsx`) don't need an edit.

### B3 — Drop `current_page` from broadcast payload

**Goal:** privacy + payload size win. Coworkers on the org-wide channel no longer see what URL another user is on, and the field shaves 30–50 bytes off every `.track()` RPC per member.

**Snapshot grep (B3 verification):**

```
src/lib/presence/types.ts:73           current_page: string | null   (PresencePayload)
src/lib/presence/types.ts:90           current_page: string | null   (PresenceUser)
src/lib/presence/presence.service.ts:196   current_page: window.location.pathname,   (initialize payload)
src/lib/presence/presence.service.ts:297   this.currentPayload.current_page = page   (updateCurrentPage method)
src/hooks/use-presence-visibility.ts:73    // Strip sensitive fields (current_page) ...
src/hooks/use-presence-visibility.ts:76    current_page: null,                       (basic-visibility stripDetails map)
```

No other consumers — `OnlineUsersPanel`, `StatusSelector`, `PresenceAvatar`, `StatusIndicator`, `optimized-app-sidebar`, and every other component or hook in the repo were already current_page-agnostic. Phase A had already stopped broadcasting it on every navigation (the `updateCurrentPage()` method only mutated the next-track payload, no extra RPC), so B3 is a clean removal.

**Changes:**

- `src/lib/presence/types.ts` — removed `current_page` from `PresencePayload` and `PresenceUser`. Added a 5-line block comment explaining WHY (privacy + payload size + the field is conceptually "local navigation, not presence"; consumers that genuinely want the local page should call `useLocation()` directly).
- `src/lib/presence/presence.service.ts` — dropped `current_page: window.location.pathname` from `initialize()`'s initial payload. Deleted `updateCurrentPage(page: string): void` entirely.
- `src/hooks/use-presence-tracker.ts` — removed the page-tracking `useEffect` that fired on every `location.pathname` change. `useLocation()` import stays — it still feeds `initialKioskRoute = useMemo(() => isPresenceKioskRoute(location.pathname), [])`.
- `src/hooks/use-presence-visibility.ts` — removed the `stripDetails` map for the `'basic'` visibility branch (nothing to strip anymore). Now `'basic'` returns `state` directly, identical to `'full'`. The visibility levels are kept as separate enum values so a future detail-only field can be reintroduced without a permission migration. `canViewCurrentPage` stays on the return type as a vestigial flag (kept to satisfy the constraint "the hook surface MUST stay the same") — its computed value is still `visibility === 'full'`, but no consumer reads it now that the field is gone.

**No fallback, no feature flag.** Clean removal.

## File deltas (Phase B2 + B3 specifically)

| File | Change |
|---|---|
| `src/lib/presence/types.ts` | -2 LOC (removed `current_page` from two interfaces) +6 LOC (block comment explaining the removal). |
| `src/lib/presence/constants.ts` | +~30 LOC (three permission-key constants with JSDoc). |
| `src/lib/presence/presence.service.ts` | +`'permission'` value on `DisabledReason` union + ~10 LOC `presenceCandidate` config docstring + ~8 LOC `'permission'` branch in `initialize()`. Removed: `current_page` line in initial payload (1 LOC), `updateCurrentPage()` method (10 LOC). Net: ~+15 LOC. |
| `src/hooks/use-presence-tracker.ts` | -5 LOC (removed page-tracking `useEffect`) +~30 LOC (extended JSDoc summary, `useIsPresenceCandidate` import + call, `candidateRef`, gate-check + cleanup tweaks, `presenceCandidate` in deps). Net: ~+25 LOC. |
| `src/hooks/use-presence-visibility.ts` | -~13 LOC (`stripDetails` map) +~55 LOC (rewritten module JSDoc, `useIsPresenceCandidate` hook, constants imports). Net: ~+42 LOC. |

## Quality (Phase B2 + B3)

- `pnpm tsc -b --noEmit` — clean (23s).
- `npx eslint src/lib/presence src/hooks/use-presence-tracker.ts src/hooks/use-presence-visibility.ts src/context/presence-context.tsx src/components/presence` — 0 warnings, 0 errors (1.2s).
- `pnpm build` — clean in 11.70s; PWA precache regenerated; no NEW bundle-budget regressions (the two pre-existing over-budget chunks `warehouse-location-map` and `feature-admin` are unrelated and were already over budget before Phase A).
- Unit tests — same 220-pass / 24-fail baseline as before B2/B3. The 24 failing tests are pre-existing (Supabase `storage.getItem` mock issue in security/RBAC tests) and do not involve presence; verified by re-running with the changes stashed.
- No presence tests exist (none did before either) — `pnpm vitest run src/lib/presence src/hooks/use-presence-tracker src/hooks/use-presence-visibility` reports "No test files found". Adding tests is a separate, higher-friction work item; the contract tests we'd want require a Supabase Realtime mock that doesn't exist in the repo today.

## What stayed Phase-A-only

Nothing was undone. The Phase A circuit breaker, debouncer, env kill switch, kiosk opt-out, visibility-aware heartbeat, and sync-throttle bump all keep working — the B2 permission gate is just another reason to set `disabledReason !== null`, and B3 is a payload trim. Composes additively on top of Phase A.

## What stays deferred (Phase B1)

Multi-tab leader election via `BroadcastChannel`. Highest remaining ROI on a power user with many tabs but adds real complexity (leader handoff on tab close + crash, state relay protocol, stale-leader detection). Deferred to a dedicated session.
