---
tags: [type/debug, status/active, domain/frontend]
created: 2026-04-25
---
# Fix: Warehouse Map `npm run build` errors

## Purpose / Context
After staging the warehouse-map feature batch (asset overlay, embeddable widget, polygon draw layer, etc.), `npm run build` (`tsc -b && vite build`) failed with 11 TypeScript errors across three files. This note captures the root causes and the fixes so the same class of error is avoided next time.

## Errors

### 1. `src/components/warehouse-map/asset-position-overlay.tsx`
- `(94,32) TS2503: Cannot find namespace 'JSX'.` — explicit `: JSX.Element | null` return type. With `"jsx": "react-jsx"` (modern automatic runtime) the global `JSX` namespace is not in scope unless `React` is imported as a namespace.
- `(111,37) TS2589: Type instantiation is excessively deep…` and `(112,15) TS2769: No overload matches this call.` — `supabase.from('warehouse_asset_position_latest')` is a view/table not yet present in the generated `database.types.ts`, so the literal-string overload bails out and TS resolves to `never`.
- Same TS2769 at line 167 for `supabase.from('warehouse_assets')`.
- Subsequent TS2339 (`Property 'active' / 'display_name' / 'kind' / 'color' does not exist…`) cascade off the `SelectQueryError` shape returned by the resolved-to-`never` overload above.

### 2. `src/components/warehouse-map/map-canvas.tsx`
- `(341,9) TS2322: Type '(e: KonvaEventObject<MouseEvent>) => void' is not assignable to type '(evt: KonvaEventObject<TouchEvent, …>) => void'.` — `onTap` on Konva Stage expects a `TouchEvent` handler, but the same `handleStageClick` (typed `MouseEvent`) was wired to both `onClick` and `onTap`.

### 3. `src/components/warehouse-map/warehouse-map-widget.tsx`
- `(129,37) TS2589` + `(130,15) TS2769` — same root cause as (1): `supabase.from('warehouse_location_mappings')` is not in `database.types.ts`.

## Fixes

### A. `// @ts-nocheck` for files querying new tables (consistent with rest of feature)
The codebase already uses this pattern in `warehouse-map.service.ts`, `location-detail-panel.tsx`, and `warehouse-location-map.tsx`. Added the same two-line preamble to:

```
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck - New warehouse map tables (...) not yet in generated database.types.ts
```

Applied to:
- `src/components/warehouse-map/asset-position-overlay.tsx` (warehouse_assets, warehouse_asset_position_latest)
- `src/components/warehouse-map/warehouse-map-widget.tsx` (warehouse_location_mappings)

**Followup (when migrations 235-240+ types are regenerated):** Drop the `@ts-nocheck` directives from these files and `warehouse-map.service.ts`, `location-detail-panel.tsx`, `warehouse-location-map.tsx`.

### B. Drop unsupported `JSX.Element` return type
In `asset-position-overlay.tsx`, removed the explicit `: JSX.Element | null` return-type annotation on the component. With the new JSX transform, TS infers the return type fine. Alternative would be `import type { JSX } from 'react'` then `JSX.Element`, but inference is simpler and matches the rest of the warehouse-map components.

### C. Widen Konva click handler to accept `MouseEvent | TouchEvent`
In `map-canvas.tsx`:

```ts
const handleStageClick = useCallback(
  (e: KonvaEventObject<MouseEvent | TouchEvent>) => { … },
  [editMode, onAisleAdd, stageToWorld]
)
```

Function parameters are contravariant, so a function accepting `MouseEvent | TouchEvent` is assignable to slots expecting just `MouseEvent` (`onClick`) or just `TouchEvent` (`onTap`). The handler body only touches `e.target.getStage()` which exists on both event types, so no runtime change.

## Pattern: New Supabase tables/views and `database.types.ts`
Whenever a feature lands a migration ahead of the next `database.types.ts` regen cycle, any module calling `supabase.from('<new_table>')` or `.rpc('<new_fn>')` will hit `TS2769`/`TS2589`. Two acceptable workarounds:

1. File-level `// @ts-nocheck` with the eslint-disable preamble — fastest, keeps the rest of the codebase strict, easy to grep-and-remove later. Use this when the file is heavily DB-bound (the warehouse-map feature uses this).
2. Per-call cast: `supabase.from('new_table' as never).select('*' as any)` — narrower escape hatch, but noisier and harder to clean up.

**Always prefer (1)** for warehouse-map files until the types are regenerated, to keep the cleanup mechanical.

## Verification
```
npm run build
# > tsc -b && vite build
# ✓ built in 10.31s
# exit 0
```
All three files report no linter errors after the changes.

## Related
- [[Fix-Warehouse-Map-Pre-Commit-ESLint-Errors]]
- [[WarehouseMapWidget-Embeddable-Mini-Map]]
- [[Warehouse Map - Feature Module]]
- [[2026-04-25]]
