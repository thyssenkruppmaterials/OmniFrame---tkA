---
tags: [type/debug, status/active, domain/frontend, domain/backend]
created: 2026-04-25
---
# Fix: MapStatistics Shape Drift Crash

## Symptom
```
TypeError: Cannot read properties of undefined (reading 'toLocaleString')
  at MapLegend (map-legend.tsx:89:36)
```

## Cause
The SQL `get_warehouse_map_statistics(map_id)` (migration 202) returns:
```json
{
  "counts_by_status":   { "active": N, "maintenance": N, ... },
  "occupied_bins":      N,
  "total_mapped_bins":  N,
  "utilization_pct":    N,
  "unmapped_bins":      N,
  "last_lx03_sync":     timestamp
}
```

But the frontend `MapStatistics` type in `warehouse-map/types.ts` declares `total_locations`, `active_count`, `maintenance_count`, etc. — fields the SQL never returns.

`MapLegend` did `stats.total_locations.toLocaleString()` and crashed because `total_locations` was `undefined`.

## Fix
Normalize at the **service boundary** so every consumer receives the typed shape:
```ts
// warehouse-map.service.ts
async getMapStatistics(mapId: string): Promise<MapStatistics> {
  const { data } = await supabase.rpc('get_warehouse_map_statistics', { p_map_id: mapId })
  const counts = data?.counts_by_status ?? {}
  const totalMapped = data?.total_mapped_bins ?? 0
  const occupied = data?.occupied_bins ?? 0
  return {
    total_locations: totalMapped,
    active_count:    counts.active        ?? 0,
    maintenance_count: counts.maintenance ?? 0,
    shutdown_count:  counts.shutdown      ?? 0,
    blocked_count:   counts.blocked       ?? 0,
    reserved_count:  counts.reserved      ?? 0,
    empty_count:     Math.max(totalMapped - occupied, 0),
    occupied_count:  occupied,
    stale_count:     0,
    orphaned_count:  0,
    total_stock:     0,
    utilization_pct: data?.utilization_pct ?? 0,
    unmapped_bins_count: data?.unmapped_bins ?? 0,
    last_lx03_sync_at: data?.last_lx03_sync ?? null,
  }
}
```

Also added defensive `?? 0` in the legend so future drift renders "0" instead of crashing.

## Lesson
When a typed contract drifts from a JSON-returning Postgres function, **normalize at the service boundary**, not at every call site. One adapter is cheaper than fifteen `?? 0` checks scattered across components.

## Related
- [[Warehouse-Map-Phase-A-D-Complete]]
- [[Fix-PolygonDrawLayer-Infinite-Loop]]
