---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-06-11
---
# WebGPU-TSL-R3F-Pattern

## Purpose / Context
Canonical way to run three's WebGPURenderer (with automatic WebGL2 fallback) inside @react-three/fiber v9 in OmniFrame, writing shaders in TSL so one graph compiles to WGSL **and** GLSL. First used by the supply-chain globe; reuse for any future neon/flow visualization.

## Details
```tsx
import * as THREE from 'three/webgpu'   // NOT 'three' — core classes are shared via three.core.js
<Canvas
  frameloop='always'                    // TSL `time` only advances on render
  dpr={[1, 2]} performance={{ min: 0.5 }}
  gl={async (props) => {
    const renderer = new THREE.WebGPURenderer({ ...(props as any), antialias: true })
    await renderer.init()               // forgetting this = silent blank canvas
    const isWebGPU = (renderer.backend as any).isWebGPUBackend === true
    return renderer
  }}
>
```
- Standard JSX elements (`<mesh>`, geometries) work untouched; attach node materials via `<primitive object={mat} attach='material' />` or the `material={...}` prop — avoids the `extend(THREE)`/module-augmentation type dance entirely.
- TSL material: `new MeshBasicNodeMaterial()`; set `colorNode`/`opacityNode`/`positionNode`. Animate with `time`, vary per-instance with `uniform()` and update `.value` — never rebuild graphs.
- Comet pulse along a TubeGeometry: `uv().x.mul(pulses).sub(time.mul(speed)).add(phase).fract().pow(6)` + AdditiveBlending + `depthWrite:false`.
- Fresnel: `positionWorld.sub(cameraPosition).normalize().dot(normalWorld).abs().oneMinus()`.
- Selective bloom (r183): material opts in via `material.mrtNode = mrt({ bloomIntensity: node })`; pipeline = `new THREE.RenderPipeline(gl)` + `pass(scene,camera).setMRT(mrt({output, bloomIntensity: float(0)}))` + `bloom(color.mul(mask))`; render in `useFrame(() => pp.render(), 1)`. Works under the WebGL2 fallback too. @react-three/postprocessing does NOT work under WebGPU.
- drei: OrbitControls + Html are safe under WebGPU; avoid MeshTransmissionMaterial/MeshReflectorMaterial and raw-GLSL shaderMaterial helpers.
- Avoid `.step()` method form (arg-order trap) — use `.smoothstep(a, b)`.
- **Always pair the async `gl` factory with a `SizeSync` child** (`useThree` size/dpr → `gl.setPixelRatio` + `gl.setSize(w, h, false)` in an effect). R3F can apply its initial size while `renderer.init()` is still pending; on Windows/D3D the MSAA color buffer then stays at the 300×150 canvas default and every pass fails validation ("resolve target size does not match"). See [[Fix-Supply-Chain-WebGPU-Resize-Mismatch]].
- Bundle: `three/webgpu` + `three/tsl` are caught by the existing `/three/` manualChunks match → budget-exempt `vendor-three`.

## Related
- [[Build-Supply-Chain-Mapping-3D]]
- [[Scene3D-Catalog-Expansion-And-Perf]]
