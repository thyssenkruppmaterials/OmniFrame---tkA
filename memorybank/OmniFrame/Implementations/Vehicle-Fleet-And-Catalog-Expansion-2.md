---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-06-11
---
# Brand-Spec Vehicle Fleet + Catalog Expansion 2 (3D Location Tab)

## Purpose / Context
User asked for "a slew more objects" + real forklift variations (Raymond,
Crown) "rendered off real-life specs". Researched published dimensions
online, then modelled parametrically (no glTF — parametric-first per the ADR).

## Details
- **Chunk split FIRST** (the 491→500 KB wall): vite manualChunks now routes
  `scene3d/objects/recipes-*` into **feature-warehouse-recipes** (own chunk,
  ~36 KB, statically imported by SceneObject → loads in parallel behind the
  same lazy boundary). feature-warehouse-3d fell to **479.6 KB** (~20 KB
  headroom restored).
- **`objects/recipes-vehicles.tsx`** — 7 trucks from real specs, with shared
  parts (Wheel/Mast/Forks/OverheadGuard) and brand colourways (Raymond red
  `#c2342c` + black masts, Crown beige `#d6c9a3` + black):
  - `forklift_reach` — Raymond 7500 Universal Stance (48" chassis, straddle
    baselegs + front load wheels, pantograph hint, side-stance bay) 280×122×240
  - `forklift_orderpicker` — Crown SP 3500 (man-up platform w/ rails +
    console + guard cage, 3-stage mast) 310×107×275
  - `forklift_standup` — Crown RC 5500 (compact counterbalanced chassis,
    rounded tail, integrated full-height guard) 175×107×224
  - `forklift_turret` — Raymond 9800 Swing-Reach (60" wide, man-up cab on
    towering mast, turret forks traversing SIDEWAYS) 350×152×400
  - `pallet_truck_rider` — Crown PE end-rider; `walkie_stacker`; `tugger`
  - Routing: explicit cases in SceneObject's buildKind switch (NOT an exported
    `isVehicleKind` helper — react-refresh lint forbids non-component exports
    from recipe modules).
- **New 'vehicles' catalog category** ("Vehicles & Fleet") — legacy forklift /
  pallet_jack / hand_truck / agv_robot moved in; CATEGORY_ORDER/LABEL +
  LayersPanel row added.
- **12 facility extras in recipes-extra**: semi_trailer (53-ft van w/ tandem
  axles + landing gear + lock bars), shipping_container (20-ft, ribs + lock
  rods), dumpster, ibc_tote (translucent tank in cage), floor_scrubber,
  baler, air_compressor, battery_rack (charger LEDs), propane_cage,
  eyewash_station, dock_leveler (w/ bumpers), mirror_dome (convex).
- All get the finish/glow design dial automatically (material traversal).
- `/scene3d-harness?showcase` renders every kind — new ones appear free.

## Spec sources
Raymond 7500 (raymondcorp.com, lectura-specs), Crown SP 3500 / RC 5500
profile sheets (crown.com PDFs: 42"W, RC 42×68×88"), Raymond 9800 (60" wide,
lifts to ~50 ft).

## Related
- [[Rack-And-Object-Design-Controls-3D]]
- [[Scene3D-Catalog-Expansion-And-Perf]]
- [[ADR-Location-Tab-Isometric-3D-Overhaul]]
