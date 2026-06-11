// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Object style — per-object material design (finish + glow).
// ---------------------------------------------------------------------------
// Every placed scene object already takes a colour override; this adds the
// rest of the design dial: a material FINISH preset (matte plastic through
// mirror chrome) and an emissive GLOW (neon accent — reads great at night /
// in dark scenes). Persisted in `warehouse_scene_objects.metadata.style`
// (existing JSONB — no migration). Applied by SceneObject via a material
// traversal so all ~45 parametric recipes get it without per-recipe surgery.

export type ObjectFinish =
  | 'standard'
  | 'matte'
  | 'brushed'
  | 'chrome'
  | 'glossy'

export const FINISH_LABELS: Record<ObjectFinish, string> = {
  standard: 'Standard',
  matte: 'Matte',
  brushed: 'Brushed metal',
  chrome: 'Chrome',
  glossy: 'Glossy',
}

/** Absolute roughness/metalness targets per finish ('standard' = recipe values). */
export const FINISH_PRESETS: Record<
  Exclude<ObjectFinish, 'standard'>,
  { roughness: number; metalness: number }
> = {
  matte: { roughness: 0.95, metalness: 0.0 },
  brushed: { roughness: 0.45, metalness: 0.65 },
  chrome: { roughness: 0.12, metalness: 0.95 },
  glossy: { roughness: 0.18, metalness: 0.05 },
}

export interface ObjectStyle {
  finish: ObjectFinish
  /** Emissive neon glow in the object's colour. */
  glow: boolean
}

export const DEFAULT_OBJECT_STYLE: ObjectStyle = {
  finish: 'standard',
  glow: false,
}

const FINISHES: ObjectFinish[] = [
  'standard',
  'matte',
  'brushed',
  'chrome',
  'glossy',
]

/** Read `metadata.style`, tolerating absent/legacy/malformed values. */
export function readObjectStyle(
  metadata: Record<string, unknown> | null | undefined
): ObjectStyle {
  const raw = metadata?.style as Partial<ObjectStyle> | null | undefined
  if (!raw || typeof raw !== 'object') return DEFAULT_OBJECT_STYLE
  return {
    finish: FINISHES.includes(raw.finish as ObjectFinish)
      ? (raw.finish as ObjectFinish)
      : 'standard',
    glow: raw.glow === true,
  }
}

/**
 * Merge a style patch into an object's metadata, dropping the style key
 * entirely when everything is back at defaults.
 */
export function mergeObjectStyle(
  metadata: Record<string, unknown> | null | undefined,
  patch: Partial<ObjectStyle>
): Record<string, unknown> {
  const next = { ...readObjectStyle(metadata), ...patch }
  const out = { ...(metadata ?? {}) }
  if (next.finish !== 'standard' || next.glow) out.style = next
  else delete out.style
  return out
}

// Created and developed by Jai Singh
