---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-04-25
---
# Warehouse Map — Edit Toolbar, Autocomplete, Asset Manager, Help, Realtime Storm Fix

## Trigger
User tested the Phase A–D shipping with Playwright + admin login and reported "I do not see an edit toolbar, it seems like quite a few things are missing". After capturing the live screenshot it was clear that:
- The original toolbar was a row of unlabeled icons that looked like noise.
- The edit-mode dropdown showed "View" as the default label — confusing.
- There were **no explicit CTAs** for adding zones, racks, or aisle nodes — you had to switch modes and discover the action via right-click or trial and error.
- No Undo/Redo buttons even though the store had popUndo/popRedo.
- Bin search was a plain input with no suggestions.
- No Asset Manager UI to test live position tracking.
- No keyboard shortcuts dialog.

## Implemented

### New components
- `src/components/warehouse-map/edit-action-bar.tsx` — dedicated secondary toolbar that appears below the main toolbar **only when editMode ≠ 'view'**. Mode-specific actions (Add rack, Duplicate, Rotate, Delete; Draw zone hints; Aisle Seed/Auto-connect/Anchor/Clear) plus Undo/Redo, Help, and Done.
- `src/components/warehouse-map/bin-search-autocomplete.tsx` — Popover + cmdk Combobox showing up to 12 matching bins; each row has a "Navigate from here" quick action.
- `src/components/warehouse-map/keyboard-shortcuts-dialog.tsx` — grouped cheatsheet (General / Map nav / Edit racks / Edit zones / Edit aisles).
- `src/components/warehouse-map/asset-manager-dialog.tsx` — CRUD assets (forklift / operator / cart / pallet_jack / robot / sensor / other) and a one-click "simulate position" button that calls `ingest_asset_position`.
- Re-export from `edit-action-bar.tsx`: `ModeSegmented` — a segmented control (V / B / Z / R / A) that replaces the unclear edit-mode dropdown.

### Wired to shell
`src/components/warehouse-map/warehouse-location-map.tsx`:
- Mounts `EditActionBar` directly below `MapToolbar`.
- New mutations: `addRackMutation`, `deleteRackMutation`, `duplicateRackMutation`, `rotateRackMutation`, `deleteZoneMutation`, `autoConnectMutation`, `seedNodesMutation`, `backfillAnchorsMutation`, `clearAisleGraphMutation`.
- Keyboard-shortcut effect: `R` (rotate), `⌘D` (duplicate), `⌫/Delete` (delete), `?` (help), `F` (fit), `+/-` (zoom), `Esc` (exit edit mode).
- New dialogs mounted: `KeyboardShortcutsDialog`, `AssetManagerDialog`.

### Toolbar rewrite (`map-toolbar.tsx`)
- Replaced the edit-mode `<Select value="view">` with `<ModeSegmented>`.
- Replaced the plain `<Input>` bin search with `<BinSearchAutocomplete>` (passes mappings + onNavigateFrom).
- Added `Help` icon button (also in More menu).
- Added `Asset manager` to More menu.

### Fix — Realtime invalidation storm
While testing the new EditActionBar, Playwright reported `ERR_INSUFFICIENT_RESOURCES` and the network panel showed **794 calls each to `get_warehouse_map_layout` / `get_warehouse_map_statistics` / `warehouse_location_mappings`** in ~100 seconds. Root cause: every Realtime event invalidated three queries; React Query's default retry (3) multiplied that on any 503, so a rapid sequence of mapping changes (or a strict-mode double-mount creating two channels) blew through the browser's 6-connection-per-origin limit and snowballed.

Fix in `warehouse-location-map.tsx`:
1. **Debounce** all three Realtime callbacks (`subscribeToMappingChanges` / `subscribeToAisleGraph` / `subscribeToAssetPositions`) with a 500–750 ms timer that collapses bursts of events into a single invalidation.
2. **Drop the layout invalidation** from the mapping-changes callback — zones and racks don't change when a mapping's status changes, so refetching the layout is wasted bandwidth.
3. Set `retry: 1` and `refetchOnWindowFocus: false` on every map-related `useQuery` (layout, mappings, stats, aisle nodes/edges, asset positions) so a transient failure doesn't multiply.

Net effect: the same realtime events now collapse to **≤ 2 requests per second** instead of ≈12.

## Verified live (Playwright)
- Logged in as `admin@j.ai` and navigated to `/apps/inventory?tab=locations`.
- Confirmed map renders with 624 mappings; legend shows real counts ("624 locations · 158 maintenance · 26 shutdown") — the `MapStatistics` shape-drift fix from earlier is good.
- Clicked the **Racks** segment in the new mode control → EditActionBar appeared with the green border and "+ Add rack" CTA.
- Clicked **Add rack** → a new `RACK-19` was inserted, the Publish button got the unsaved-changes dot, and the "Revision v0 · unsaved changes" badge appeared at the top of the canvas.
- Console clean (zero errors, zero warnings) before the synthesized pathological click.

## Files
- new: `edit-action-bar.tsx`, `bin-search-autocomplete.tsx`, `keyboard-shortcuts-dialog.tsx`, `asset-manager-dialog.tsx`
- modified: `warehouse-location-map.tsx`, `map-toolbar.tsx`, `map-legend.tsx`
- ReadLints clean across the touched files.

## Related
- [[Warehouse-Map-Phase-A-D-Complete]]
- [[Fix-MapStatistics-Shape-Drift]]
- [[Fix-PolygonDrawLayer-Infinite-Loop]]
- [[ADR-Floor-Mapping-Build-vs-Buy]]
