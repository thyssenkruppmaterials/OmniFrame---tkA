---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# PresenceUI - Status Indicators

## Purpose
Documents the presence/online-status UI component system. These components provide Teams-style real-time presence indicators composed from base primitives.

## Components

### StatusIndicator (`status-indicator.tsx`)
Base colored dot showing a user's presence status.

**Props:**
```typescript
interface StatusIndicatorProps {
  status: PresenceStatus
  size?: 'xs' | 'sm' | 'md' | 'lg'
  showTooltip?: boolean  // default: true
  pulse?: boolean        // animate online status
  className?: string
}
```

**Size classes:** `xs: h-2 w-2`, `sm: h-2.5 w-2.5`, `md: h-3 w-3`, `lg: h-3.5 w-3.5`

**Behavior:**
- Renders a colored dot with `border-background` ring (2px)
- Color comes from `PRESENCE_STATUS_CONFIG[status].dotClass`
- Optional tooltip showing status label and description via Radix Tooltip
- Optional pulse animation for `online` status

### PresenceAvatar (`presence-avatar.tsx`)
Composite component: Avatar with overlaid status dot (Teams-style).

**Props:**
```typescript
interface PresenceAvatarProps {
  src?: string | null
  fallback: string      // initials
  alt?: string
  status: PresenceStatus
  size?: 'sm' | 'md' | 'lg'
  showStatus?: boolean  // default: true
  className?: string
}
```

**Composition:**
- Wraps shadcn/ui `Avatar` + `AvatarImage` + `AvatarFallback`
- Positions `StatusIndicator` absolutely in bottom-right corner
- Size mapping: avatar `sm` -> dot `xs`, `md` -> `sm`, `lg` -> `md`
- Dot hidden when status is `offline`

### OnlineUsersPanel (`online-users-panel.tsx`)
Panel embedded in the sidebar showing currently online users.
- Supports `collapsed` prop for icon-only mode
- Conditionally rendered based on presence visibility permissions

### StatusSelector (`status-selector.tsx`)
Dropdown for users to set their own presence status.

## Integration
- `PresenceProvider` context wraps the authenticated layout
- `usePresenceOptional()` hook for safe access
- `usePresenceVisibility()` determines if user can see presence indicators
- Presence visibility has levels: `count_only` (shows count), full (shows avatars)
- Types from `@/lib/presence/types` (`PresenceStatus`, `PRESENCE_STATUS_CONFIG`)

## Related
- [[Layout - App Shell]]
- [[UILibrary - Component Catalog]]
- [[UI-Component-Conventions]]


## Service hardening (2026-05-06)

The `presenceService` underpinning all of these components was hardened against tenant-side Realtime overload after the `Presence_shard112` GenServer crash on tenant `c9d89a74`. The component surface is unchanged — `usePresence`, `usePresenceOptional`, `OnlineUsersPanel`, `StatusSelector`, `StatusIndicator`, `PresenceAvatar` all keep the same props and behaviour. What changed underneath:

- All `.track()` / `.untrack()` calls route through a 1500ms coalescer (`scheduleTrack()`).
- Channel-error circuit breaker (3 errors in 60s → 5→30 min exponential cooldown, mirroring agent v1.8.4).
- DB heartbeat is visibility-aware (60s foreground / 5min hidden / off when "Appear Offline").
- `VITE_PRESENCE_DISABLED=true` env-var kill switch — fleet-wide disable at boot.
- Kiosk/RF route opt-out (`/rf-*`, `/timeclockapp*`, `/customer-portal*`) — service no-ops, provider stays mounted.
- Inbound sync throttle bumped 500ms → 1000ms.

Details: [[Implementations/Harden-Presence-Service-Tenant-Overload]] · root-cause + audit: [[Debug/Fix-CustomerPortal-Presence-Tenant-Overload]] · distilled pattern: [[Patterns/Realtime-Presence-Browser-Hardening]].


## Phase B2 + B3 follow-up (2026-05-06)

