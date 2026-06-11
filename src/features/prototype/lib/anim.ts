// Created and developed by Jai Singh
/**
 * Small animation toolkit shared across the XR prototype scenes.
 *
 * Popmotion-style easing primitives plus a `lerp` helper. Every scene drives
 * off a single `time` (seconds) playhead owned by the top-level Stage so
 * motion stays framerate-independent and scrubbable.
 */

export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v))

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const Easing = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeOutBack: (t: number) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
  },
  easeInCubicAlias: (t: number) => t * t * t,
}

export type EaseFn = (t: number) => number

/** animate({ from, to, start, end, ease })(t) — single-segment tween in seconds. */
export function animate({
  from = 0,
  to = 1,
  start = 0,
  end = 1,
  ease = Easing.easeInOutCubic,
}: {
  from?: number
  to?: number
  start?: number
  end?: number
  ease?: EaseFn
}) {
  return (t: number) => {
    if (t <= start) return from
    if (t >= end) return to
    const local = (t - start) / (end - start)
    return from + (to - from) * ease(local)
  }
}

/** interpolate([inputKeyframes], [outputValues], ease?)(t) — piecewise tween. */
export function interpolate(
  input: number[],
  output: number[],
  ease: EaseFn | EaseFn[] = Easing.linear
) {
  return (t: number) => {
    if (t <= input[0]) return output[0]
    if (t >= input[input.length - 1]) return output[output.length - 1]
    for (let i = 0; i < input.length - 1; i++) {
      if (t >= input[i] && t <= input[i + 1]) {
        const span = input[i + 1] - input[i]
        const local = span === 0 ? 0 : (t - input[i]) / span
        const easeFn = Array.isArray(ease) ? (ease[i] ?? Easing.linear) : ease
        const eased = easeFn(local)
        return output[i] + (output[i + 1] - output[i]) * eased
      }
    }
    return output[output.length - 1]
  }
}

/** Format seconds as `m:ss.cc` for the playback bar. */
export function fmtTime(total: number) {
  const t = Math.max(0, total)
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  const cs = Math.floor((t * 100) % 100)
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

// Created and developed by Jai Singh
