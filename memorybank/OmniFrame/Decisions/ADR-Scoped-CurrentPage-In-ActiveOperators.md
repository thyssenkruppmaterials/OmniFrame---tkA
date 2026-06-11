---
tags: [type/decision, status/accepted, domain/frontend, domain/realtime, privacy]
created: 2026-05-07
---
# ADR: Scoped Re-Enablement of `current_page` in Active Operators

## Status

**Accepted 2026-05-07.** Shipped same-day as a single coherent FE-only sprint (no Rust changes were required — see Step 1 outcome below).

> **Extended 2026-05-07 by [[ADR-RF-Activity-Telemetry]].** A sibling field `rf_activity` on the same payload now rides the SAME single-consumer privacy contract (`<LiveOperatorStatus>` only, RBAC-gated by `view inventory_apps`). The grep contract below remains valid for `current_page` specifically; see the sibling ADR for the parallel `rf_activity` grep contract. The hard rules in this ADR (single consumer; no widening without a new ADR; org-wide panels stay agnostic) apply symmetrically to `rf_activity`.

## Context

Phase B3 of the Customer Portal Presence hardening (2026-05-06, see [[Harden-Presence-Service-Tenant-Overload]]) **removed `current_page` from the `PresencePayload` interface entirely** for two reasons:

1. **Privacy** — broadcasting it on the org-wide channel meant every coworker on the same Realtime channel saw what URL every other coworker was on. The original "Online — viewing /rf-interface" tooltip felt useful but cost privacy by default.
2. **Payload size** — the field added 30–50 bytes per `.track()` payload across every member; on a busy org-wide channel this multiplies by N members × every track call.

The rationale was distilled into [[Realtime-Presence-Browser-Hardening]]'s Privacy considerations section ("Don't broadcast navigation context").

A day later (2026-05-07) the user asked for `current_page` to come back in **one specific surface**: the **Active Operators panel** (`<LiveOperatorStatus>`) inside the **Inventory Counts tab** of Inventory Management. That tab is already RBAC-gated by the `view inventory_apps` resource permission via `createStandardProtectedRoute('INVENTORY')` in `src/routes/_authenticated/apps/inventory.tsx`, so the privacy concern that motivated B3 doesn't apply there — only authorised inventory roles see the panel.

The user explicitly opted to **skip broader privacy gating** because that surface is already restricted.

## Decision

Re-enable `current_page` end-to-end on the presence payload **with a single rendering consumer**:

- **Type system** (`src/lib/presence/types.ts`) — add `current_page: string | null` back to `PresencePayload` and `PresenceUser`. Document the privacy contract inline.
- **FE services** — restore `updateCurrentPage(page: string)` on both `PresenceService` (Supabase mode) and `PresenceServiceRust` (Option 2). Both implementations route through the existing `scheduleTrack()` / `scheduleHeartbeat()` debouncer (`TRACK_DEBOUNCE_MS = 1500ms`), so a navigation burst (`/foo → /foo/bar → /foo/bar/baz` within hundreds of ms) collapses into a single broadcast. Both methods are **idempotent** — same-pathname calls are no-ops.
- **Hook** — restore the `useEffect` in `usePresenceTracker` that listens to `useLocation().pathname` and calls `presenceService.updateCurrentPage(...)`.
- **Mapping module** — new `src/lib/presence/route-features.ts` exposes `resolveFeature(pathname): { label, sublabel?, icon?, raw }`. The single consumer surface renders `label` (e.g. `"RF: Cycle Count"`) instead of the raw URL; the raw pathname is kept on the resolved result for tooltip/debugging.
- **Single consumer** — `<LiveOperatorStatus>` (in `src/components/live-operator-status.tsx`) cross-references its `useActiveWorkers()` list against `usePresenceOptional()` and renders a "on <Feature>" line per worker with a tooltip exposing the raw pathname.
- **Hard rule** — `current_page` MUST NOT be rendered on `<OnlineUsersPanel>`, `<StatusSelector>`, or `<PresenceAvatar>`. Adding a second consumer requires a new ADR.

