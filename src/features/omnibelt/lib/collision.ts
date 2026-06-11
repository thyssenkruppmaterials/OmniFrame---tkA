// Created and developed by Jai Singh
/**
 * OmniBelt — Collision avoidance math (pure, no React)
 *
 * Implements spec §8.4. The hook layer
 * (`useOmnibeltCollisionAvoidance`) reads competing chrome rects from
 * the DOM (NotificationsPanel bell, Sonner toaster) and feeds them
 * here; this module is responsible only for the geometry and is fully
 * unit-tested.
 *
 * Defaults:
 *   - overlap threshold = 4 px   (spec §8.4)
 *   - offset step       = 56 px  (spec §8.4)
 *
 * Output rect is always returned as a *new* object so callers can rely
 * on referential equality to detect "no change".
 */

export type Rect = { x: number; y: number; w: number; h: number }

const DEFAULT_OVERLAP_THRESHOLD_PX = 4
const DEFAULT_OFFSET_STEP_PX = 56
/** Hard cap on cascading offset attempts so a pathological chrome
 *  arrangement can't loop the algorithm forever. */
const MAX_PASSES = 8

// ---- Public API ------------------------------------------------------------

/** True if `a` and `b` overlap by *more than* `paddingPx` in both axes. */
export function rectsOverlap(a: Rect, b: Rect, paddingPx = 0): boolean {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return overlapX > paddingPx && overlapY > paddingPx
}

/**
 * Returns the area (px²) of overlap between `a` and `b`. 0 when the
 * rects are disjoint. Used to pick the *smallest* offset that resolves
 * a collision (rather than always jumping the full step).
 */
export function rectsOverlapAreaPx(a: Rect, b: Rect): number {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (overlapX <= 0 || overlapY <= 0) return 0
  return overlapX * overlapY
}

/**
 * Avoid every competing rect by offsetting in the closest free
 * direction (up / down / left / right by `offsetStepPx`). Cascading
 * overlaps (chrome A pushes us into chrome B) are resolved by repeating
 * the algorithm up to `MAX_PASSES` times.
 *
 * Returns `reason` for telemetry / debug: 'no_overlap' when no
 * adjustment was needed, otherwise a short string describing the path
 * taken (e.g. `'avoided:left'`, `'avoided:up,right'`).
 */
export function avoidCollisions(args: {
  widget: Rect
  competing: Rect[]
  overlapThresholdPx?: number
  offsetStepPx?: number
}): { adjustedRect: Rect; reason: string } {
  const {
    widget,
    competing,
    overlapThresholdPx = DEFAULT_OVERLAP_THRESHOLD_PX,
    offsetStepPx = DEFAULT_OFFSET_STEP_PX,
  } = args

  if (competing.length === 0) {
    return { adjustedRect: { ...widget }, reason: 'no_overlap' }
  }

  let current: Rect = { ...widget }
  const moves: string[] = []

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const hit = firstColliding(current, competing, overlapThresholdPx)
    if (!hit) break

    // Pick the offset direction with the smallest residual overlap.
    const candidates: Array<{ dir: string; rect: Rect }> = [
      { dir: 'up', rect: { ...current, y: current.y - offsetStepPx } },
      { dir: 'down', rect: { ...current, y: current.y + offsetStepPx } },
      { dir: 'left', rect: { ...current, x: current.x - offsetStepPx } },
      { dir: 'right', rect: { ...current, x: current.x + offsetStepPx } },
    ]
    let bestCandidate = candidates[0]
    let bestScore = sumOverlap(bestCandidate.rect, competing)
    for (let i = 1; i < candidates.length; i += 1) {
      const score = sumOverlap(candidates[i].rect, competing)
      if (score < bestScore) {
        bestScore = score
        bestCandidate = candidates[i]
      }
    }
    moves.push(bestCandidate.dir)
    current = bestCandidate.rect
    if (bestScore === 0) break
  }

  if (moves.length === 0) {
    return { adjustedRect: current, reason: 'no_overlap' }
  }
  return { adjustedRect: current, reason: `avoided:${moves.join(',')}` }
}

// ---- Internal helpers ------------------------------------------------------

function firstColliding(
  widget: Rect,
  competing: Rect[],
  threshold: number
): Rect | null {
  for (const r of competing) {
    if (rectsOverlap(widget, r, threshold)) return r
  }
  return null
}

function sumOverlap(widget: Rect, competing: Rect[]): number {
  let total = 0
  for (const r of competing) total += rectsOverlapAreaPx(widget, r)
  return total
}

// Created and developed by Jai Singh
