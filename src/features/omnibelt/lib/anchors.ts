// Created and developed by Jai Singh
/**
 * OmniBelt — Anchor math (pure, no React)
 *
 * Implements spec §8 (Position & Anchor System):
 *   - 12 user-selectable anchors  (4 corners + 4 edge midpoints + 4 edge nubs)
 *   - 2 modes                     (FREE drop anywhere, PINNED drag-locked)
 *
 * The store (P1) already names the discriminator `AnchorName`; we keep
 * that convention and surface the same type from this module so callers
 * can import directly from `lib/anchors` (the right home for the math)
 * without pulling the Zustand store in.
 *
 * All math is intentionally side-effect-free so tests can exercise every
 * branch without faking a viewport. The hook layer
 * (`useOmnibeltPosition`) wires it into ResizeObserver + framer-motion.
 *
 * Coordinate convention: returned `{ x, y }` is the top-left corner of
 * the widget rect in viewport-space pixels (`position: fixed`).
 */

// ---- Types -----------------------------------------------------------------

export type AnchorName =
  | 'TL'
  | 'TC'
  | 'TR'
  | 'ML'
  | 'MR'
  | 'BL'
  | 'BC'
  | 'BR'
  | 'FREE'
  | 'PINNED'
  | 'NUB_L'
  | 'NUB_R'
  | 'NUB_T'
  | 'NUB_B'

/**
 * Backwards-compatible alias retained for parity with the task brief
 * (which calls this type `AnchorPosition`). Internally we prefer
 * `AnchorName` so the wider `{ anchor, offset }` shape in the store
 * doesn't collide with the discriminator.
 */
export type AnchorPosition = AnchorName

export type Offset = { x: number; y: number }

export type ResolvedPosition = {
  anchor: AnchorName
  offset: Offset
  /** Resolved top-left of the widget rect in viewport coordinates. */
  x: number
  y: number
}

/** All 12 anchors + FREE + PINNED. Order matches spec §8.1. */
export const ANCHOR_POSITIONS: readonly AnchorName[] = [
  'TL',
  'TC',
  'TR',
  'ML',
  'MR',
  'BL',
  'BC',
  'BR',
  'FREE',
  'PINNED',
  'NUB_L',
  'NUB_R',
  'NUB_T',
  'NUB_B',
] as const

/** The 8 user-facing corner / edge anchors (no nubs, no modes). */
export const USER_CORNER_ANCHORS: readonly AnchorName[] = [
  'TL',
  'TC',
  'TR',
  'ML',
  'MR',
  'BL',
  'BC',
  'BR',
] as const

/** The 4 nubs (auto-hide endpoints flush against a viewport edge). */
export const NUB_ANCHORS: readonly AnchorName[] = [
  'NUB_L',
  'NUB_R',
  'NUB_T',
  'NUB_B',
] as const

/** Snap deadzone (spec §8.2). Drop beyond this distance → FREE. */
export const SNAP_DEADZONE_PX = 32

/** Outer gutter from the viewport edge for non-nub anchors. */
export const VIEWPORT_GUTTER_PX = 24

// ---- Internal helpers ------------------------------------------------------

type ViewportSize = { viewportW: number; viewportH: number }
type WidgetSize = { widgetW: number; widgetH: number }

function topLeftFor(
  anchor: AnchorName,
  size: ViewportSize & WidgetSize
): { x: number; y: number } {
  const { viewportW, viewportH, widgetW, widgetH } = size
  const g = VIEWPORT_GUTTER_PX
  const cx = (viewportW - widgetW) / 2
  const cy = (viewportH - widgetH) / 2
  switch (anchor) {
    case 'TL':
      return { x: g, y: g }
    case 'TC':
      return { x: cx, y: g }
    case 'TR':
      return { x: viewportW - widgetW - g, y: g }
    case 'ML':
      return { x: g, y: cy }
    case 'MR':
      return { x: viewportW - widgetW - g, y: cy }
    case 'BL':
      return { x: g, y: viewportH - widgetH - g }
    case 'BC':
      return { x: cx, y: viewportH - widgetH - g }
    case 'BR':
      return { x: viewportW - widgetW - g, y: viewportH - widgetH - g }
    case 'NUB_L':
      return { x: 0, y: cy }
    case 'NUB_R':
      return { x: viewportW - widgetW, y: cy }
    case 'NUB_T':
      return { x: cx, y: 0 }
    case 'NUB_B':
      return { x: cx, y: viewportH - widgetH }
    // FREE + PINNED have no canonical top-left — caller passes offset.
    case 'FREE':
    case 'PINNED':
      return { x: g, y: g }
  }
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return Math.sqrt(dx * dx + dy * dy)
}

// ---- Public API ------------------------------------------------------------

