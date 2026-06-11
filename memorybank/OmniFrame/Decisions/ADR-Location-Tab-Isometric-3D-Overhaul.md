---
tags: [type/decision, status/active, domain/frontend]
created: 2026-06-07
---
# ADR — Location Tab Isometric 3D Scene Engine Overhaul

## Purpose / Context
The inventory **Location tab** rendered the warehouse as a flat **react-konva 2D floor plan** (`map-canvas.tsx`), with the legacy `warehouse-3d-view.tsx` as a dark, **view-only** 3D toggle that force-exited on any edit (`warehouse-map-store.ts:160`). The brief: a clear **45° isometric miniature 3D** scene with soft PBR materials, gentle lifelike lighting/shadows, **live weather mood**, a soft solid-color background, full configurability (create/move racks, add desks/offices/tables), and zoom + fly-through — i.e. make 3D the real primary experience.

## Decision
Build a modular **isometric 3D scene engine** at `src/components/warehouse-map/scene3d/` and make it the **default** render path; keep Konva 2D as an opt-in toggle + the a11y list fallback. Reuse 100% of the data model, `warehouse-map.service.ts` persistence (revisions/publish), permission gate, and Zustand store — only the render/interaction layer changes.

User-locked options (2026-06-07): **3D primary / 2D toggle**; **parametric primitives first** (glTF later); **desktop-tablet rich** (RF keeps the Konva `warehouse-map-widget`); **locked orthographic isometric** (45° / 35.264°) plus Orbit + Fly modes.

## Details
- **Scene graph:** `WarehouseScene3D` (Canvas + HUD, drop-in for legacy `Warehouse3DView`) → `WarehouseScene` → `CameraRig` (iso ortho / orbit / fly) + `LightingRig` (sun + hemi + IBL + drei `SoftShadows` + ACES tone map) + `WeatherLayer` (rain/snow particles, thunder) + objects (`Ground`, `BuildingShell`, `ZoneVolume`, `RackInstanced`, `Overlays`).
- **Perf:** rack cells are an **InstancedMesh per rack** (was one mesh per cell — the legacy bottleneck).
- **Coordinate parity preserved exactly** in `scene3d/coords.ts`: `WORLD_SCALE=1/100`, 2D x→3D x, 2D y→3D z, `rotationY=-(deg·π/180)`. Unit-tested in `scene3d/__tests__/coords.test.ts`.
- **Weather mood:** `scene3d/use-weather-scene.ts` adapts the existing `useWeather` (Open-Meteo, TanStack Query 5-min poll — **realtime-policy compliant**, no `supabase.channel`) → sky/fog/sun(sunrise→sunset arc)/precipitation. Editor-neutral baseline (`NEUTRAL_ATMOSPHERE`) when weather is off.
- **Bundle:** `three` + pure-JS satellites (three-stdlib, troika-three-text, meshline, gainmap, maath…) vendor-split into **`vendor-three`** (added to `LAZY_VENDOR_EXEMPT`). `@react-three/fiber`/`drei` are React-coupled → NOT vendor-split; they ride the lazy first-party `feature-warehouse-3d` chunk (382 KB < 500). The Konva shell chunk stays under budget because the scene is `React.lazy`-loaded.
- **Pre-existing red gates (not caused here):** bundle total (10.6 MB vs 7.5 MB; `feature-admin`/`feature-rf-interface` over 500 KB) and lint ratchet (98 vs 16). New 3D code is per-chunk compliant and warning-clean.

## Status
Phases 0–3 shipped (foundation, isometric camera, instanced render parity, soft PBR + soft shadows + ACES, weather). Pending: Phase 4 configurable objects + editor gizmos (new `warehouse_scene_objects` / `warehouse_object_types` tables, FurnitureLibraryPanel, TransformControls, zone→office extrusion), Phase 5 free-fly + undo/redo + versioned scenes, Phase 6 LOD / multi-floor / scale.

## Related
- [[Realtime-Presence-Browser-Hardening]]
- [[Roadmap-Rust-WS-Unlocks]]
