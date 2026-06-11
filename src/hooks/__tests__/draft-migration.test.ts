// Created and developed by Jai Singh
/**
 * Phase 13.4 — Scoped draft key + legacy migration.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Install a minimal in-memory localStorage shim BEFORE the runtime module
// loads (the runtime transitively imports supabase, whose auth-js client
// tries to read the session at import time and explodes if storage is busted).
const _store = new Map<string, string>()
const storageStub: Storage = {
  get length() {
    return _store.size
  },
  clear: () => _store.clear(),
  getItem: (k) => _store.get(k) ?? null,
  setItem: (k, v) => {
    _store.set(k, String(v))
  },
  removeItem: (k) => {
    _store.delete(k)
  },
  key: (i) => Array.from(_store.keys())[i] ?? null,
}
Object.defineProperty(globalThis, 'localStorage', {
  value: storageStub,
  writable: true,
  configurable: true,
})

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))

const { migrateLegacyDraftIfPresent } =
  await import('../use-task-workflow-runtime')

const TASK_ID = '00000000-0000-0000-0000-0000000000aa'
const USER_ID = 'user-1'

beforeEach(() => {
  _store.clear()
})

describe('draft scoped-key migration', () => {
  it('copies legacy unified-cycle-count-draft into the new scoped key', () => {
    const payload = JSON.stringify({ taskId: TASK_ID, formState: { x: 1 } })
    localStorage.setItem(`unified-cycle-count-draft-${USER_ID}`, payload)

    migrateLegacyDraftIfPresent('cycle_count', USER_ID, TASK_ID)

    const newKey = `work-draft-cycle_count-${USER_ID}-${TASK_ID}`
    expect(localStorage.getItem(newKey)).toBe(payload)
    expect(
      localStorage.getItem(`unified-cycle-count-draft-${USER_ID}`)
    ).toBeNull()
  })

  it('does not overwrite an existing new-format draft', () => {
    const newKey = `work-draft-cycle_count-${USER_ID}-${TASK_ID}`
    localStorage.setItem(
      newKey,
      JSON.stringify({ taskId: TASK_ID, formState: { y: 2 } })
    )
    localStorage.setItem(
      `cycle-count-draft-${TASK_ID}`,
      JSON.stringify({ taskId: TASK_ID, formState: { y: 99 } })
    )
    migrateLegacyDraftIfPresent('cycle_count', USER_ID, TASK_ID)
    expect(JSON.parse(localStorage.getItem(newKey)!).formState.y).toBe(2)
  })

  it('skips when legacy entry is for a different task', () => {
    localStorage.setItem(
      `cycle-count-draft-${TASK_ID}`,
      JSON.stringify({ taskId: 'other-task', formState: {} })
    )
    migrateLegacyDraftIfPresent('cycle_count', USER_ID, TASK_ID)
    const newKey = `work-draft-cycle_count-${USER_ID}-${TASK_ID}`
    expect(localStorage.getItem(newKey)).toBeNull()
  })
})

// Created and developed by Jai Singh
