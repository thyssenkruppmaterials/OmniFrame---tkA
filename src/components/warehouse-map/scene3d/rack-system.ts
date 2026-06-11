// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// rack-system — pure generator for full racking systems.
// ---------------------------------------------------------------------------
// Turns a RackSystemConfig into persisted-model rack rows: parallel rack RUNS
// (one warehouse_racks row per run, `columns` = bays, `rows` = levels)
// separated by working aisles, optionally paired back-to-back with a flue gap
// (the classic pallet-racking layout). Everything is in PERSISTED WORLD UNITS
// (~cm) and matches the corner-origin + center-rotation convention of
// warehouse_racks, so the output can be inserted directly.
import type { RackType } from '../types'

export interface RackSystemConfig {
  rack_type: RackType
  /** Vertical levels per run (persisted as rack.rows). */
  levels: number
  /** Bays per run. rack.columns = bays × palletsPerBay (pallet positions). */
  bays: number
  /** Pallet positions per bay (1–3) — uprights align to bay boundaries. */
  palletsPerBay: number
  /** Width of one bay along the run (world units). */
  bayWidth: number
  /** Rack depth (world units; persisted as rack.height). */
  rackDepth: number
  /** Number of rack runs. */
  runs: number
  /** Pair consecutive runs back-to-back with a flue gap between them. */
  backToBack: boolean
  /** Gap inside a back-to-back pair (world units). */
  flueGap: number
  /** Working aisle width between runs / pairs (world units). */
  aisleWidth: number
  /** Run label prefix; runs are lettered A, B, C… after it. */
  labelPrefix: string
}

/** One generated rack row, ready for warehouse_racks insertion. */
export interface GeneratedRack {
  label: string
  aisle: string
  rack_type: RackType
  position_x: number
  position_y: number
  rotation: number
  width: number
  height: number
  rows: number
  columns: number
  /** Carries appearance.palletsPerBay so the renderer bay-aligns uprights. */
  metadata: Record<string, unknown>
}

/** Sanitised pallets-per-bay (1–3). */
export function palletsPerBayOf(cfg: RackSystemConfig): number {
  const v = Math.round(cfg.palletsPerBay || 1)
  return Math.min(Math.max(v, 1), 3)
}

/** A,B,…,Z,AA,AB,… */
export function runLetter(index: number): string {
  let s = ''
  let i = index
  do {
    s = String.fromCharCode(65 + (i % 26)) + s
    i = Math.floor(i / 26) - 1
  } while (i >= 0)
  return s
}

/** Per-run Y offset (top edge) within the unrotated system, world units. */
function runOffsetY(cfg: RackSystemConfig, run: number): number {
  if (!cfg.backToBack) return run * (cfg.rackDepth + cfg.aisleWidth)
  const pair = Math.floor(run / 2)
  const inPair = run % 2
  return (
    pair * (2 * cfg.rackDepth + cfg.flueGap + cfg.aisleWidth) +
    inPair * (cfg.rackDepth + cfg.flueGap)
  )
}

/** Unrotated overall footprint of the system (world units). */
export function systemFootprint(cfg: RackSystemConfig): {
  width: number
  depth: number
} {
  const width = cfg.bays * cfg.bayWidth
  const depth = cfg.runs > 0 ? runOffsetY(cfg, cfg.runs - 1) + cfg.rackDepth : 0
  return { width, depth }
}

/**
 * Generate the rack rows for a system whose footprint CENTER lands at
 * (centerX, centerY), rotated by rotationDeg (same clockwise-degrees
 * convention as racks). Each run rotates about its own center (that is how
 * the renderer applies rack.rotation), so run centers are rotated around the
 * system center and converted back to corner origins.
 */
export function generateRackSystem(
  cfg: RackSystemConfig,
  centerX: number,
  centerY: number,
  rotationDeg = 0
): GeneratedRack[] {
  const { depth } = systemFootprint(cfg)
  const runWidth = cfg.bays * cfg.bayWidth
  // Rotate by -deg in standard math axes == clockwise `deg` in plan view
  // (matches rotationToY = -deg).
  const rad = (-rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const racks: GeneratedRack[] = []
  for (let run = 0; run < cfg.runs; run++) {
    // Run center relative to the system center, unrotated.
    const relX = 0 // runs span the full width, centered
    const relY = runOffsetY(cfg, run) + cfg.rackDepth / 2 - depth / 2
    // Rotate around the system center.
    const cx = centerX + relX * cos - relY * sin
    const cy = centerY + relX * sin + relY * cos
    const letter = runLetter(run)
    const ppb = palletsPerBayOf(cfg)
    racks.push({
      label: `${cfg.labelPrefix}${letter}`,
      aisle: letter,
      rack_type: cfg.rack_type,
      position_x: cx - runWidth / 2,
      position_y: cy - cfg.rackDepth / 2,
      rotation: rotationDeg,
      width: runWidth,
      height: cfg.rackDepth,
      rows: cfg.levels,
      columns: cfg.bays * ppb,
      metadata: { appearance: { palletsPerBay: ppb } },
    })
  }
  return racks
}

// ---- Presets -----------------------------------------------------------------

export const RACK_SYSTEM_DEFAULTS: RackSystemConfig = {
  rack_type: 'pallet',
  levels: 4,
  bays: 8,
  palletsPerBay: 2, // standard 2-pallet bay → columns = bays × 2 positions
  bayWidth: 280, // 2.8 m — standard 2-pallet bay
  rackDepth: 110, // 1.1 m
  runs: 6,
  backToBack: true,
  flueGap: 30, // 0.3 m
  aisleWidth: 320, // 3.2 m — reach-truck aisle
  labelPrefix: '',
}

/** Quick-place presets: a single run, armed straight from the library. */
export const RACK_RUN_PRESETS: {
  key: string
  label: string
  description: string
  config: RackSystemConfig
}[] = [
  {
    key: 'pallet-run',
    label: 'Pallet Run',
    description: 'Single pallet-rack run — 8 bays × 4 levels',
    config: { ...RACK_SYSTEM_DEFAULTS, runs: 1, backToBack: false },
  },
  {
    key: 'shelving-run',
    label: 'Shelving Run',
    description: 'Single shelving run — 6 bays × 5 levels',
    config: {
      ...RACK_SYSTEM_DEFAULTS,
      rack_type: 'shelving',
      levels: 5,
      bays: 6,
      palletsPerBay: 1,
      bayWidth: 120,
      rackDepth: 60,
      runs: 1,
      backToBack: false,
    },
  },
]

// Created and developed by Jai Singh
