// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Rack appearance — per-rack visual configuration.
// ---------------------------------------------------------------------------
// Racks were the one scene element with hard-coded materials and a fixed
// 0.5 m level height. Appearance now persists in `warehouse_racks.metadata`
// (existing JSONB — no migration), read with palette defaults so legacy racks
// render exactly as before. Total rack height = rows × level height + base.
import type { WarehouseRack } from '../types'
import { PALETTE, RACK_BASE_HEIGHT, SHELF_SPACING } from './scene-config'

/** Classic pallet-racking beam orange (the previous hard-coded value). */
export const BEAM_ORANGE = '#e8762d'

export const LEVEL_HEIGHT_MIN = 0.2
export const LEVEL_HEIGHT_MAX = 4

export interface RackAppearance {
  /** Upright frame / post colour. */
  postColor: string
  /** Shelf deck colour. */
  shelfColor: string
  /** Load beam colour. */
  beamColor: string
  /** Default vertical distance between levels, meters. */
  levelHeightM: number
  /**
   * Per-level height overrides, meters, BOTTOM level first. Warehouses mix
   * tall ground/case-pick levels with tighter upper levels — each entry
   * overrides levelHeightM for that level; missing/short arrays fall back.
   * null = uniform.
   */
  levelHeights: number[] | null
  /**
   * Pallet positions per bay (1–3). Aligns the upright frames to bay
   * boundaries (an upright every N cells). null = legacy ~2.9 m spacing.
   */
  palletsPerBay: number | null
  /** Render front/back load beams (defaults true only for pallet racks). */
  showBeams: boolean
}

export function defaultRackAppearance(
  rackType: WarehouseRack['rack_type']
): RackAppearance {
  return {
    postColor: PALETTE.rackPost,
    shelfColor: PALETTE.rackShelf,
    beamColor: BEAM_ORANGE,
    levelHeightM: SHELF_SPACING,
    levelHeights: null,
    palletsPerBay: null,
    showBeams: rackType === 'pallet',
  }
}

const clampLevelH = (v: number) =>
  Math.min(Math.max(v, LEVEL_HEIGHT_MIN), LEVEL_HEIGHT_MAX)

const isHex = (v: unknown): v is string =>
  typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v)

/**
 * Read the appearance out of a rack's metadata (`metadata.appearance`),
 * falling back to the rack-type defaults field by field — a partial override
 * never loses the rest of the look.
 */
export function readRackAppearance(rack: {
  rack_type: WarehouseRack['rack_type']
  metadata: Record<string, unknown> | null
}): RackAppearance {
  const def = defaultRackAppearance(rack.rack_type)
  const raw = rack.metadata?.appearance as
    | Partial<RackAppearance>
    | null
    | undefined
  if (!raw || typeof raw !== 'object') return def
  const levelH = Number(raw.levelHeightM)
  const rawLevels = Array.isArray(raw.levelHeights)
    ? raw.levelHeights.slice(0, 24).map(Number)
    : null
  const levelHeights =
    rawLevels &&
    rawLevels.length > 0 &&
    rawLevels.every((v) => Number.isFinite(v))
      ? rawLevels.map(clampLevelH)
      : null
  const ppb = Number(raw.palletsPerBay)
  return {
    postColor: isHex(raw.postColor) ? raw.postColor : def.postColor,
    shelfColor: isHex(raw.shelfColor) ? raw.shelfColor : def.shelfColor,
    beamColor: isHex(raw.beamColor) ? raw.beamColor : def.beamColor,
    levelHeightM:
      Number.isFinite(levelH) &&
      levelH >= LEVEL_HEIGHT_MIN &&
      levelH <= LEVEL_HEIGHT_MAX
        ? levelH
        : def.levelHeightM,
    levelHeights,
    palletsPerBay:
      Number.isInteger(ppb) && ppb >= 1 && ppb <= 3 ? ppb : def.palletsPerBay,
    showBeams:
      typeof raw.showBeams === 'boolean' ? raw.showBeams : def.showBeams,
  }
}

/** Effective height of one level, meters. */
export function levelHeightAt(app: RackAppearance, level: number): number {
  const v = app.levelHeights?.[level]
  return v !== undefined && Number.isFinite(v)
    ? clampLevelH(v)
    : app.levelHeightM
}

/**
 * Vertical layout of a rack: deck Y for every level boundary (0..rows, the
 * base deck first), the per-level heights, and the total build height —
 * all in meters. Replaces the old uniform `rows × SHELF_SPACING + base`.
 */
export function levelOffsets(
  app: RackAppearance,
  rows: number
): { deckY: number[]; heights: number[]; total: number } {
  const n = Math.max(1, rows)
  const heights = Array.from({ length: n }, (_, i) => levelHeightAt(app, i))
  const deckY: number[] = [RACK_BASE_HEIGHT]
  for (let i = 0; i < n; i++) deckY.push(deckY[i] + heights[i])
  return { deckY, heights, total: deckY[n] }
}

/**
 * Merge an appearance patch into a rack's metadata, dropping values that
 * match the defaults so untouched racks keep an empty metadata object.
 */
export function mergeRackAppearance(
  rack: {
    rack_type: WarehouseRack['rack_type']
    metadata: Record<string, unknown> | null
  },
  patch: Partial<RackAppearance>
): Record<string, unknown> {
  const def = defaultRackAppearance(rack.rack_type)
  const next = { ...readRackAppearance(rack), ...patch }
  const appearance: Partial<RackAppearance> = {}
  if (next.postColor !== def.postColor) appearance.postColor = next.postColor
  if (next.shelfColor !== def.shelfColor)
    appearance.shelfColor = next.shelfColor
  if (next.beamColor !== def.beamColor) appearance.beamColor = next.beamColor
  if (next.levelHeightM !== def.levelHeightM)
    appearance.levelHeightM = next.levelHeightM
  if (next.levelHeights && next.levelHeights.length > 0)
    appearance.levelHeights = next.levelHeights.map(clampLevelH)
  if (next.palletsPerBay !== null) appearance.palletsPerBay = next.palletsPerBay
  if (next.showBeams !== def.showBeams) appearance.showBeams = next.showBeams
  const metadata = { ...(rack.metadata ?? {}) }
  if (Object.keys(appearance).length > 0) metadata.appearance = appearance
  else delete metadata.appearance
  return metadata
}

// Created and developed by Jai Singh
