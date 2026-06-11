---
tags: [type/implementation, status/active, domain/frontend, sidebar, ux]
created: 2026-05-21
---
# Implement Sidebar Pin/Lock Feature

## Purpose / Context
User request (2026-05-21): "in the side menu, Add the ability to keep the menu items locked open, online section to stay closed, etc. to be a much better experience".

The sidebar already persisted user-toggled section state per-user via `navigationStore.expandedGroups`, but two UX gaps remained:

1. **Auto-open clobber.** When a group like `Warehouse Cluster` was *auto-opened* because the active route matched (e.g. `/apps/inventory-apps`), there was no `expandedGroups` entry. Navigating to a different route caused the group to auto-collapse — even if the user wanted it to stay open. There was no way to lock the current state without first toggling twice (close → open) to set an explicit value.
2. **OnlineUsersPanel sub-sections never persisted.** The outer `Online` header persisted via a *global* localStorage key (`onebox-presence-panel-collapsed`), but the inner `Online / Away / Busy` sub-sections used `useState` with no persistence at all. Every refresh reset them.

## Details

### Files touched
- `src/stores/navigationStore.ts` — added `pinnedGroups` state + `setGroupPinned` / `initializePinnedGroups` actions with per-user localStorage persistence (`onebox-nav-pinned-${userId}`).
- `src/components/layout/optimized-nav-group.tsx` — added `NavPinButton` (a `<span role="button">` to avoid invalid nested `<button>` inside `SidebarMenuButton` which is the `CollapsibleTrigger`). When unpinned, the icon fades in on hover via `group/navitem`. When pinned, the icon stays visible and uses `text-primary`.
- `src/components/layout/optimized-app-sidebar.tsx` — call `initializePinnedGroups(user.id)` alongside the existing `initializeExpandedGroups(user.id)` on `user.id` change.
- `src/components/presence/online-users-panel.tsx` — full per-user persistence for `panelCollapsed`, `panelPinned`, and `expandedSections` (Online/Away/Busy). Added a header-row pin button (real `<button>` element this time because it sits as a sibling of the toggle button, not nested). Reads legacy global `onebox-presence-panel-collapsed` once for migration.

### Lock-aware `isOpen` logic

```ts
const isPinned = pinnedGroups[groupId] === true
const isOpen = isPinned
  ? (expandedGroups[groupId] ?? checkIsActive(href, item, true))
  : expandedGroups[groupId] !== undefined
    ? expandedGroups[groupId]
    : checkIsActive(href, item, true)
```

When pinned, `expandedGroups[groupId]` is authoritative — the route-driven `checkIsActive` fallback is suppressed unless the user has never set an explicit value.

### `setGroupPinned` semantics

- **Pin (`pinned=true`):** captures the *current* `isOpen` into `expandedGroups[groupId]` so the section locks in place without flicker, and sets `pinnedGroups[groupId] = true`.
- **Unpin (`pinned=false`):** removes both `pinnedGroups[groupId]` and `expandedGroups[groupId]` so the section returns to route-driven auto-open behavior. Pinning is the right place to drop the override because that's the user's explicit "reset to auto" gesture.

### Why a `<span role="button">` for the nav pin

`SidebarMenuButton` is the `CollapsibleTrigger asChild` — rendered as a real `<button>`. A nested `<button>` would be invalid HTML and cause hydration warnings. A `<span role="button">` with `tabIndex={0}`, `onKeyDown` for Enter/Space, and `e.stopPropagation()` in the click handler gives ARIA-correct button semantics without nested interactive HTML. The presence panel's pin button is a real `<button>` because there it's a *sibling* of the toggle button (absolute-positioned at `right-2`), not nested inside it.

### Persistence keys

- `onebox-nav-expanded-${userId}` — existing, per-user expanded state for nav groups.
- `onebox-nav-pinned-${userId}` — NEW, per-user pin state for nav groups.
- `onebox-presence-panel-collapsed-${userId}` — NEW, per-user OnlineUsersPanel collapsed.
- `onebox-presence-panel-pinned-${userId}` — NEW, per-user OnlineUsersPanel pin lock.
- `onebox-presence-panel-sections-${userId}` — NEW, per-user Online/Away/Busy sub-section state.
- `onebox-presence-panel-collapsed` — LEGACY (global). Read once at hydration for migration; no longer written.

## Related
- [[ZustandStores - State Management]]
- [[OnlineUsersPanel]]
- [[Sidebar-Pin-Lock]]


## Follow-up fix (2026-05-21 PM): nav-group titles wrapping

The initial cut put the pin button + chevron inside an `ml-auto` wrapper span inside `SidebarMenuButton`. That wrapper took ~40px of inline width (pin 20 + gap 4 + chevron 16) instead of the original 16px chevron, which squeezed multi-word titles (`Warehouse Cluster`, `Labor Management`, `Facility Management`) onto two lines.

**Fix.** Pull `NavPinButton` out of the `CollapsibleTrigger`/`SidebarMenuButton` and render it as an ABSOLUTELY-positioned sibling within `SidebarMenuItem` (which is already `relative`). `right-7` slots it just to the left of the chevron's `p-2`-padded position. The chevron returns to its original lone `ml-auto` slot inside the menu button, so titles get their full natural inline width back.

Because the pin is no longer nested inside a `<button>`, it can be a real `<button type="button">` (no need for the `<span role="button">` workaround), which also lets its click handler skip `stopPropagation` for the collapsible trigger — clicks on the pin never reach the menu button.

Added `truncate` to the title span as a belt-and-suspenders measure so unusually long titles ellipsize cleanly instead of wrapping even if the pin button is rendered behind them.

The `[Patterns/Sidebar-Pin-Lock]] doc has been updated with the absolute-positioning guidance.
