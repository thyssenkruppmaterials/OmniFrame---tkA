---
tags: [type/implementation, status/active, domain/frontend, domain/database]
created: 2026-06-11
---
# Facility Layout Templates — Save / Load / Multi-Facility

## Purpose / Context
Save the current Location-tab layout as a named facility template ("Standard
DC", "Cold Storage"…) and stamp out NEW facilities (multiple floor plans /
buildings) from the library.

## Details
- **Migration 336 `warehouse_layout_templates`** (file + APPLIED to prod
  `wncpqxwmbxjgxvrpcake` via MCP): org-scoped rows — name, `facility_kind`
  (free text; frontend list: warehouse/distribution_center/cold_storage/
  manufacturing/cross_dock/fulfillment/yard/other), description,
  **snapshot jsonb** (versioned layout document), **stats jsonb**
  (denormalised counts for the list UI). RLS mirrors 335 (read = org, write =
  superadmin/admin/manager/logistics_coordinator).
- **`warehouse-map/layout-template-core.ts`** (pure, 6 tests; shell-level —
  MUST NOT import scene3d/* or the lazy 3D chunk would load at first paint):
  `snapshotFromLayout` captures building_outline, canvas_settings (floor-plan
  envelope + wall_height), grid/scale, zones, racks (incl.
  metadata.appearance), scene objects (incl. metadata.style), aisle graph.
  Old ids survive only as remap refs (`zone_ref`, edge `from_ref/to_ref`);
  dangling refs nulled/dropped. `templateStats` (locations = Σ rows×cols,
  area from envelope else bbox), `validateSnapshot` (never crash on old docs).
- **`warehouse-layout-templates.service.ts`**: `captureFromMap` (fetches
  layout + scene objects + aisle graph in parallel), `createFacility(template
  | null, {warehouse_code, name})` → createMap → updateMap settings → zones
  (ref→id map) → racks (zone remap) → scene objects bulkCreate → aisle nodes
  → edges rewired. **Location mappings deliberately not copied** (SAP
  bins are facility-specific). `list()` degrades to [] pre-migration.
- **`FacilityTemplatesDialog`** (shell dialog, open-prop pattern like
  DxfImportDialog): save-current form + library list (kind badge, stats
  line, inline new-facility form per template, blank-facility option,
  two-step delete). On create → invalidate + `onFacilityCreated(code)` →
  shell switches the picker to the new facility.
- **KEY shell fix:** the warehouse picker was fed ONLY by
  `LX03DataService.getWarehouses()` (SAP inventory codes) — template-created
  facilities have no LX03 data, so `listMaps()` was added to
  warehouse-map.service and the shell merges map codes into the picker list
  (`['warehouse-maps-list']` query). Toolbar "More → Facilities & templates"
  + a "From template…" button on the No-Map empty state.

## Related
- [[Floor-Plan-Envelope-3D]]
- [[Rack-And-Object-Design-Controls-3D]]
- [[Vehicle-Fleet-And-Catalog-Expansion-2]]
