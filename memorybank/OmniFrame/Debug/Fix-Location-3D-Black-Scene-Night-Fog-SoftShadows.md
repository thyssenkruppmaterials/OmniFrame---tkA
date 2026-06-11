---
tags: [type/debug, status/active, domain/frontend]
created: 2026-06-10
---
# Fix — Location Tab 3D Scene Renders All Black / Models Invisible

## Symptom
Opening Inventory → Location tab: the 3D scene loads "all black", no racks or
models visible. Distinct from the earlier CSP crash
([[Fix-Location-3D-Scene-CSP-HDRI-Font-Crash]]) — no errors, the canvas runs,
everything is just invisible.

## Root causes (three, compounding)

1. **Fog anchored at the world origin, not the camera.** `use-weather-scene.ts`
   set `fogNear = max(30, span*0.9)`, `fogFar = max(120, span*3.2)`, but the iso
   camera sits `isoCameraDistance(span) = span*2 + 60` meters away. For a 12 m
   layout the whole scene sat at fog factor ~0.6 **even in daylight** (washed
   out), and deeper at night.

2. **Night atmosphere had no legibility floor.** Night backgrounds were
   near-black (`#1a2238`-class) with sun 0.35 / ambient 0.28; combined with #1,
   models fully dissolved into the background. Critically, the weather location
   defaults to **Derby, UK** (`use-geolocation.ts` DEFAULT_LOCATION; auto-detect
   is never invoked) — so for a US user every evening/overnight session rendered
   the "night" mood: a black page. `weatherOverlayEnabled` defaults true.

3. **drei `<SoftShadows>` (PCSS) intermittently killed the entire opaque pass.**
   It patches three's global shader chunks at mount; against the installed three
   (which deprecates `PCFSoftShadowMap`) roughly half of page loads rendered all
   lit opaque materials invisible (only lines/text/transparent survived, over a
   uniform ground-color fill). Verified by repeated headless loads: 6/6 broken→ok
   after removal; 8/8 ok in the final soak.

## Fix
- `scene-config.ts`: new `isoCameraDistance(span)` shared by `CameraRig` and the
  fog math. Fog is now camera-relative: `fogNear = camDist + span*0.9`,
  `fogFar = camDist + span*3.2 + 60` — only the distant ground fades.
- `use-weather-scene.ts`: night backgrounds lifted to "dusk blue" tokens;
  legibility floors `MIN_SUN 0.85 / MIN_AMBIENT 0.45 / MIN_HEMI 0.5 / MIN_ENV
  0.55`. Mood may dim the scene, never erase it.
- `WarehouseScene3D`: **editing always forces the neutral daylight atmosphere**
  (`enabled: weatherOverlayEnabled && !editing`).
- `LightingRig`: `<SoftShadows>` removed (comment explains why); plain PCF at
  2048px looks equivalent for the miniature aesthetic. CDN HDRI replaced by a
  **procedural `<Environment>`** (3 Lightformers tinted by the weather mood,
  re-baked via `key` on mood change) — no raw.githack fetch at all anymore.
- `WarehouseScene3D`: `SceneCanvasBoundary` (readable fallback + retry instead
  of a black rectangle) and `webglcontextlost/restored` handlers (preventDefault
  → browser auto-restore + toasts).

## Repro / verification harness
New DEV-only route **`/scene3d-harness`** mounts `WarehouseScene3D` with a
synthetic layout (no auth/Supabase). Supports `?quality=low|medium|high`.
Headless Playwright scripts force night via Open-Meteo interception. This is how
the SoftShadows flake was bisected (high-vs-medium quality A/B).

## Related
- [[Fix-Location-3D-Scene-CSP-HDRI-Font-Crash]]
- [[ADR-Location-Tab-Isometric-3D-Overhaul]]
- [[Build-Mode-Minecraft-Style-Placement]]

## Follow-up (same day) — deployed site still black + troika worker error
The user's deployment kept showing black with `Uncaught (in promise) Error:
Worker module function was called but 'init' did not return a callable
function` (vendor-three / troika). Diagnosis: the deployed container predates
ALL of these fixes (the work is in the uncommitted working tree — frontend
dist and the CSP header ship from the same FastAPI deploy). The troika error
is the OLD CSP (no `worker-src 'self' blob:`) blocking the SDF blob worker
*asynchronously*: the worker constructs but its script never runs, a failure
mode troika does NOT fall back from (a synchronous constructor throw it does).

**Hardening:** `configureTextBuilder({ useWorker: false })` at scene3d module
scope (troika-three-text added as a direct dep @0.52.4 + local ambient .d.ts —
it ships untyped). Labels now build SDFs on the main thread: immune to CSP
worker policy AND bundler/minifier worker-bootstrap breakage. Verified by
building prod and loading it with `window.Worker` hard-blocked for blob: URLs —
scene + labels render, zero errors. `/scene3d-harness` now also runs on a
locally-served prod build (localhost guard, not just import.meta.env.DEV).

**Deploy requirement:** ship the whole working tree (frontend + api/main.py
CSP) — partial deploys reproduce the black screen.