/**
 * Resolve an anchor + offset to absolute viewport coordinates.
 *
 *   - For named anchors (TL..NUB_B): start from the canonical top-left
 *     for that anchor + apply `offset` (used by collision-avoidance to
 *     nudge ±56 px out of the way without losing the anchor).
 *   - For `FREE`: `offset` *is* the position; ignore the anchor's
 *     canonical top-left.
 *   - For `PINNED`: same as FREE — the locked (x, y) is stored on the
 *     offset; the anchor token only signals "drag is disabled" to the
 *     hook layer.
 *
 * Output is clamped to the viewport in a final pass so the widget never
 * overflows on resize.
 */
export function resolveAnchorPosition(args: {
  anchor: AnchorName
  offset: Offset
  viewportW: number
  viewportH: number
  widgetW: number
  widgetH: number
}): { x: number; y: number } {
  const { anchor, offset, viewportW, viewportH, widgetW, widgetH } = args
  let x: number
  let y: number
  if (anchor === 'FREE' || anchor === 'PINNED') {
    x = offset.x
    y = offset.y
  } else {
    const base = topLeftFor(anchor, {
      viewportW,
      viewportH,
      widgetW,
      widgetH,
    })
    x = base.x + offset.x
    y = base.y + offset.y
  }
  return clampToViewport({ x, y, widgetW, widgetH, viewportW, viewportH })
}

/**
 * Given a drop point (widget top-left) + viewport/widget dimensions,
 * return the closest anchor within `SNAP_DEADZONE_PX`, or `FREE` if no
 * anchor is close enough. Output `x`, `y` is the resolved top-left
 * (anchor → canonical top-left; FREE → drop point clamped to viewport).
 */
export function snapToNearestAnchor(args: {
  dropX: number
  dropY: number
  viewportW: number
  viewportH: number
  widgetW: number
  widgetH: number
  /** Override the default deadzone (defaults to `SNAP_DEADZONE_PX`). */
  deadzonePx?: number
}): ResolvedPosition {
  const {
    dropX,
    dropY,
    viewportW,
    viewportH,
    widgetW,
    widgetH,
    deadzonePx = SNAP_DEADZONE_PX,
  } = args

  let bestAnchor: AnchorName | null = null
  let bestDist = Infinity

  // Consider all 12 named anchors (8 user + 4 nubs); FREE/PINNED are
  // never the *result* of a snap, only of an explicit user action.
  for (const a of [...USER_CORNER_ANCHORS, ...NUB_ANCHORS]) {
    const tl = topLeftFor(a, { viewportW, viewportH, widgetW, widgetH })
    const d = dist(dropX, dropY, tl.x, tl.y)
    if (d < bestDist) {
      bestDist = d
      bestAnchor = a
    }
  }

  if (bestAnchor && bestDist <= deadzonePx) {
    const tl = topLeftFor(bestAnchor, {
      viewportW,
      viewportH,
      widgetW,
      widgetH,
    })
    const clamped = clampToViewport({
      x: tl.x,
      y: tl.y,
      widgetW,
      widgetH,
      viewportW,
      viewportH,
    })
    return {
      anchor: bestAnchor,
      offset: { x: 0, y: 0 },
      x: clamped.x,
      y: clamped.y,
    }
  }

  // Far from every anchor → free-float at the clamped drop point.
  const clamped = clampToViewport({
    x: dropX,
    y: dropY,
    widgetW,
    widgetH,
    viewportW,
    viewportH,
  })
  return {
    anchor: 'FREE',
    offset: { x: clamped.x, y: clamped.y },
    x: clamped.x,
    y: clamped.y,
  }
}

/**
 * Zone-bucketing convenience used by tests, keyboard shortcuts, and the
 * right-click "Move to corner" menu — converts a (x, y) viewport point
 * into the closest of the 8 user anchors (no nubs, no modes).
 *
 * We use distance-to-anchor-center rather than a rigid 3×3 grid so the
 * result is consistent with `snapToNearestAnchor` (which also uses
 * Euclidean distance).
 */
export function pickAnchorByZone(
  x: number,
  y: number,
  viewportW: number,
  viewportH: number,
  widgetW = 0,
  widgetH = 0
): AnchorName {
  let bestAnchor: AnchorName = 'BR'
  let bestDist = Infinity
  for (const a of USER_CORNER_ANCHORS) {
    const tl = topLeftFor(a, {
      viewportW,
      viewportH,
      widgetW,
      widgetH,
    })
    const d = dist(x, y, tl.x, tl.y)
    if (d < bestDist) {
      bestDist = d
      bestAnchor = a
    }
  }
  return bestAnchor
}

/**
 * Clamp the widget rect's top-left so the widget stays fully inside the
 * viewport. Called once per `resolveAnchorPosition` and once per
 * `snapToNearestAnchor` result so a resize can never push the widget
 * off-screen.
 */
export function clampToViewport(args: {
  x: number
  y: number
  widgetW: number
  widgetH: number
  viewportW: number
  viewportH: number
}): { x: number; y: number } {
  const { x, y, widgetW, widgetH, viewportW, viewportH } = args
  const maxX = Math.max(0, viewportW - widgetW)
  const maxY = Math.max(0, viewportH - widgetH)
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  }
}

// Created and developed by Jai Singh
