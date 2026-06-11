// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Minimal ASCII DXF parser
// ---------------------------------------------------------------------------
// Supports the four entity types we care about for warehouse-map imports:
//   - LINE        (codes 10/20 → start, 11/21 → end, 8 → layer)
//   - CIRCLE      (codes 10/20 → center, 40 → radius, 8 → layer)
//   - LWPOLYLINE  (repeated 10/20 vertex pairs, 70 → flag bits, 8 → layer)
//   - POLYLINE    (header pairs followed by VERTEX sub-entities until SEQEND)
//
// DXF format primer:
//   ASCII DXF is an alternating list of (group-code, value) pairs, one per
//   line. Group code 0 always begins a new entity / section header. We split
//   into pairs, then walk them as a small state machine.
// ---------------------------------------------------------------------------

export type DxfEntity =
  | {
      type: 'LINE'
      layer: string
      x1: number
      y1: number
      x2: number
      y2: number
    }
  | {
      type: 'CIRCLE'
      layer: string
      cx: number
      cy: number
      r: number
    }
  | {
      type: 'LWPOLYLINE' | 'POLYLINE'
      layer: string
      closed: boolean
      points: { x: number; y: number }[]
    }

export interface DxfBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface DxfParseResult {
  entities: DxfEntity[]
  layers: string[]
  bounds: DxfBounds
}

interface Pair {
  code: number
  value: string
}

interface FieldBag {
  // Map of group-code → list of values (some codes such as 10/20 repeat for
  // LWPOLYLINE vertices, so we always store an array).
  [code: number]: string[]
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function parseDxf(text: string): DxfParseResult {
  const pairs = tokenizePairs(text)
  const entities: DxfEntity[] = []
  const layerSet = new Set<string>()

  let i = 0
  while (i < pairs.length) {
    const pair = pairs[i]
    if (pair.code !== 0) {
      i++
      continue
    }

    const kind = pair.value.toUpperCase()
    if (kind === 'EOF') break

    if (kind === 'LINE') {
      const { fields, next } = readFields(pairs, i + 1)
      const layer = pickStr(fields[8], '0')
      entities.push({
        type: 'LINE',
        layer,
        x1: pickNum(fields[10]),
        y1: pickNum(fields[20]),
        x2: pickNum(fields[11]),
        y2: pickNum(fields[21]),
      })
      layerSet.add(layer)
      i = next
    } else if (kind === 'CIRCLE') {
      const { fields, next } = readFields(pairs, i + 1)
      const layer = pickStr(fields[8], '0')
      entities.push({
        type: 'CIRCLE',
        layer,
        cx: pickNum(fields[10]),
        cy: pickNum(fields[20]),
        r: pickNum(fields[40]),
      })
      layerSet.add(layer)
      i = next
    } else if (kind === 'LWPOLYLINE') {
      const { fields, next } = readFields(pairs, i + 1)
      const layer = pickStr(fields[8], '0')
      const flags = parseInt(pickStr(fields[70], '0'), 10) || 0
      const closed = (flags & 1) === 1
      const xs = fields[10] ?? []
      const ys = fields[20] ?? []
      const points: { x: number; y: number }[] = []
      const n = Math.min(xs.length, ys.length)
      for (let k = 0; k < n; k++) {
        const x = parseFloat(xs[k])
        const y = parseFloat(ys[k])
        if (!Number.isNaN(x) && !Number.isNaN(y)) points.push({ x, y })
      }
      entities.push({ type: 'LWPOLYLINE', layer, closed, points })
      layerSet.add(layer)
      i = next
    } else if (kind === 'POLYLINE') {
      // POLYLINE has a header section, then a stream of VERTEX sub-entities,
      // terminated by SEQEND. Each VERTEX is itself an entity that starts
      // with code 0, so we step through entity-by-entity.
      const { fields: hdr, next: afterHeader } = readFields(pairs, i + 1)
      const layer = pickStr(hdr[8], '0')
      const flags = parseInt(pickStr(hdr[70], '0'), 10) || 0
      const closed = (flags & 1) === 1
      const points: { x: number; y: number }[] = []

      let j = afterHeader
      while (j < pairs.length && pairs[j].code === 0) {
        const sub = pairs[j].value.toUpperCase()
        if (sub === 'VERTEX') {
          const { fields: vtx, next: afterVtx } = readFields(pairs, j + 1)
          const vx = pickNum(vtx[10])
          const vy = pickNum(vtx[20])
          points.push({ x: vx, y: vy })
          j = afterVtx
        } else if (sub === 'SEQEND') {
          const { next: afterSeqEnd } = readFields(pairs, j + 1)
          j = afterSeqEnd
          break
        } else {
          // Unexpected entity in the middle of a POLYLINE — bail out and let
          // the outer loop pick it up.
          break
        }
      }

      entities.push({ type: 'POLYLINE', layer, closed, points })
      layerSet.add(layer)
      i = j
    } else {
      // Unsupported entity — skip its field block.
      const { next } = readFields(pairs, i + 1)
      i = next
    }
  }

  const bounds = computeBounds(entities)
  const layers = Array.from(layerSet).sort()
  return { entities, layers, bounds }
}

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

function tokenizePairs(text: string): Pair[] {
  // Robust against CRLF, trailing whitespace, leading BOM, and stray blank
  // lines between pairs.
  const stripped = text.replace(/^\uFEFF/, '')
  const lines = stripped.split(/\r?\n/)
  const pairs: Pair[] = []
  let i = 0
  while (i < lines.length - 1) {
    const codeLine = lines[i].trim()
    if (!codeLine) {
      i++
      continue
    }
    const code = parseInt(codeLine, 10)
    if (Number.isNaN(code)) {
      // Not a valid group-code line — skip and keep alignment by advancing
      // a single line rather than a pair.
      i++
      continue
    }
    const value = (lines[i + 1] ?? '').trim()
    pairs.push({ code, value })
    i += 2
  }
  return pairs
}

// ---------------------------------------------------------------------------
// Field-bag reader
// ---------------------------------------------------------------------------

function readFields(
  pairs: Pair[],
  start: number
): { fields: FieldBag; next: number } {
  const fields: FieldBag = {}
  let i = start
  while (i < pairs.length && pairs[i].code !== 0) {
    const c = pairs[i].code
    if (!fields[c]) fields[c] = []
    fields[c].push(pairs[i].value)
    i++
  }
  return { fields, next: i }
}

function pickStr(values: string[] | undefined, fallback: string): string {
  return values && values.length > 0 ? values[0] : fallback
}

function pickNum(values: string[] | undefined, idx = 0): number {
  if (!values || idx >= values.length) return 0
  const v = parseFloat(values[idx])
  return Number.isNaN(v) ? 0 : v
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

function computeBounds(entities: DxfEntity[]): DxfBounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const expand = (x: number, y: number) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }

  for (const e of entities) {
    switch (e.type) {
      case 'LINE':
        expand(e.x1, e.y1)
        expand(e.x2, e.y2)
        break
      case 'CIRCLE':
        expand(e.cx - e.r, e.cy - e.r)
        expand(e.cx + e.r, e.cy + e.r)
        break
      case 'LWPOLYLINE':
      case 'POLYLINE':
        for (const p of e.points) expand(p.x, p.y)
        break
    }
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }
  return { minX, minY, maxX, maxY }
}

// Created and developed by Jai Singh