The RBAC gate is the existing `view inventory_apps` resource permission. **No new permission key was introduced** (per the user's explicit instruction).

## Step 1 outcome — Rust pass-through verification

The FE-only assumption held. Verified in this order:

1. **`rust-work-service/src/api/routes/presence.rs`** — `PresenceHeartbeatRequest` uses `#[serde(flatten)] pub payload: serde_json::Map<String, Value>`. Unknown fields are accepted verbatim; there is no `#[serde(deny_unknown_fields)]`.
2. **`rust-work-service/src/presence/redis.rs`** — `track_presence` stores the payload as `serde_json::Value` (not a typed struct).
3. **`rust-work-service/src/websocket/mod.rs`** — `WsEvent::PresenceJoined { … payload: serde_json::Value }` (and `PresenceUpdated`) carry the loose value through to the WS frame.

Result: **no Rust release required**. The `current_page` field flows transparently from the FE heartbeat through Redis to every connected WS subscriber. Worker 1's deliberate `payload: serde_json::Value` design choice is the load-bearing element — it pays off on the very first FE field-shape change.

## Consequences

### Positive

- Supervisors looking at the Inventory Counts tab can finally tell **what an operator is doing** at a glance ("on RF: Cycle Count · 2m ago") without having to ask. Bridges the gap between "who's online" and "what are they doing".
- Privacy preserved everywhere except the one supervisor surface. The org-wide left-sidebar `<OnlineUsersPanel>` does not expose `current_page` even though the field is present on the payload — the panel just doesn't read the field.
- The `route-features.ts` module collapses URL-encoded entity IDs into stable feature labels, so even on the gated surface a supervisor sees `"RF: Cycle Count"` rather than `/rf-interface/cycle-count/abc-123-def-456`. The raw pathname is available behind a hover tooltip for supervisors who need it.
- **Zero Rust changes** thanks to Worker 1's loose-payload design — no service deploy, no version-skew window.

### Negative / risks

- The `current_page` value is now back on the wire. If a future engineer wires it into a non-RBAC-gated surface (`<OnlineUsersPanel>`, `<PresenceAvatar>`), the privacy regression returns. Mitigations: (a) the type-level comment on `PresencePayload.current_page` calls out the contract; (b) this ADR is the gate.
- `<LiveOperatorStatus>` now imports `usePresenceOptional()`. If the panel is ever mounted outside `<PresenceProvider>` (e.g. a standalone monitoring dashboard), it degrades gracefully — `null` → no `current_page` → existing rendering path. Verified via the `Optional` variant of the hook.

## Alternatives considered

### A. New `presence:view_current_page` permission

Rejected — overkill. The user explicitly said "do NOT introduce a new permission key. The user wants existing RBAC. If the panel is gated by `cycle_count:view`, that's the gate." The existing route-level `view inventory_apps` is sufficient.

### B. Coarse category mapping (broadcast a coarsened label, not the raw pathname)

Rejected — the user wants "full fidelity" so a supervisor can tell "on RF Cycle Count" from "on Inventory Reports". A coarse label would lose that distinction. The category mapping is applied **at render time** (`resolveFeature()` in the panel), not at broadcast time.

### C. Keep `current_page` removed; build the panel from `worker_heartbeats` only

Rejected — `worker_heartbeats` knows the operator's CURRENT TASK + ZONE + LOCATION, but not what UI screen they're on. "Current screen" is a presence concern (per-tab, not per-task) and the join via `usePresenceOptional()` is the cleanest place for it.

### D. Strictly per-component RBAC re-check at render time

Considered. The panel is already RBAC-gated by the route guard, so a re-check inside `<LiveOperatorStatus>` would be belt-and-suspenders. Decided NOT to add a redundant check — the principle is single source of truth for RBAC, and the route guard is the source. If the ADR's contract is violated and someone mounts the panel outside the gated route, the violation is a code review issue, not a runtime issue.

## Privacy contract (machine-checkable rules)

1. `PresencePayload.current_page` is broadcast for **all** presence-candidate users (no per-user gate at broadcast time).
2. `PresenceUser.current_page` is consumed by **exactly one** UI surface (`<LiveOperatorStatus>` inside the Inventory Counts tab).
3. Adding a second consumer requires a new ADR linked from this one.
4. `<OnlineUsersPanel>`, `<StatusSelector>`, and `<PresenceAvatar>` MUST stay `current_page`-agnostic.
5. `usePresenceVisibility().canViewCurrentPage` is a vestigial flag (kept for type compatibility) and is NOT used to gate rendering anywhere today.

A grep for `current_page` in `src/` should return only:
- `src/lib/presence/types.ts` (declaration)
- `src/lib/presence/presence.service.ts` (broadcaster)
- `src/lib/presence/presence.service.rust.ts` (broadcaster)
- `src/hooks/use-presence-tracker.ts` (caller of `updateCurrentPage`)
- `src/hooks/use-presence-visibility.ts` (vestigial flag — comment explains why)
- `src/hooks/use-entity-focus.ts` (fallback stub user — sets to `null`)
- `src/components/live-operator-status.tsx` (the ONE consumer)

(Plus `src/lib/presence/route-features.ts`, which mentions the field in a docstring reference — documentation, not a code-level read. Excluded from the contract count.)

If this code-level list grows, this ADR's contract is being broken — open a new ADR.

## Related

- [[ADR-RF-Activity-Telemetry]] — sibling 2026-05-07 ADR that EXTENDS this privacy contract to a second presence-payload field (`rf_activity`). Same RBAC gate, same single-consumer rule, same grep-checkable hard rules.
- [[Implement-RF-Activity-Telemetry-In-LiveOperatorStatus]] — the implementation note for the sibling ADR.
- [[Harden-Presence-Service-Tenant-Overload]] — Phase B3 removed `current_page`; this ADR partially restores it.
- [[Re-Enable-CurrentPage-In-ActiveOperators]] — the implementation note for this ADR.
- [[Route-To-Feature-Name-Mapping]] — the pattern note for the `resolveFeature()` URL-to-label resolver.
- [[Implement-Presence-On-Rust-Option-2]] — Worker 1's `payload: serde_json::Value` design that made the Rust pass-through transparent.
- [[Realtime-Presence-Browser-Hardening]] — six-layer hardening pattern with the privacy considerations section that this ADR cross-links.
- [[ADR-Presence-Architecture-Next-Steps]] — the broader presence architecture decision.
- [[Components/PresenceUI - Status Indicators]] — the presence component family this surface joins.
- [[Sessions/2026-05-07]] — session log.