Follow-up to the same-day Phase A hardening above. Two additional changes shipped on top:

- **B2 — Permission-gated subscription.** A new `useIsPresenceCandidate()` hook (lives next to `usePresenceVisibility()` in `src/hooks/use-presence-visibility.ts`) decides whether the user joins the org-wide channel at all. Users with `presence:hidden` AND no `presence:view*` permission skip the channel entirely — service sets `disabledReason='permission'`. Default behaviour for orgs that don't define `presence:hidden` is unchanged. The `usePresenceVisibility()` hook surface is unchanged: components keep reading `{ visibility, canViewPresence, canViewDetails, canViewCurrentPage, filteredOnlineState }` exactly as before.
- **B3 — `current_page` removed from the broadcast payload.** Both `PresencePayload` and `PresenceUser` lost the field. `presenceService.updateCurrentPage()` was deleted entirely. The page-tracking `useEffect` in `usePresenceTracker` was removed. No UI consumer was load-bearing on the field (verified by full-repo grep) — `OnlineUsersPanel`, `StatusSelector`, `PresenceAvatar`, and `StatusIndicator` keep working without edits. The `usePresenceVisibility` `'basic'` filter previously stripped `current_page`; that mapping is gone (basic and full now produce identical data — the levels stay separate so a future detail-only field can come back without a permission migration). The `canViewCurrentPage` flag is still on the hook return type for API stability but is now vestigial.

Details: [[Implementations/Harden-Presence-Service-Tenant-Overload]] § "Phase B2 + B3 follow-up" · distilled pattern with the new sixth defense layer + privacy considerations: [[Patterns/Realtime-Presence-Browser-Hardening]] · audit thread: [[Debug/Fix-CustomerPortal-Presence-Tenant-Overload]] § "Phase B — partial follow-up".



---

## 2026-05-07 — `current_page` re-enabled (scoped) for the Active Operators panel

[[ADR-Scoped-CurrentPage-In-ActiveOperators]] partially restores `current_page` to `PresencePayload` + `PresenceUser`, intentionally NOT exposed on this component family's surfaces.

**Surfaces that DO consume `current_page` after the restoration:**

- `<LiveOperatorStatus>` (`src/components/live-operator-status.tsx`) — mounted only inside the Inventory Counts tab (RBAC-gated by `view inventory_apps`). Renders an "on <FeatureLabel>" line per worker with a tooltip exposing the raw pathname. Cross-references `useActiveWorkers()` against `usePresenceOptional()`; gracefully no-ops when the operator isn't in the presence channel (e.g. RF-route kiosk users that opt out via `PRESENCE_KIOSK_ROUTE_PATTERNS`).

**Surfaces that intentionally STAY `current_page`-agnostic (privacy-by-default):**

- `<OnlineUsersPanel>` — the org-wide left-sidebar panel.
- `<StatusSelector>` — the user's own status dropdown.
- `<PresenceAvatar>` tooltip — hover surface used in many places.
- `<EntityFocusPill>` — entity-focus indicator.

These surfaces are NOT RBAC-gated to inventory roles, so exposing the field there would re-introduce the privacy regression Phase B3 fixed. Adding a second consumer requires a new ADR linked from [[ADR-Scoped-CurrentPage-In-ActiveOperators]].

**Ancillary changes:**

- `usePresenceVisibility().canViewCurrentPage` stays vestigial (kept for type compatibility); not used to gate rendering anywhere today.
- `route-features.ts` collapses URL-encoded entity IDs into stable feature labels at render time (e.g. `/rf-interface/cycle-count/abc-123` → "RF: Cycle Count"). The raw pathname is broadcast on the wire but the consumer renders the label, with the raw pathname behind a hover tooltip for supervisors who need it.



---

## 2026-05-07 — `<LiveOperatorStatus>` extended with second tab ("In Building")

