// Created and developed by Jai Singh
/**
 * Per-(task_type, version) payload schemas + migrators (Phase 3.6).
 *
 * Lightweight runtime validators (no zod dep added in this scaffold;
 * validators are pure functions that throw on shape mismatch). The contract:
 *
 *   - Bumping `payload_version` REQUIRES adding both a schema and a
 *     `PAYLOAD_MIGRATIONS` entry in this file. CI lint can enforce this once
 *     the script under `scripts/validate-check-matrix.mjs` ships.
 *   - `payload_version=0` is reserved for "raw legacy projection from
 *     `rr_cyclecount_data`" so backfilled rows can be re-validated.
 */
import type { WorkTypeId } from './work-task-types'

export type PayloadValidator = (payload: unknown) => void

export type PayloadMigrator = (payload: unknown) => unknown

interface SchemaEntry {
  schemas: Record<number, PayloadValidator>
  migrators: Record<number, PayloadMigrator> // key = fromVersion, migrates to fromVersion+1
}

function requireObject(p: unknown): asserts p is Record<string, unknown> {
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    throw new Error('payload must be an object')
  }
}
function requireNumber(o: Record<string, unknown>, key: string) {
  const v = o[key]
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new Error(`payload.${key} must be a number`)
  }
}
function requireString(o: Record<string, unknown>, key: string) {
  const v = o[key]
  if (typeof v !== 'string') {
    throw new Error(`payload.${key} must be a string`)
  }
}

const SCHEMAS: Record<WorkTypeId, SchemaEntry> = {
  cycle_count: {
    schemas: {
      0: () => {
        /* legacy projection — accept anything */
      },
      1: (p) => {
        requireObject(p)
        requireNumber(p, 'system_quantity')
        requireString(p, 'count_type')
      },
    },
    migrators: {
      0: (p) => p, // 0 → 1: the projection trigger already emits a v1-shaped payload
    },
  },
  zone_audit: {
    schemas: {
      1: (p) => {
        requireObject(p)
        requireString(p, 'zone_id')
        requireNumber(p, 'expected_count')
      },
    },
    migrators: {},
  },
  pick: {
    schemas: {
      1: (p) => {
        requireObject(p)
        requireNumber(p, 'pick_qty')
        requireString(p, 'destination_location')
        requireString(p, 'transfer_order')
        requireString(p, 'movement_type')
      },
    },
    migrators: {},
  },
  putaway: {
    schemas: { 1: (p) => requireObject(p) },
    migrators: {},
  },
  replenish: {
    schemas: { 1: (p) => requireObject(p) },
    migrators: {},
  },
  kit_pick: {
    schemas: { 1: (p) => requireObject(p) },
    migrators: {},
  },
}

export function validatePayload(
  taskType: WorkTypeId,
  version: number,
  payload: unknown
): void {
  const entry = SCHEMAS[taskType]
  if (!entry) throw new Error(`unknown task_type: ${taskType}`)
  const schema = entry.schemas[version]
  if (!schema) {
    throw new Error(`no schema registered for ${taskType} v${version}`)
  }
  schema(payload)
}

export function migratePayload(
  taskType: WorkTypeId,
  fromVersion: number,
  toVersion: number,
  payload: unknown
): unknown {
  if (fromVersion === toVersion) return payload
  if (toVersion < fromVersion) {
    throw new Error(
      `downward payload migration not supported (${fromVersion} -> ${toVersion})`
    )
  }
  const entry = SCHEMAS[taskType]
  if (!entry) throw new Error(`unknown task_type: ${taskType}`)
  let cur = payload
  for (let v = fromVersion; v < toVersion; v++) {
    const m = entry.migrators[v]
    if (!m)
      throw new Error(`no payload migrator for ${taskType} v${v} → v${v + 1}`)
    cur = m(cur)
  }
  validatePayload(taskType, toVersion, cur)
  return cur
}

export function latestPayloadVersion(taskType: WorkTypeId): number {
  const entry = SCHEMAS[taskType]
  if (!entry) throw new Error(`unknown task_type: ${taskType}`)
  return Math.max(...Object.keys(entry.schemas).map(Number))
}

// Created and developed by Jai Singh
