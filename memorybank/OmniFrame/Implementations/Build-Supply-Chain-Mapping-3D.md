---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-06-11
---
# Build-Supply-Chain-Mapping-3D

## Purpose / Context
New Testing-menu page `/admin/supply-chain-mapping`: a WebGPU-first 3D globe that maps multi-tier supply chains. Animated "light-wave" comets travel each lane in flow direction; comet color = derived lane health (nominal cyan / elevated amber / bottleneck orange / broken red, with flicker + dead gap). Downstream site risk re-propagates live when disruptions are injected from the inspector.

## Details
**Feature layout** (`src/features/admin/supply-chain-mapping/`):
- `data/` — pure, fully unit-tested (24 tests): `types.ts`, `analysis.ts` (utilization → status; flow-weighted topological health propagation via Kahn; critical path; KPIs), `demo-networks.ts` (3 scenarios: electronics ~31 nodes, automotive, pharma cold chain — real lat/lons, seeded disruptions).
- `scene/` — three/webgpu engine, React.lazy-loaded: `coords.ts` (latLng→vec3, `GreatCircleArc extends Curve` slerp + altitude lift by mode), `land.ts`+`land-data.ts` (Natural Earth 110m packed to 14 KB base64 Int16; Fibonacci-lattice + even-odd PIP → dotted landmass InstancedMesh), `materials.ts` (all TSL node materials), `Globe/FlowArcs/NodeMarkers/PostFX/SupplyChainScene`.
- `components/` — glass HUD: KpiBar, LegendPanel (doubles as status filter), InspectorPanel (disruption injector: kind + severity slider → re-analysis via useMemo).
- DEV harness `/supply-chain-harness?scenario=` (mirrors `/scene3d-harness` pattern) for headless Playwright verification.

**Key architecture decisions**
- WebGPURenderer via R3F v9 async `gl` factory (`await renderer.init()`); automatic WebGL2 fallback; backend chip shown in HUD. Verified WebGPU active in headless Chromium (`--enable-unsafe-webgpu --use-angle=metal`).
- All shader variation through uniforms (color/speed/phase/broken/emphasis) — one compiled program per material type, zero recompiles on status change. Materials created once per mount via `useState(initializer)` (avoids exhaustive-deps suppressions → lint-ratchet safe).
- Selective bloom: three r183 native `RenderPipeline` (renamed from PostProcessing) + `pass()`/`mrt({bloomIntensity})` + `bloom()` from `three/addons/tsl/display/BloomNode.js`; `useFrame(cb, 1)` takes over the R3F loop; graceful null-pipeline fallback. Vignette via `screenUV.distance(0.5).remap(...)`.
- Picking on invisible coarse hit-tubes/spheres (`colorWrite:false`) so raycasts stay cheap.

## Gotchas
- Closed GeoJSON rings break RDP simplification (first==last ⇒ baseline degenerate, all distances 0) — split at farthest point first.
- TSL: method-form `.step()` arg order is ambiguous — use `.smoothstep(a,b)`; `time` node only advances when renderer renders ⇒ `frameloop='always'`.
- Chunking: `feature-supply-chain-3d` (scene + fiber) 392.8 KB < 500 gate; page shell `feature-supply-chain` separate, placed BEFORE the `/features/admin/` catch-all in manualChunks (feature-admin already over budget). three.webgpu lands in budget-exempt `vendor-three` (now 1.59 MB).
- Exporting helper fns from component files trips `react-refresh/only-export-components`.

## Related
- [[Scene3D-Catalog-Expansion-And-Perf]]
- [[WebGPU-TSL-R3F-Pattern]]


## Update 2026-06-11 — continent drill-down level + alerts/critical-path/mode-filter
Second navigation level: **region (continent) focus** — "domestic" view of one continent's chain.
- `data/continents.ts` (pure): country→continent map + lat/lng box fallback (unmapped/transcontinental countries resolve by site coords); `continentsInNetwork` for the picker.
- `analyzeRegion(network, analysis, memberIds)` partitions lanes into intra/import/export and derives region KPIs: **import reliance** (inbound flow share crossing the border), **imports at risk** (import flow on broken/bottleneck lanes), intra flow at risk, region critical path (intra lanes only). Node risk stays the GLOBAL propagation so externally-starved sites still read starved domestically. Region = generic node-id set, so analysis has no continent dependency.
- Scene: `focusNodeIds` prop — outside lanes hidden, border-crossing lanes ghosted (ambient 0.18), outside markers dimmed to 0.15 (hover/selection always re-light, so everything stays inspectable). CameraRig now FLIES: slerp direction + lerp distance separately (straight lerp cuts a chord through the planet on cross-hemisphere flights); time-boxed 2.5 s TTL so auto-rotate can't keep the flight alive forever; zoom scales with the region's angular spread.
- `analyzeNetwork` now also returns `criticalPathLinkIds` (predecessor walk on the longest-lead-time pass) → HUD "Critical path" toggle spotlights the chain (on-path 1.45 / off-path 0.08); in region mode it spotlights the region's own path.
- New `AlertsPanel` (ranked broken>starved>bottleneck>at-risk>elevated, ties by flow, click = select+inspect, region-filtered when focused); legend gained transport-mode filters (sea/air/road/rail); inspector shows continent + corridor (Domestic · X vs X → Y) + "Focus region" button; region focus auto-disables auto-rotate.
- 52 unit tests (28 new). All 6 harness configs (`?region=`, `?critical=1`) verified headlessly under WebGPU, 0 console errors.

## Update 2026-06-11 — switchable lane styles
HUD "Lane style" select with 5 visuals, all in ONE compiled lane shader chosen by a `uStyle` uniform via nested TSL `select()` (style switching never recompiles): **pulse** (comet light-waves), **beam** (steady laser core + micro-shimmer + faint riding comet for direction), **dash** (marching ~50%-duty soft dashes), **wave** (traveling sine ripple that also displaces geometry — `positionNode = positionLocal.add(normalLocal.mul(swell))` → beaded-pearl look), **aurora** (two offset bands + hue drift toward an `offsetHSL(0.07,-0.08,0.22)` lighter tint via a second uniform color). Broken-lane flicker + mid-gap and emphasis multiply over every style. Tokens in `palette.ts` (`LaneStyle`, `LANE_STYLE_LABELS/INDEX`); harness takes `?style=`. All 4 new styles verified headlessly under WebGPU, 0 errors; chunk 384.5 KB.
