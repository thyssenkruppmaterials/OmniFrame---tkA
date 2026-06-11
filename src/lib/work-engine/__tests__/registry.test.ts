// Created and developed by Jai Singh
/**
 * Phase 13.4 — WorkTypeConfig registry exhaustiveness.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))
vi.mock('@/lib/supabase/work-engine-settings.service', () => ({
  workEngineSettingsService: {},
  invalidateWorkEngineFlagCache: () => {},
}))

const { workTypeRegistry } = await import('../registry')
const { assertWorkTypeConfigComplete } = await import('../types')

const REQUIRED_IDS = [
  'cycle_count',
  'zone_audit',
  'pick',
  'putaway',
  'replenish',
  'kit_pick',
] as const

describe('workTypeRegistry', () => {
  it('has every WorkTypeId registered', () => {
    for (const id of REQUIRED_IDS) {
      expect(workTypeRegistry[id]).toBeTruthy()
      expect(workTypeRegistry[id].id).toBe(id)
    }
  })

  it('every config satisfies the contract', () => {
    for (const cfg of Object.values(workTypeRegistry)) {
      expect(() => assertWorkTypeConfigComplete(cfg)).not.toThrow()
    }
  })

  it('cycle_count, zone_audit, and pick are enabled; putaway/replenish/kit_pick stay stubs', () => {
    expect(workTypeRegistry.cycle_count.enabled).toBe(true)
    expect(workTypeRegistry.zone_audit.enabled).toBe(true)
    expect(workTypeRegistry.pick.enabled).toBe(true)
    for (const id of ['putaway', 'replenish', 'kit_pick'] as const) {
      expect(workTypeRegistry[id].enabled).toBe(false)
    }
  })

  it('disabled stubs throw when their RootComponent is invoked', () => {
    expect(() => {
      const Cmp = workTypeRegistry.putaway.RootComponent
      // @ts-expect-error stub doesn't accept real props in tests; we just need the throw
      Cmp({})
    }).toThrow(/not enabled/i)
  })
})

// Created and developed by Jai Singh
