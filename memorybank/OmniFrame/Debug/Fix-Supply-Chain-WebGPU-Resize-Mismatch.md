---
tags: [type/debug, status/active, domain/frontend]
created: 2026-06-11
---

# Fix-Supply-Chain-WebGPU-Resize-Mismatch

## Purpose / Context

`/admin/supply-chain-mapping` on **Windows (D3D swapchain)** spammed the
console every frame and rendered nothing useful:

```
The resolve target [TextureView of Texture "D3DImageBacking…WebGPUSwapBufferProvider…"]
size (width: 1936, height: 844) does not match the size of the other
attachments (width: 300, height: 150).
[Invalid CommandBuffer …] is invalid due to a previous error.
… WebGPU: too many warnings, no more warnings will be reported …
```

## Root cause

**300×150 is the HTML canvas default size.** With R3F v9's **async `gl`
factory** (`await renderer.init()`), there is a race: R3F can apply its
measured size while the WebGPU backend is still initializing. The
renderer's internal **MSAA color buffer** (we pass `antialias: true`) then
stays allocated at the 300×150 default, while the canvas/swapchain texture
is resized to the real backing size (e.g. 1936×844 at dpr 2). Every render
pass that resolves MSAA → canvas then fails validation, forever — nothing
re-triggers a backend buffer re-allocation. Ordering lands differently per
platform: macOS (Metal) headless never hit it; Windows D3D did,
consistently.

## Fix

`SizeSync` component inside the Canvas
(`scene/SupplyChainScene.tsx`): re-assert the size **after** the async
init completes and on every size/dpr change. `Renderer.setSize()` calls
`backend.updateSize()`, which re-creates the MSAA color + depth buffers at
the right dimensions.

```tsx
function SizeSync() {
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return
    gl.setPixelRatio(dpr)
    gl.setSize(size.width, size.height, false) // false: R3F owns CSS layout
  }, [gl, size.width, size.height, dpr])
  return null
}
```

Children only mount once the async `gl` promise resolves, so the effect is
guaranteed to run post-init. Verified headlessly: page loaded at a 300×150
viewport then resized 5× (up to 1936×844 and back down) — WebGPU backend,
0 console errors, crisp render at every size.

## Follow-up: zoom flashing / shimmer in some browsers

Two distinct causes, fixed together:

1. **Camera flight vs user zoom** — the animated fly-to (2.5 s TTL) kept
   lerping the camera back while the user wheel-zoomed mid-flight: every
   wheel step visibly snapped between two distances ("flashing in and
   out"). Fix: listen for the OrbitControls `'start'` event (via
   `useThree((s) => s.controls)`) and null the flight — the user's hand
   always wins.
2. **Depth precision z-fighting** — `near: 1, far: 4000` left too little
   depth resolution for the surface stack (globe r=100, glow +0.1, land
   dots +0.15, base disc +0.25, ring +0.35); on browsers with
   lower-precision depth buffers the layers shimmered when zoomed close.
   Fix: `near: 10` (controls clamp the camera ≥135 from center, so the
   closest geometry stays ~35 away — nothing can reach the near plane).

Verified headlessly with 25 aggressive wheel steps starting mid-flight on
BOTH backends (WebGPU and `--disable-features=WebGPU` → WebGL2 fallback):
0 console errors, crisp surface at full zoom, no pull-back.

## Non-issues seen in the same console dump

- `THREE.Clock: deprecated, use THREE.Timer` — R3F v9 internals under
  three r183; cosmetic, not app-fixable.
- `powerPreference ignored when calling requestAdapter() on Windows` —
  Chromium notice (crbug 369219127); harmless.
- 404 on `rust-work-service…/notifications` — unrelated to this page.

## Related

- [[Build-Supply-Chain-Mapping-3D]]
- [[WebGPU-TSL-R3F-Pattern]]
