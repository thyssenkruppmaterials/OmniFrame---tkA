---
tags: [type/implementation, status/active, domain/frontend, domain/realtime]
created: 2026-05-07
---
# Implementation: Scoped Re-Enablement of `current_page` in Active Operators

FE-only sprint (no Rust changes) that partially restores `current_page` on the presence payload, scoped to a single RBAC-gated surface: the Active Operators panel inside the Inventory Counts tab. Realises [[ADR-Scoped-CurrentPage-In-ActiveOperators]].

## Why

Day-after follow-up to [[Harden-Presence-Service-Tenant-Overload]] Phase B3, which dropped `current_page` from the broadcast payload entirely for privacy + payload-size reasons. The user wanted the field back in **one** supervisor-visible surface where the privacy concern doesn't apply (the panel is already RBAC-gated by `view inventory_apps`). Full rationale + alternatives in the ADR.

## Step 1 — Rust pass-through verification (✅ transparent)

Before touching the FE I verified the Rust pipeline forwards unknown fields without inspection. Outcome: **no Rust release required.**

| File | Verified |
|---|---|
| `rust-work-service/src/api/routes/presence.rs` | `PresenceHeartbeatRequest` uses `#[serde(flatten)] pub payload: serde_json::Map<String, Value>`. Unknown fields accepted verbatim; no `deny_unknown_fields`. |
| `rust-work-service/src/presence/redis.rs` | `track_presence` stores the payload as `serde_json::Value` (not a typed struct). |
| `rust-work-service/src/websocket/mod.rs` | `WsEvent::PresenceJoined { … payload: serde_json::Value }` (and `PresenceUpdated`) carry the loose value through. |

Worker 1's deliberate "loose payload" design choice in [[Implement-Presence-On-Rust-Option-2]] ("The Rust side never inspects the payload's interior. Keeping it loose means a new field on the FE-side `PresencePayload` (custom emoji status, etc.) doesn't require a Rust release.") paid off on the very first FE field-shape change.

## Step 2 — Active Operators panel investigation

| Find | Result |
|---|---|
| Component file | `src/components/live-operator-status.tsx` (`<LiveOperatorStatus>`). |
| Mount site | `src/components/manual-counts-search.tsx` (the "Inventory Counts" tab inside `<InventoryManagement>`); rendered when the tab-local `showOperatorStatus` toggle is on (default `true`). |
| Route file | `src/routes/_authenticated/apps/inventory.tsx` — `beforeLoad: createStandardProtectedRoute('INVENTORY')`. |
| RBAC gate | `view inventory_apps` resource permission (from `ROUTE_PROTECTION_CONFIGS.INVENTORY` in `src/lib/auth/route-protection.ts`). |
| Data source | `useActiveWorkers()` (`src/hooks/use-active-workers.ts`) backed by `worker_heartbeats` via `workServiceClient.getWorkers()`. |

**Integration shape chosen:** keep `useActiveWorkers()` as the source of truth for "who is an operator" (it carries task / zone / location); call `usePresenceOptional()` alongside; per worker, look up `presence?.getUserPresence(worker.user_id)?.current_page`. NO denormalisation of `current_page` into `worker_heartbeats`.

## File deltas

| File | Change |
|---|---|
| `src/lib/presence/types.ts` | +`current_page: string \| null` on both `PresencePayload` and `PresenceUser`; +block comment explaining the privacy contract + the single permitted consumer + a hard rule against widening the consumer set without a new ADR. Net ~+22 LOC. |
| `src/lib/presence/presence.service.ts` (Supabase mode) | Seed `current_page` from `window.location.pathname` in the initial payload (with `typeof window !== 'undefined'` guard for tests); add `updateCurrentPage(page)` that mutates `currentPayload.current_page`, no-ops on equality, and routes through `scheduleTrack()`. Net ~+30 LOC. |
| `src/lib/presence/presence.service.rust.ts` (Option 2 / Rust mode) | Same shape as the Supabase counterpart — seed in initial payload + add `updateCurrentPage(page)` going through `scheduleHeartbeat()`. Both methods identical contract so the facade swap stays transparent. Net ~+30 LOC. |
| `src/lib/presence/route-features.ts` | NEW (~190 LOC). Exports `resolveFeature(pathname): { label, sublabel?, icon?, raw } \| null`. ~50 entries covering every top-level route group (`/apps/*`, `/admin/*`, `/business/*`, `/facility/*`, `/hr/*`, `/intelligence/*`, `/settings/*`) plus device-class routes (`/rf-interface/*`, `/timeclockapp`, `/customer-portal/*`) and auth/error routes. Order matters — most specific first, broad catch-alls last. Unknown URL → `{ label: 'Unknown', icon: 'HelpCircle', raw }` so the panel never silently swallows a missing entry. |
| `src/lib/presence/index.ts` | +1 LOC — `export { resolveFeature, type ResolvedFeature } from './route-features'`. |
| `src/hooks/use-presence-tracker.ts` | Added the route-tracking `useEffect` (gated on `initializedRef.current`). Calls `presenceService.updateCurrentPage(location.pathname)` on every navigation; the service's idempotence + `scheduleTrack()` debouncer handle the rest. Net ~+20 LOC. |
| `src/components/live-operator-status.tsx` | Added `usePresenceOptional()` call alongside `useActiveWorkers()`; threaded `currentPage` prop into `<OperatorCard>`; added a `feature = resolveFeature(currentPage)` line + a third row inside the card rendering icon + label + a Radix tooltip with the raw pathname for supervisor debugging. Trimmed-down icon imports (~12 lucide icons relevant to warehouse routes) with `Compass` fallback for unmapped names — keeps the bundle delta small. Net ~+85 LOC. |
| `src/hooks/use-entity-focus.ts` | +1 LOC for `current_page: null` in the `fallbackUser()` stub so the type-checker is happy. Stub users (those NOT in the presence channel) have no navigation context to render. |

