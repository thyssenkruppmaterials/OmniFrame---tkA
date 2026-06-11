// Created and developed by Jai Singh
/**
 * Pure layout helpers for the bento grid: auto-place posts without
 * persisted layouts, snap a (mouseX, mouseY) drag to grid cells,
 * detect collisions, normalize after a drop.
 *
 * Co-located with `<BentoGrid>` so the placement logic stays unit
 * testable (no React mounting needed) and the grid component stays
 * focused on the React side.
 */
import {
  VARIANT_DEFAULT_SIZE,
  clampSizeForVariant,
  type BoardCard,
  type CardVariant,
} from './card-variant'

interface PlacedRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Pack cards onto a `cols`-wide grid using a simple shelf algorithm.
 *
 * Cards with `isDefaultLayout = false` (have an explicit persisted
 * layout) are placed first at their stored coordinates; remaining
 * default-layout cards are auto-placed top-to-bottom, left-to-right
 * into the first slot that fits.
 *
 * The algorithm is intentionally deterministic so a render before
 * the persisted layout loads and a render after the layout loads
 * produce stable (non-jumpy) placements for the auto-placed tail.
 */
export function autoPlaceCards(
  cards: readonly BoardCard[],
  cols: number
): BoardCard[] {
  if (cards.length === 0) return []
  const placed: PlacedRect[] = []
  const result: BoardCard[] = []

  // Phase 1 — accept persisted positions verbatim (clamped to grid).
  // Defaults flow into phase 2 even if a "persisted" card collides
  // with another persisted one (curators can intentionally overlap
  // by editing in another tab; the renderer just stacks via z-index).
  const persisted = cards.filter((c) => !c.isDefaultLayout)
  for (const card of persisted) {
    const w = Math.min(card.gridW, cols)
    const h = Math.max(1, card.gridH)
    const x = Math.max(0, Math.min(card.gridX, cols - w))
    const y = Math.max(0, card.gridY)
    placed.push({ x, y, w, h })
    result.push({ ...card, gridX: x, gridY: y, gridW: w, gridH: h })
  }

  // Phase 2 — auto-place defaults into the first free slot.
  for (const card of cards) {
    if (!card.isDefaultLayout) continue
    const desired = clampSizeForVariant(
      card.cardVariant,
      card.gridW || VARIANT_DEFAULT_SIZE[card.cardVariant].w,
      card.gridH || VARIANT_DEFAULT_SIZE[card.cardVariant].h,
      cols
    )
    const slot = findFreeSlot(placed, cols, desired.w, desired.h)
    placed.push({ x: slot.x, y: slot.y, w: desired.w, h: desired.h })
    result.push({
      ...card,
      gridX: slot.x,
      gridY: slot.y,
      gridW: desired.w,
      gridH: desired.h,
    })
  }

  return result
}

function rectsOverlap(a: PlacedRect, b: PlacedRect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  )
}

export function findFreeSlot(
  placed: readonly PlacedRect[],
  cols: number,
  w: number,
  h: number
): { x: number; y: number } {
  const cappedW = Math.max(1, Math.min(w, cols))
  // Walk rows top-to-bottom, columns left-to-right. Stops at the
  // first cell that fits `w x h` without overlapping any placed rect.
  // Worst case O(rows * cols * placed.length) which is fine for the
  // < 100 cards a board could realistically host.
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x + cappedW <= cols; x++) {
      const candidate: PlacedRect = { x, y, w: cappedW, h }
      if (!placed.some((p) => rectsOverlap(p, candidate))) {
        return { x, y }
      }
    }
  }
  return { x: 0, y: 200 }
}

/**
 * Default placement for a card with no persisted layout row.
 *
 * Position fields are placeholders — `autoPlaceCards` overrides them
 * during render. Variant + size come from `VARIANT_DEFAULT_SIZE`.
 */
export function defaultLayoutForVariant(variant: CardVariant): {
  gridX: number
  gridY: number
  gridW: number
  gridH: number
} {
  const { w, h } = VARIANT_DEFAULT_SIZE[variant]
  return { gridX: 0, gridY: 0, gridW: w, gridH: h }
}

/**
 * Used by drag-to-move + drag-to-resize. Given a (px, py) in cell
 * coordinates (already divided by cellW / cellH on the consumer
 * side), clamp to the grid + per-variant min/max.
 */
export function clampDragTo(
  variant: CardVariant,
  px: number,
  py: number,
  w: number,
  h: number,
  cols: number
): { x: number; y: number } {
  const { w: cw } = clampSizeForVariant(variant, w, h, cols)
  const x = Math.max(0, Math.min(Math.round(px), cols - cw))
  const y = Math.max(0, Math.round(py))
  return { x, y }
}

// Created and developed by Jai Singh
