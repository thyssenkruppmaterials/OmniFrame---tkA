---
tags: [type/debug, status/active, domain/frontend, domain/backend]
created: 2026-06-08
---
# Fix — Location Tab 3D Scene Crash (CSP blocks drei HDRI + troika font/worker)

## Symptom
Opening the Inventory → **Location tab** (the isometric `WarehouseScene3D` from
[[ADR-Location-Tab-Isometric-3D-Overhaul]]) blanked the 3D view and spammed the
console:

```
Connecting to 'https://raw.githack.com/pmndrs/drei-assets/.../hdri/lebombo_1k.hdr'
  violates the following Content Security Policy directive: "connect-src 'self' …"
Uncaught Error: Could not load lebombo_1k.hdr: Failed to fetch
THREE.WebGLRenderer: Context Lost.
```

The HDRI fetch rejection was caught by an error boundary, which tore down the
`<Canvas>` and **lost the WebGL context** — the whole scene died over one
cosmetic asset.

## Root cause
The crash was a **CSP block, not a network failure** ("violates … Content
Security Policy directive"). The deployment can reach the CDN; the prod CSP in
`api/main.py` simply didn't whitelist it. The 3D scene makes three external/blob
requests that the strict CSP forbade:

1. **drei `<Environment preset>`** (`scene3d/LightingRig.tsx`) streams an HDRI
   for image-based lighting from `https://raw.githack.com/pmndrs/drei-assets/…`
   → blocked by `connect-src` → **threw → scene crash** (the reported error).
2. **troika `<Text>`** labels (`scene3d/objects/{SceneObject,RackInstanced,ZoneVolume}.tsx`)
   pass no `font`, so troika resolves glyphs via `cdn.jsdelivr.net`
   (unicode-font-resolver). **Latent** — masked by #1; would have broken every
   scene label next.
3. **troika SDF generator** runs in a `new Worker(URL.createObjectURL(Blob…))`
   → blocked by `worker-src` falling back to `default-src 'self'` (no `blob:`).
   **Latent** — would log a CSP violation the moment labels rendered.

## Fix
Targeted at the actual root cause (CSP) — the HDRI IBL is the documented design
intent (ADR: "sun + hemi + IBL + SoftShadows + ACES"), so whitelist rather than
rip it out. Plus a frontend resilience guard so the scene never again dies over
a cosmetic asset.

**`api/main.py`** (both the `debug` and prod CSP branches):
- `connect-src` += `https://raw.githack.com https://cdn.jsdelivr.net`
  (drei HDRI presets + troika font resolver/files).
- new directive `worker-src 'self' blob:` (troika SDF blob worker).
- The CSP test (`api/tests/test_security_headers.py`) only asserts `default-src`
  is present, so it stays green.

**`src/components/warehouse-map/scene3d/LightingRig.tsx`** — wrapped the
`<Environment>` in its own `<Suspense fallback={null}>` **and** a tiny
`IBLBoundary` error boundary (renders `null` on failure). Now a blocked/failed
HDRI degrades to the direct sun + hemisphere + ambient lights (reflections
soften) instead of crashing the `<Canvas>` and dropping the WebGL context. It
also stops the HDRI's load from blocking the rest of the scene's first paint.

## Not changed (explained, in-scope review)
- **`rust-work-service` `/api/v1/notifications/` 404** — already an intentional
  *soft-fail*: `notifications.client.ts` probes once, caches `unreachable`, and
  returns an empty feed (the bell is an optional feature; the 404 is a single
  network-layer log before the JS sees it). Global (every route), not a
  Location-tab bug. Fixing it means deploying the route on rust-work-service.
- **`THREE.Clock … deprecated, use THREE.Timer`** — a `console.warn` emitted by
  three/drei internals (`vendor-three` chunk), not our code. Harmless; clears
  on a future three/drei bump.

## Verification
- ESLint clean on `LightingRig.tsx`; TS diagnostics clean (lint ratchet
  unaffected — no new warnings/suppressions).
- CSP edits are header-string only; `test_security_headers.py` unaffected.
- Requires a **main-app redeploy** for the new CSP header to ship (the header is
  set by the FastAPI middleware that also serves `dist/`).

## Related
- [[ADR-Location-Tab-Isometric-3D-Overhaul]]
- [[Fix-Location-3D-HUD-Overlap-And-Contrast]]
