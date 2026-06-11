---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-04-25
---
# WarehouseMapWidget — Embeddable Mini Map

## Purpose / Context
Lightweight, embeddable warehouse-map widget at `src/components/warehouse-map/warehouse-map-widget.tsx` for use next to lists in features like Cycle Count, Putaway, and Picking. Renders the current warehouse layout (zones + racks + bins) with optional bin highlights and a route polyline. No editing toolbar — minimal UI consisting of zoom buttons, a fit-to-bounds button, and a tiny status legend.

## Details

### Public API
```ts
interface WarehouseMapWidgetProps {
  mapId: string
  highlightedBins?: string[]
  routePolyline?: { x: number; y: number }[]
  floorLevel?: number          // default 0
  height?: number              // default 320
  onCellClick?: (mappingId: string) => void
  className?: string
}
```
Named exports: `WarehouseMapWidget`, `WarehouseMapWidgetProps`.

### Data sources
- Layout: `WarehouseMapService.getInstance().getMapLayout(mapId)` (RPC `get_warehouse_map_layout`).
- Mappings: inline Supabase query — `supabase.from('warehouse_location_mappings').select('*').eq('map_id', mapId)`.
- Both wrapped in `useQuery` with `staleTime: 60_000`.

### Rendering
- `react-konva` (`Stage`, `Layer`, `Line`, `Rect`, `Group`, `Circle`, `Text`) — same primitives as the upcoming `map-canvas.tsx` rewrite.
- Zones rendered as filled `Line` polygons (real polygon points, not bounding boxes).
- Racks rendered as filled rounded `Rect`s with a small label `Text`. Sub-grid cells colored by `STATUS_COLORS[operational_status]`.
- Highlighted bins: pulsing `Circle` (radius 12) at the cell center, animated via `requestAnimationFrame` updating `opacity` and `dashOffset`.
- Route polyline: glow `Line` + dashed marching-ants `Line` with `stroke=#22d3ee`, `strokeWidth=4`, `dash=[10,8]`.

### Interaction
- Mouse wheel: zoom around cursor, clamped to 0.2..5.
- Drag: pan via mouse-down anchor.
- Click on a cell: `onCellClick(mapping.id)`.
- Toolbar: ZoomIn / ZoomOut / Fit-to-bounds (Maximize), each as a 6×6 ghost `Button`.

### Layout / sizing
- Parent `<div>` measured with a `ResizeObserver` on `containerRef`.
- World bounds computed from zone polygon points + rack AABBs.
- `fitViewport(bounds, size)` centers and scales the layout with 24px padding on first load (and via the fit button).

### Constraints honored
- Self-contained; no global stores.
- ~460 lines, no narrative comments, JSDoc on the component only.
- Lazy/light to mount: only two queries, no toolbar/sidebar/3D viewer mounted.

## Usage example (Cycle Count)
```tsx
import { WarehouseMapWidget } from '@/components/warehouse-map/warehouse-map-widget'

<WarehouseMapWidget
  mapId={activeMapId}
  highlightedBins={pendingCounts.map((c) => c.storage_bin)}
  routePolyline={suggestedRoute}
  height={360}
  onCellClick={(mappingId) => openCountForm(mappingId)}
/>
```

## Related
- [[Warehouse Map - Feature Module]]
- [[ADR-Floor-Mapping-Build-vs-Buy]]
