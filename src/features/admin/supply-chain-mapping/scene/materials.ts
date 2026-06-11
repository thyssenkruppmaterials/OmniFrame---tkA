// Created and developed by Jai Singh
// TSL node materials for the supply-chain globe. Written against
// three/webgpu so the same graphs compile to WGSL under WebGPU and GLSL
// under the automatic WebGL2 fallback. Every per-lane / per-node variation
// is a uniform (color, speed, phase, emphasis…) so all lanes share one
// compiled program and status changes never recompile shaders.
import {
  color,
  float,
  mix,
  mrt,
  normalLocal,
  normalWorld,
  positionLocal,
  positionWorld,
  cameraPosition,
  select,
  time,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl'
import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  MeshBasicNodeMaterial,
} from 'three/webgpu'
import { LANE_STYLE_INDEX, type LaneStyle } from '../palette'

/* ─────────────────────────── Lane lights ───────────────────────────────
 * Lane energy travels from supplier → consumer along the tube's U axis.
 * Five visual styles share ONE compiled graph, chosen by the uStyle
 * uniform (switching styles never recompiles):
 *   0 pulse  — comet light-waves with exponential tails
 *   1 beam   — continuous laser core with shimmer + a faint riding comet
 *   2 dash   — marching energy dashes (~50% duty cycle)
 *   3 wave   — traveling sine ripple that also swells the tube geometry
 *   4 aurora — soft flowing bands whose hue drifts toward a lighter tint
 * Status drives color; "broken" overlays a stochastic flicker + dead gap
 * mid-lane in every style; emphasis dims/boosts for selection focus.
 * ──────────────────────────────────────────────────────────────────────── */
export interface LaneMaterialHandle {
  material: MeshBasicNodeMaterial
  setColor: (hex: string) => void
  setBroken: (broken: boolean) => void
  setEmphasis: (value: number) => void
  setFlow: (pulses: number, speed: number) => void
  setStyle: (style: LaneStyle) => void
}

/** Lighter companion tint for the aurora hue drift. */
function auroraTint(hex: string): Color {
  return new Color(hex).offsetHSL(0.07, -0.08, 0.22)
}

export function createLaneMaterial(opts: {
  colorHex: string
  pulses: number
  speed: number
  phase: number
  baseGlow?: number
  broken?: boolean
  style?: LaneStyle
}): LaneMaterialHandle {
  const uColor = uniform(color(opts.colorHex))
  const uColorB = uniform(auroraTint(opts.colorHex))
  const uPulses = uniform(opts.pulses)
  const uSpeed = uniform(opts.speed)
  const uPhase = uniform(opts.phase)
  const uBaseGlow = uniform(opts.baseGlow ?? 0.1)
  const uBroken = uniform(opts.broken ? 1 : 0)
  const uEmphasis = uniform(1)
  const uStyle = uniform(LANE_STYLE_INDEX[opts.style ?? 'pulse'])

  const t = uv().x
  // Repeating sawtooth marching toward t=1 (the destination node) — the
  // shared "clock" every style derives its motion from.
  const saw = t.mul(uPulses).sub(time.mul(uSpeed)).add(uPhase).fract()

  // 0 — comet light-waves
  const pulseI = saw.pow(6).mul(1.1)
  // 1 — laser beam: steady core + moving micro-shimmer + faint comet so the
  // flow direction stays readable
  const shimmer = t.mul(34).sub(time.mul(5)).add(uPhase.mul(40)).sin().mul(0.07)
  const beamI = float(0.55).add(shimmer).add(saw.pow(8).mul(0.4))
  // 2 — marching dashes, soft-edged, ~50% duty cycle
  const dashI = saw.sub(0.5).abs().smoothstep(0.18, 0.34).oneMinus().mul(0.85)
  // 3 — traveling sine ripple
  const waveT = saw.mul(Math.PI * 2)
  const waveI = waveT.sin().mul(0.5).add(0.5).pow(2).mul(1.05)
  // 4 — aurora: two slow offset bands layered into a soft flow
  const bandA = waveT.sin().mul(0.5).add(0.5)
  const bandB = t
    .mul(uPulses)
    .mul(0.5)
    .sub(time.mul(uSpeed).mul(0.35))
    .add(uPhase)
    .mul(Math.PI * 2)
    .sin()
    .mul(0.5)
    .add(0.5)
  const auroraI = bandA.mul(0.45).add(bandB.mul(0.35)).add(0.2)

  const styleI = select(
    uStyle.equal(4),
    auroraI,
    select(
      uStyle.equal(3),
      waveI,
      select(uStyle.equal(2), dashI, select(uStyle.equal(1), beamI, pulseI))
    )
  )

  // Broken lanes: hard stochastic flicker + a dead gap mid-lane (all styles)
  const blink = time.mul(7.3).add(uPhase.mul(17)).fract().smoothstep(0.42, 0.48)
  const flicker = mix(float(1), blink.mul(0.75).add(0.25), uBroken)
  const gap = mix(float(1), t.sub(0.5).abs().smoothstep(0.05, 0.17), uBroken)
  const intensity = styleI.add(uBaseGlow).mul(flicker).mul(gap).mul(uEmphasis)

  // Aurora drifts the hue toward the lighter tint along a slow second wave
  const hueWave = t
    .mul(3)
    .sub(time.mul(0.5))
    .add(uPhase)
    .sin()
    .mul(0.5)
    .add(0.5)
  const baseColor = mix(
    uColor,
    uColorB,
    select(uStyle.equal(4), hueWave, float(0))
  )

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })
  // Ripple waves physically swell the tube along its normals
  const swell = select(uStyle.equal(3), waveT.sin().mul(0.3).add(0.3), float(0))
  material.positionNode = positionLocal.add(normalLocal.mul(swell))
  material.colorNode = baseColor.mul(intensity)
  material.opacityNode = intensity.clamp(0, 1)
  material.mrtNode = mrt({ bloomIntensity: intensity.mul(0.45) })

  return {
    material,
    setColor: (hex) => {
      ;(uColor.value as Color).set(hex)
      ;(uColorB.value as Color).copy(auroraTint(hex))
    },
    setBroken: (broken) => {
      uBroken.value = broken ? 1 : 0
    },
    setEmphasis: (value) => {
      uEmphasis.value = value
    },
    setFlow: (pulses, speed) => {
      uPulses.value = pulses
      uSpeed.value = speed
    },
    setStyle: (style) => {
      uStyle.value = LANE_STYLE_INDEX[style]
    },
  }
}

