---
tags: [type/pattern, status/active, domain/frontend, sidebar, ux]
created: 2026-05-21
---
# Sidebar Pin / Lock Pattern

## Purpose / Context
Reusable pattern for adding a discoverable "pin" (lock-in-place) control to a collapsible sidebar section. Used by `OptimizedNavGroup` (nav groups) and `OnlineUsersPanel` (presence panel). Solves the UX problem where a section is auto-expanded based on the active route and silently collapses when the user navigates elsewhere.

## Details

### State model

Two per-user records keyed by section/group id:

- `expandedGroups: Record<string, boolean>` — user's explicit open/closed override.
- `pinnedGroups: Record<string, boolean>` — whether the section is locked.

Derived `isOpen`:

```ts
const isPinned = pinnedGroups[id] === true
const isOpen = isPinned
  ? (expandedGroups[id] ?? auto)
  : (expandedGroups[id] !== undefined ? expandedGroups[id] : auto)
```

Where `auto` is the section's natural state when no user preference exists (e.g. `checkIsActive(href, item)` for nav groups, or a hard-coded default like `online: true, busy: false` for presence sub-sections).

### Pin action semantics

- **Pin:** copy current visible `isOpen` into `expandedGroups[id]` and set `pinnedGroups[id] = true`. Captures the value at pin time so the section doesn't flicker.
- **Unpin:** delete both `pinnedGroups[id]` *and* `expandedGroups[id]`. Returns the section to auto behavior in one click — unpinning is the natural "reset to default" gesture.

### Persistence

Always per-user. The userId comes from `useUnifiedAuth().authState.user.id`. localStorage keys use a stable prefix + userId so multiple accounts sharing a browser (a common RF/operator-device situation in OmniFrame) keep separate preferences:

```
<feature>-<scope>-${userId}
e.g. onebox-nav-pinned-<uuid>
     onebox-presence-panel-pinned-<uuid>
```

If there's a legacy global key being replaced, read it once during hydration for backward-compat migration, then never write to it again.

#### Default-collapsed + pin-to-lock (OnlineUsersPanel, 2026-05-31)

The `OnlineUsersPanel` defaults to **collapsed on every load**. An expanded state is only remembered across reloads when the user **pins** it — pin is the explicit "keep my choice" mechanism, which finally gives the panel pin real behavior (previously it persisted but didn't gate anything):

- `useState` initializer + userId-hydration effect: not authenticated → collapsed; not pinned → collapsed; pinned → restore persisted `panelCollapsed`.
- `togglePanelPinned` captures the current `panelCollapsed` into `collapsedKey` at pin time (same "capture current visible state at pin time" rule as nav groups) so pinning a freshly-collapsed panel doesn't restore a stale expanded value next load.
- The sidebar persists across route changes (`AuthenticatedLayout`), so manual expand survives in-session navigation; a full reload returns to collapsed unless pinned.


### UI conventions

- Icon: `Pin` (lucide) when pinned, `PinOff` when unpinned.
- Visibility: pinned → fully opaque, `text-primary`; unpinned → hidden by default, fades in at `opacity-70` on parent hover, `opacity-100` on direct hover/focus. Tag the parent container with `group/<name>` and reference `group-hover/<name>:opacity-70`.
- Tooltip: `"Pin section"` when unpinned, `"Unpin (auto-collapse)"` when pinned, on `side="right"`.
- The pin must not toggle its host collapsible. Always `e.preventDefault(); e.stopPropagation()` in the pin click handler.

### Position the pin OUTSIDE the inline flow

The pin button must NOT live as an inline child of the row's main button — putting it in an `ml-auto` wrapper next to the chevron eats ~24px of inline width and wraps multi-word section titles (`Warehouse Cluster`, `Labor Management`) onto two lines. Instead:

- Render the pin as an absolutely-positioned **sibling** of the toggle button. Both live inside a `relative` container (e.g. `SidebarMenuItem`, which is already `group/menu-item relative`).
- Place it at `right-7` so it slots just to the left of the chevron (the chevron sits at `~right-2` thanks to the menu button's `p-2`). Hide it in icon-collapsed mode with `group-data-[collapsible=icon]:hidden`.
- Keep the toggle button's original child layout (icon, label, badge, chevron) unchanged so the section title gets its full natural width.
- Add `truncate` to the title span as a safety net so unusually long titles ellipsize instead of overlapping the pin.

Because the pin is now a sibling (not nested inside the trigger's `<button>`), it can be a real `<button type="button">` — no `<span role="button">` workaround needed, and the click handler doesn't need `stopPropagation` to keep the collapsible from toggling.

#### Vertical anchor — do NOT center on the `<li>` (fixed 2026-05-31)

The absolute-sibling container (`SidebarMenuItem`) wraps **both** the header toggle button **and** the expanded `CollapsibleContent` (all sub-items). So `top-1/2 -translate-y-1/2` does not center the pin on the header row — it centers it on the *whole expanded section*, dropping the pin into the vertical middle of the open sub-menu (it visibly floated next to the wrong child row, e.g. beside "Shift Productivity" when "Labor Management" was the pinned/open group).

Anchor the pin to a **fixed top inset matching the header button**, not a percentage center:

- Header `SidebarMenuButton` is `h-8` (32px); the pin is `size-5` (20px). `(32 − 20) / 2 = 6px` → use `top-1.5` and drop `top-1/2 -translate-y-1/2`. This keeps the pin on the header row whether the section is open or closed. (Mirrors shadcn's `SidebarMenuAction`, which uses `top-1.5` for default-size buttons.)
- The `OnlineUsersPanel` pin is the exception: its wrapper (`div.relative.flex.items-center`) contains *only* the header row (the collapsible body is a sibling outside that div), so `top-1/2 -translate-y-1/2` is correct there and was left as-is.
- Touch target: both pins add `after:absolute after:-inset-1.5` to widen the hit area on coarse pointers (RF/operator devices) without growing the visual footprint.


### When you DO have to nest

If the structure absolutely forces nesting inside a `<button>` (e.g. the host element exposes no `relative` ancestor for sibling positioning), fall back to a `<span role="button" tabIndex={0}>` with both `onClick` and `onKeyDown` (Enter/Space) for ARIA-correct button semantics, and call `e.stopPropagation()` in the click handler so the outer button doesn't toggle. But prefer the absolute-sibling pattern above whenever possible.

## Related
- [[Implement-Sidebar-Pin-Lock-Feature]]
- [[ZustandStores - State Management]]
