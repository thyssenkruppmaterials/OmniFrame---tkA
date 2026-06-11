---
tags: [type/decision, status/accepted, domain/frontend, domain/realtime, privacy]
created: 2026-05-07
---
# ADR: RF Activity Telemetry on Presence Payload

## Status

**Accepted 2026-05-07.** Shipped same-day as a single FE-only sprint (no Rust changes — Worker 1's loose `serde_json::Value` payload design carries the new nested object verbatim, validated in the heartbeat handler at `rust-work-service/src/api/routes/presence.rs`).

## Context

Day-after follow-up to [[Re-Enable-CurrentPage-In-ActiveOperators]] and [[Implement-LiveOperatorStatus-InBuilding-Tab]] (both 2026-05-07). The supervisor's `<LiveOperatorStatus>` panel now shows *who* is online and *what page* they're on, but not *what they're actually doing* on the RF tree. The user's ask:

> I want to extend `<LiveOperatorStatus>` with granular RF activity telemetry so the panel shows current workflow step, last scan, idle state, and work task context — not just "on RF: Cycle Count" but "Scanning Material · last scan: K3-08 · 25s ago".

This composes on top of:

- **Option 2** ([[Implement-Presence-On-Rust-Option-2]]) — server-side presence on `rust-work-service` with Redis HSET. Worker 1's `payload: serde_json::Value` design lets new FE-side payload fields ride the wire without a Rust release.
- **Phase B3 → scoped re-enablement** ([[ADR-Scoped-CurrentPage-In-ActiveOperators]]) — `current_page` already restored on the wire, scoped to `<LiveOperatorStatus>` only by the existing privacy contract. This ADR EXTENDS that contract to a sibling field (`rf_activity`).
- **Phase A kiosk opt-out** (Layer 4 of [[Realtime-Presence-Browser-Hardening]]) — `/rf-*` was excluded from presence entirely. Layer 7 (Option 2) retired the load argument that motivated the opt-out, so this ADR also narrows `PRESENCE_KIOSK_ROUTE_PATTERNS` from `/^\/rf-/` to `/^\/rf-signin(\/|$)/` — only the pre-auth sign-in screen stays opted out.
- **"In Building" tab** ([[Implement-LiveOperatorStatus-InBuilding-Tab]]) — Tab 2 of `<LiveOperatorStatus>` already wired to render presence-only users. RF operators now appear there too thanks to the kiosk narrowing.

## Decision

Add a nested `rf_activity` block to the presence payload, broadcast for every presence-candidate user, but consumed by **exactly one** UI surface — same RBAC scope as `current_page`.

### Type shape

```typescript
export interface PresenceRfActivity {
  current_step: string | null               // e.g. 'cycle_count', 'scanning_material'
  last_scan: {
    type: 'material' | 'bin' | 'to_number' | 'serial' | 'rf_scan' | string
    value: string
    at: string                              // ISO timestamp
  } | null
  work_task_id: string | null               // active claimed task UUID
  work_zone: string | null                  // e.g. 'K3' or 'K3-35'
  last_input_at: string | null              // ISO timestamp; drives idle/live indicator
}
```

Added as `rf_activity?: PresenceRfActivity | null` on both `PresencePayload` (broadcaster shape) and `PresenceUser` (consumer shape).

### Broadcaster — `presenceService.updateRfActivity(activity)`

Mirror of `updateCurrentPage()`. Both `PresenceService` (Supabase mode) and `PresenceServiceRust` (Option 2) ship the method on identical surfaces. Idempotent on **shape** fields only (`current_step` + `work_task_id` + `work_zone` + `last_scan.{type,value,at}`); a `last_input_at`-only change updates the in-memory payload but does NOT trigger a fresh broadcast — otherwise typing rate would defeat the `TRACK_DEBOUNCE_MS = 1500ms` coalescer. The freshest `last_input_at` still rides the next heartbeat that any other field DOES trigger.

Clearing (`updateRfActivity(null)`) IS a shape change and triggers a broadcast.

### Publisher — `useRfPresenceActivity` hook

New hook at `src/hooks/use-rf-presence-activity.ts`. Mounted ONCE inside `<RFInterface>` (not per-form). Watches:

- The parent's `currentView` state (the top-level RF screen — `'home'`, `'cycle-count'`, `'putaway'`, etc.) → maps to a snake_case `current_step` label via a small `VIEW_TO_STEP` lookup with raw-string fallback.
- The parent's `currentTask` and `currentZone` (cycle-count surfaces these today; other workflows can extend by mirroring `handleCycleCountTaskChange`).
- A `document`-level capture-phase `keydown` listener on inputs with `data-slot="scanner-input"` for scan completion (Bluetooth / USB scanners emit `Enter`).
- A `document`-level capture-phase `pointerdown` + `keydown` listener throttled to 1 ping/s for `last_input_at`.

No-ops when `presenceService.isDisabled === true` (covers the `VITE_PRESENCE_DISABLED` env switch + any leftover kiosk paths). On unmount, calls `updateRfActivity(null)` so supervisor cards drop the panel cleanly.

### Kiosk opt-out narrowing

`PRESENCE_KIOSK_ROUTE_PATTERNS` changed:

- **Before:** `[/^\/rf-/, /^\/timeclock(app)?(\/|$)/, /^\/customer-portal(\/|$)/]` (entire RF tree opted out)
- **After:** `[/^\/rf-signin(\/|$)/, /^\/timeclock(app)?(\/|$)/, /^\/customer-portal(\/|$)/]` (only RF sign-in screen opts out)

RF interface tabs now participate in presence. Layer 7's Redis-backed presence cost (~1 HSET per ~30s heartbeat) is well below the load level that motivated the original opt-out on the shared Supabase Realtime presence shard.

### `<RFLayout>` enrolls in `<PresenceProvider>`

`/rf-interface` is OUTSIDE `_authenticated`, so its layout doesn't inherit `<PresenceProvider>` from `<AuthenticatedLayout>`. Without enrolling, the kiosk-pattern narrowing alone wouldn't surface RF users at all — the presence service simply wouldn't initialize for them. `<RFLayout>` now wraps its `<Outlet />` in `<PresenceProvider>` so RF tabs initialize the singleton and the activity hook has somewhere to call.

### Consumer — `<LiveOperatorStatus>` only

Tab 1 ("On Counts") operator cards: render an `<RfActivityRow>` sub-row beneath the existing zone/work-type display when `rf_activity != null`. Shows step label · last-scan icon (with tooltip carrying the full scan details) · live pulse / idle badge.

Tab 2 ("In Building") presence-user cards: render an inline `<RfActivityIndicator>` (compact radar icon, tooltip with full snapshot). Tooltip-based instead of inline text so the ~60px-tall compact card height stays unchanged.

Freshness ladder: `< 10s = live` (green pulse) · `10–60s = recent` (amber dot) · `> 60s = idle` (slate dot + badge). Recomputed locally on a 5s `useNowTicker` so the badge advances visually even when no presence broadcast lands (the broadcast is debounced; visual freshness is cheaper to recompute than to re-broadcast).

## Privacy contract (machine-checkable rules)

1. `PresencePayload.rf_activity` is broadcast for **all** presence-candidate users (no per-user gate at broadcast time).
2. `PresenceUser.rf_activity` is consumed by **exactly one** UI surface — `<LiveOperatorStatus>` inside the Inventory Counts tab.
3. Adding a second consumer requires a new ADR linked from this one.
4. `<OnlineUsersPanel>`, `<StatusSelector>`, and `<PresenceAvatar>` MUST stay `rf_activity`-agnostic.
5. The hard rule from [[ADR-Scoped-CurrentPage-In-ActiveOperators]] applies symmetrically to `rf_activity`: if a future engineer wires this field into a non-RBAC-gated surface, the privacy contract is broken. Mitigations: (a) the type-level comment on `PresencePayload.rf_activity` calls out the contract; (b) this ADR is the gate.

### Grep contract

A grep for `rf_activity|RfActivity|rfActivity` in `src/` should return ONLY:

```
src/lib/presence/types.ts                    declaration + privacy block comment
src/lib/presence/presence.service.ts         broadcaster (Supabase mode)
src/lib/presence/presence.service.rust.ts    broadcaster (Rust mode)
src/hooks/use-rf-presence-activity.ts        the publisher hook
src/features/rf-interface/rf-interface.tsx   mounts the hook
src/features/rf-interface/rf-layout.tsx      doc-only reference (excluded from contract count)
src/components/live-operator-status.tsx      THE consumer (Tab 1 + Tab 2 cards)
```

6 code-level matches plus 1 doc reference. Verified at ship time. If this list grows without an ADR linked from this one, the contract is broken — open a follow-up ADR.

The parallel `current_page` grep contract from [[ADR-Scoped-CurrentPage-In-ActiveOperators]] continues to hold unchanged — the new file `use-rf-presence-activity.ts` does NOT consume `current_page` (presence service handles `current_page` independently via `usePresenceTracker`'s navigation effect).

## Consequences

### Positive

- Supervisors see what RF operators are *doing*, not just *where they are*. Bridges the gap between "on RF: Cycle Count" (`current_page`) and "Scanning Material · last scan: K3-08-02" (`rf_activity`).
- RF operators show up on Tab 2 ("In Building") for the first time — supervisors now have a single "who's around" view that includes shop-floor staff, not just office staff. (Flagged as a real gap in [[Implement-LiveOperatorStatus-InBuilding-Tab]] § "Anything to flag → Kiosk-opt-out gap" and resolved here.)
- Same RBAC gate as `current_page` — no new permission key, no roundtrip at sign-in.
- Idle indicator + live pulse give supervisors a glanceable activity heuristic without surfacing every keystroke as a presence broadcast (pulse / badge re-render locally on a 5s ticker).
- Zero Rust changes thanks to Worker 1's loose `serde_json::Value` design — no service deploy, no version-skew window. (Same as `current_page` re-enablement; this is the second FE field-shape extension that paid off the loose-payload investment.)

### Negative / risks

- **Browser-side scan capture is a fragile delegation surface.** The capture-phase `keydown` listener targets inputs with `data-slot="scanner-input"` and looks at `event.target.value` at the moment of `Enter`. If a future scanner integration bypasses `<ScannerInput>` (e.g. native Capacitor APIs), the scan won't be captured. Mitigation: forms can directly call `presenceService.updateRfActivity(...)` from their `handleScan*` callbacks — the hook's value writes are additive, not authoritative.
- **Work-type-level granularity, not sub-step-level (in v1).** The hook publishes `current_step` from the parent's `currentView` state — which means "in the cycle-count flow" rather than "on step 3 of 5: confirming count". This was a deliberate Phase 0 trade-off (no central state machine across all RF forms; centralizing would require touching 8–12 forms). Phase B (future): per-form opt-in. The `STEP_LABELS` lookup on the consumer side already includes future labels (`scanning_material`, `confirming_count`, `reviewing_variance`) so a form-level integration drops in cleanly.
- **`work_task_id` / `work_zone` only populate for cycle-count today.** Other RF flows (put-away, picking, kit-build) keep their task state internal to their form components and don't bubble it up to `<RFInterface>`. Same Phase B story — the hook signature accepts any source, but the parent only knows the cycle-count surface today.
- **Reintroduces presence churn from RF tabs.** Each handheld going to sleep/waking generates a HSET write + broadcast. Mitigation: the 1500ms `TRACK_DEBOUNCE_MS` coalescer + the 90s evictor TTL in Redis bound the cost; Worker 1's `Implement-Presence-On-Rust-Option-2` Manual smoke test procedure includes RF-rate testing.
- **`useRfPresenceActivity` document listeners are global.** The capture-phase listeners stay attached for the lifetime of `<RFInterface>` — they don't leak past unmount, but they do see every keystroke / pointer-down on the page. Mitigation: throttled to 1 ping/s + early-out on `presenceService.isDisabled`.

## Alternatives considered

### A. Per-form `useTaskWorkflowRuntime` integration (sub-step granularity v1)

Rejected for v1 — would require touching `useUnifiedCycleCount`, the per-form `useState({currentStep})` machines in `rf-putaway-form` / `rf-build-kit-form` / `rf-inspect-kit-form` / `rf-kitting-picking-form`, plus the newer `useTaskWorkflowRuntime` consumers. Phase 0 of the sprint flagged this as the single biggest scope risk and the user spec explicitly said: *"If Phase 0 reveals an architectural blocker (...) STOP, document the blocker (...). Do NOT force a fragile implementation."* We took the parent-level work-type granularity as v1 and left the per-form surface as additive future work.

### B. Server-side scan capture via Rust

Rejected — would require routing every scan through `rust-work-service` first. The scan flow today is FE-direct (form scans → form processes → form emits result). Adding a server round-trip just for telemetry is the wrong tradeoff.

### C. New `rf-activity` Realtime channel

Rejected — explicitly forbidden by the [[realtime-policy.mdc]] realtime policy rule ("no new Supabase Realtime channels — extend the WS instead"). Riding the existing presence payload is exactly the path the policy advocates.

### D. Coarsened activity bucketing (e.g. just `active` / `idle`)

Rejected — supervisors specifically wanted to see WHAT operators are doing, not just THAT they're doing something. Coarsening loses the distinction between "scanning material" and "confirming count" — which is the affordance the user requested.

### E. Sample-and-hold via `worker_heartbeats.payload` JSONB column

Considered. Storing rf_activity in `worker_heartbeats` would give the panel a direct SQL query path (no presence join). Rejected because (a) it would require a DB migration, (b) it would lag at 30s heartbeat cadence vs. presence's 1.5s broadcast debounce, and (c) it would couple presence-style ephemeral state to a persistent table that's already at high write rate.

## What would change this recommendation

- If the customer-portal CSR pain that drove the original kiosk opt-out re-emerges (i.e. RF tabs measurably degrade the shared Supabase Realtime shard *despite* Layer 7 being in place), we'd revert the kiosk narrowing and either keep `rf_activity` shipped to a smaller subset of users or move RF presence to a sibling Redis namespace. The `presenceServiceRust` is the load-bearing path today; the Supabase mode is preserved for fallback.
- If a per-form sub-step integration ships, this ADR's "work-type-level granularity" framing becomes vestigial — update the "Negative / risks" section accordingly.
- If a second supervisor surface needs `rf_activity` (e.g. a dedicated "RF Operations" dashboard), file a sibling ADR + extend the grep contract.

## Related

- [[ADR-Scoped-CurrentPage-In-ActiveOperators]] — the privacy contract this ADR mirrors / extends (`current_page` and `rf_activity` ride the same RBAC gate, single-consumer rule, grep contract).
- [[Implement-RF-Activity-Telemetry-In-LiveOperatorStatus]] — the implementation note for this ADR.
- [[Implement-LiveOperatorStatus-InBuilding-Tab]] — the Tab 2 surface this composes onto (RF operators now appear there by default).
- [[Implement-Presence-On-Rust-Option-2]] — Worker 1's `payload: serde_json::Value` design that makes the Rust pass-through transparent for the second time this week.
- [[Re-Enable-CurrentPage-In-ActiveOperators]] — the same-week implementation pattern this ADR mirrors.
- [[Realtime-Presence-Browser-Hardening]] — Layer 4 (kiosk opt-out) narrowed by this decision.
- [[Roadmap-Rust-WS-Unlocks]] — broader plan context.
- [[Components/PresenceUI - Status Indicators]] — the presence component family; updated note explains the new `rf_activity` field.
- [[Sessions/2026-05-07]] — today's session log.