/* ─────────────────────────── Node visuals ─────────────────────────── */

export interface NodeMaterialHandle {
  material: MeshBasicNodeMaterial
  setColor: (hex: string) => void
  setEmphasis: (value: number) => void
}

/** Vertical light pillar — height fades to nothing, gentle breathing. */
export function createBeamMaterial(
  colorHex: string,
  phase: number
): NodeMaterialHandle {
  const uColor = uniform(color(colorHex))
  const uEmphasis = uniform(1)
  // Beam geometry is a unit-height cylinder centered at y=0
  const h = positionLocal.y.add(0.5) // 0 bottom → 1 top
  const breath = time.mul(1.4).add(phase).sin().mul(0.12).add(0.88)
  const intensity = h.oneMinus().pow(2.2).mul(breath).mul(uEmphasis)

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  })
  material.colorNode = uColor.mul(intensity).mul(1.1)
  material.opacityNode = intensity.clamp(0, 1)
  material.mrtNode = mrt({ bloomIntensity: intensity.mul(0.4) })
  return {
    material,
    setColor: (hex) => (uColor.value as Color).set(hex),
    setEmphasis: (value) => {
      uEmphasis.value = value
    },
  }
}

/** Soft additive glow disc sitting on the surface under each marker. */
export function createGlowDiscMaterial(colorHex: string): NodeMaterialHandle {
  const uColor = uniform(color(colorHex))
  const uEmphasis = uniform(1)
  const d = uv().distance(vec2(0.5, 0.5)).mul(2)
  const falloff = d.oneMinus().clamp(0, 1).pow(2.4).mul(0.9).mul(uEmphasis)

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })
  material.colorNode = uColor.mul(falloff)
  material.opacityNode = falloff
  material.mrtNode = mrt({ bloomIntensity: falloff.mul(0.25) })
  return {
    material,
    setColor: (hex) => (uColor.value as Color).set(hex),
    setEmphasis: (value) => {
      uEmphasis.value = value
    },
  }
}

/**
 * Expanding radar ring — the whole animation lives in the shader
 * (positionNode scales, opacity decays), so one static mesh per node.
 */
export function createPulseRingMaterial(
  colorHex: string,
  phase: number,
  rate: number
): NodeMaterialHandle {
  const uColor = uniform(color(colorHex))
  const uEmphasis = uniform(1)
  const s = time.mul(rate).add(phase).fract()
  const fade = s.oneMinus().pow(2).mul(uEmphasis)

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  })
  // Ring geometry is built in its local XY plane → scale X/Y only
  const ringScale = s.mul(2.4).add(1)
  material.positionNode = positionLocal.mul(vec3(ringScale, ringScale, 1))
  material.colorNode = uColor.mul(fade)
  material.opacityNode = fade
  material.mrtNode = mrt({ bloomIntensity: fade.mul(0.6) })
  return {
    material,
    setColor: (hex) => (uColor.value as Color).set(hex),
    setEmphasis: (value) => {
      uEmphasis.value = value
    },
  }
}

/* ─────────────────────────── Globe + atmosphere ─────────────────────── */

/** Deep navy sphere with a fresnel rim so the limb catches light. */
export function createGlobeMaterial(baseHex: string, rimHex: string) {
  const viewDirection = positionWorld.sub(cameraPosition).normalize()
  const fresnel = viewDirection.dot(normalWorld).abs().oneMinus()
  const material = new MeshBasicNodeMaterial()
  material.colorNode = mix(
    uniform(color(baseHex)),
    uniform(color(rimHex)),
    fresnel.pow(3.5).mul(0.3)
  )
  return material
}

/**
 * Atmosphere halo: back-side shell ~8% larger than the globe, alpha from
 * an inverted fresnel band (the Bruno Simon / webgpu_tsl_earth recipe).
 */
export function createAtmosphereMaterial(colorHex: string) {
  const viewDirection = positionWorld.sub(cameraPosition).normalize()
  const fresnel = viewDirection.dot(normalWorld).abs().oneMinus()
  const alpha = fresnel.remap(0.78, 1, 1, 0).pow(3).mul(0.14)
  const material = new MeshBasicNodeMaterial({
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  material.colorNode = uniform(color(colorHex))
  material.opacityNode = alpha
  material.mrtNode = mrt({ bloomIntensity: alpha.mul(0.08) })
  return material
}