[[Implement-LiveOperatorStatus-InBuilding-Tab]] adds a second tab to the Active Operators panel showing all presence-tracked users in the org that are NOT currently checked in to the work engine. The tab consumes `usePresenceOptional()`, dedups against `worker_heartbeats` user IDs, and renders compact cards.

**Reuses the `PresenceAvatar size="sm"` variant** — the existing `sm/md/lg` API on `<PresenceAvatar>` carried over without any prop changes. Tab 2 cards use the `sm` size (avatar `h-7 w-7` with `xs` status dot) for the compact ~60px row layout. This is the first non-`<OnlineUsersPanel>` consumer of the `sm` size in the panel family.

**Surfaces that consume `current_page`** (privacy contract from [[ADR-Scoped-CurrentPage-In-ActiveOperators]]):

- `<LiveOperatorStatus>` Tab 1 (`<OperatorCard>`) — work-engine operators, full size cards.
- `<LiveOperatorStatus>` Tab 2 (`<PresenceUserCard>`) — presence-only users, compact cards.

Both render inside the same RBAC-gated panel inside the same `view inventory_apps`-gated route. The grep contract still counts `live-operator-status.tsx` as a single consumer file (Rule 2 of the ADR holds).

**Surfaces that intentionally STAY `current_page`-agnostic** — `<OnlineUsersPanel>`, `<StatusSelector>`, `<PresenceAvatar>` tooltip, `<EntityFocusPill>`. Unchanged.

Details: [[Implement-LiveOperatorStatus-InBuilding-Tab]] · ADR: [[ADR-Scoped-CurrentPage-In-ActiveOperators]].



## 2026-05-07 — RF Activity Telemetry extension

The `PresencePayload` and `PresenceUser` shapes now carry an optional nested `rf_activity: PresenceRfActivity \| null` block. See [[ADR-RF-Activity-Telemetry]] for the privacy contract; [[Implement-RF-Activity-Telemetry-In-LiveOperatorStatus]] for the implementation.

**Important:** `rf_activity`, like `current_page`, is broadcast for every presence-candidate user but rendered by EXACTLY ONE UI surface — `<LiveOperatorStatus>` inside the Inventory Counts tab. The presence component family on this note (`<StatusIndicator>`, `<PresenceAvatar>`, `<OnlineUsersPanel>`, `<StatusSelector>`) MUST stay `rf_activity`-agnostic. Do not surface the field on these components without filing a follow-up ADR.

New rendering helpers (in `src/components/live-operator-status.tsx`, NOT in this component family):

- `<RfActivityRow>` — Tab 1 sub-row: step label · last scan · live pulse / idle badge.
- `<RfActivityIndicator>` — Tab 2 inline radar icon with tooltip snapshot.
- `humaniseStep(step)` — maps snake_case `current_step` to Title Case via a `STEP_LABELS` lookup with title-case fallback.
- `freshnessFromLastInput()` + `useNowTicker(5_000)` — 5s local ticker drives the visual freshness ladder (`< 10s = live`, `10–60s = recent`, `> 60s = idle`) without re-broadcasting on every keystroke.

The new `useRfPresenceActivity` hook (`src/hooks/use-rf-presence-activity.ts`) is the publisher — mounted once in `<RFInterface>`, watches the parent's `currentView` / `currentTask` / `currentZone` plus document-level capture-phase keydown / pointerdown listeners (delegated on `data-slot="scanner-input"` for scan capture). Calls `presenceService.updateRfActivity(...)` whenever the shape changes.

**Kiosk opt-out narrowed (2026-05-07):** `PRESENCE_KIOSK_ROUTE_PATTERNS` no longer matches the entire RF tree — only `/rf-signin/` opts out now. `/rf-interface` participates in presence so RF operators appear in `<LiveOperatorStatus>`'s "In Building" tab. `<RFLayout>` was enrolled in `<PresenceProvider>` to make this work (RF was OUTSIDE `_authenticated` and didn't inherit the provider). See [[Realtime-Presence-Browser-Hardening]] Layer 4.
