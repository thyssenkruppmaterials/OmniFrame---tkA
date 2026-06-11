---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-06-10
---
# Pick-Scenario Simulation — Live Virtual Pickers in the 3D Location Tab

## Purpose / Context
"Run live scenarios / advanced pick-path mapping": virtual pickers walk REAL
pick tours (existing `get_pick_tour` A* RPC over the aisle graph) through the
isometric scene with live KPIs and a congestion heatmap. Client-side only —
no new tables, no realtime channels (policy-compliant).

## Details
All under **`scene3d/simulation/`**, which is **excluded from the
feature-warehouse-3d manualChunks match** (the chunk sits at the 500 KB gate;
sim ships as its own lazy chunks: SimulationLayer / SimulationPanel /
simulation.store).

- **`sim-core.ts`** (pure, 13 tests): `buildPath` (arc-length param),
  `samplePath` (position + heading, zero-length-joint safe), `buildTour`
  (PickTourLeg[] → one path + per-bin stop distances, dedups joint points),
  `tickAgent` (walking/picking/done state machine that **rolls leftover dt
  across phase boundaries** → frame-rate independent), `scenarioKpis`
  (picks/labour-hr, m/pick), `accumulateHeat` (presence-seconds per 1 m cell).
- **`simulation.store.ts`** (zustand): hot state (agents, clock, heat map) is
  **mutated in place** and read imperatively by useFrame; the reactive
  `version` counter bumps ≤2×/sim-second for the DOM panel. `start()` shuffles
  the mapped-bin pool across N pickers and routes each tour via
  `warehouseMapService.getPickTour`; clear error message when the aisle graph
  is missing. Completed runs append to a short `runs` history for comparison.
- **`SimulationLayer.tsx`** (in-canvas): useFrame ticks the engine and calls
  `invalidate()` → keeps the demand frameloop alive while running. **Gotcha:**
  the paused→running edge needs a React commit to schedule the first frame —
  the layer subscribes to `status` + an effect calls `invalidate()`. Agent
  markers (capsule + heading nose + pulsing pick ring + name tag) update
  positions imperatively; tours render as static colored lines + stop discs;
  congestion is ONE InstancedMesh rebuilt per version bump (top-4000 cells,
  green→amber→red ramp), disposed by hand (fiber doesn't auto-dispose
  `<primitive>` payloads).
- **`SimulationPanel.tsx`**: pickers / bins-per-picker / walk speed / pick
  time / start bin (datalist capped at 500), run-pause-resume-reset, 1-10×
  time scale, live KPIs + per-agent rows, congestion toggle, run history.
  Unmount resets the store so markers never linger.
- Shell wiring: `Simulate` HUD button (view mode only; `enterEdit` closes it);
  bins pool = unique `mappings.storage_bin`.

## Future hooks
- Multi-floor tours (stops carry floor via RoutePoint), collision/avoidance,
  what-if slotting (run vs run comparison is already in `runs`).

## Related
- [[Floor-Plan-Envelope-3D]]
- [[ADR-Location-Tab-Isometric-3D-Overhaul]]
- [[Scene3D-Catalog-Expansion-And-Perf]]