## Privacy guard — grep contract

A grep for `current_page` in `src/` after this change should return ONLY:

```
src/lib/presence/types.ts                  declaration + block comment
src/lib/presence/presence.service.ts       Supabase mode broadcaster
src/lib/presence/presence.service.rust.ts  Rust mode broadcaster
src/hooks/use-presence-tracker.ts          updateCurrentPage caller (route effect)
src/hooks/use-presence-visibility.ts       vestigial canViewCurrentPage flag
src/hooks/use-entity-focus.ts              fallback stub (sets to null)
src/components/live-operator-status.tsx    THE consumer
```

(`src/lib/presence/route-features.ts` also matches because its docstring REFERENCES `PresencePayload.current_page` to explain the privacy contract — documentation, not a code-level read of the field. Excluded from the contract count.)

If this code-level list grows, the ADR's privacy contract is being broken — open a follow-up ADR.

## Quality gate results

- `pnpm tsc -b --noEmit` — clean (after the `use-entity-focus.ts` stub fix; ~19s).
- `npx eslint src/lib/presence/ src/hooks/use-presence-tracker.ts src/hooks/use-entity-focus.ts src/components/live-operator-status.tsx` — 0 warnings, 0 errors.
- `pnpm build` — clean in 9.26s; PWA precache regenerated.
- `pnpm lint:check` — 0 errors, 93 warnings org-wide. Touched-file warning count: 0. The 93 warnings are accumulated other-worker drift (sap-testing components, device-manager hooks, error boundaries) — untouched by this sprint and pre-existing on the worktree.
- **Bundle budget** (`scripts/check-bundle-budget.mjs`) — fails (total 9815 KB > 7500 KB budget; per-chunk failures on `warehouse-location-map`, `feature-admin`). Same baseline failure mode documented in [[Implement-Presence-On-Rust-Option-2]] ("two pre-existing over-budget chunks `warehouse-location-map` and `feature-admin` are unrelated and were already over budget before Phase A"). My delta vs that baseline (9779 KB) is +35 KB; no NEW chunks crossed any per-chunk threshold; no new chunks reported failing.
- **Lint ratchet** — fails on accumulated other-worker warning + suppression count drift (warnings 93 vs baseline 16; suppressions 166 vs baseline 127). Touched files contribute 0 to either. The ratchet baseline pre-dates the in-flight sap-testing / device-manager / triggers sprint and will need a separate `--update` pass once those land.

## Manual verification procedure

1. Sign in to a tenant where the current user has `view inventory_apps` permission.
2. Navigate to **Apps → Inventory → Inventory Counts** tab.
3. Confirm `<LiveOperatorStatus>` renders below the search bar (the toggle defaults to on).
4. In a **second tab** (or another browser session for a different operator on the same org), navigate the second tab's URL across a few routes — e.g. `/apps/inbound`, `/apps/outbound`, `/admin/sap-testing`.
5. Within ~1.5s (the `TRACK_DEBOUNCE_MS` window), the second user's card in the first tab's panel should update its "on <Feature>" line to reflect the new route. Hovering shows the raw pathname in a tooltip.
6. Navigate the second tab through a burst of 3+ routes within < 1s. Confirm the panel sees ONE update with the latest route, not three (debouncer working).
7. Click "Appear Offline" on the second tab. Confirm the operator drops out of the active list within ~1.5s in `'rust'` mode (immediate `PresenceLeft` from the Rust untrack route) or after the inbound throttle in `'supabase'` mode.

### Edge cases to spot-check

- Operator card for a worker who **isn't in the presence channel** (e.g. a kiosk RF user) — the "on <Feature>" line should be absent (the `feature && …` guard covers it). The card still shows the worker's heartbeat status and task location.
- A pathname that doesn't match any `ROUTE_FEATURES` entry should render as "on **Unknown**" with a `HelpCircle` icon and the raw pathname tooltip — visible signal that the mapping needs an entry.

## Anything flagged for user attention

**The RBAC gate IS sufficient.** Verified: `<LiveOperatorStatus>` only renders when the user has the `view inventory_apps` resource permission (route guard); the panel is not mounted anywhere else. No new permission key was introduced (per the user's instruction).

No broader privacy concern surfaced during the audit. The hard-rule list against future widening of consumers is documented in the ADR + on the type-level comment.

## Related

- [[ADR-Scoped-CurrentPage-In-ActiveOperators]] — the decision this implements.
- [[Route-To-Feature-Name-Mapping]] — the pattern note for the `resolveFeature()` URL-to-label resolver.
- [[Harden-Presence-Service-Tenant-Overload]] — Phase B3 removed `current_page`; this implementation partially restores it.
- [[Implement-Presence-On-Rust-Option-2]] — the loose-payload design choice that made the Rust pass-through transparent.
- [[Realtime-Presence-Browser-Hardening]] — the six-layer hardening pattern this restoration composes with (no layer broken).
- [[Components/PresenceUI - Status Indicators]] — the presence component family.
- [[Sessions/2026-05-07]] — today's session log.
