// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  AREA_COLOR_KEYS,
  CANONICAL_SKILLS,
  deriveAreaColor,
  deriveDemonstratedSkills,
  getPrimarySkillPillCode,
  getSkillLabel,
  getSkillState,
  mapEventTypeToSkill,
  mapPositionToSkill,
} from './skills'
import type { AssociateSkills, SkillId } from './skills'

describe('mapPositionToSkill', () => {
  it('matches case-insensitively across whitespace and punctuation', () => {
    expect(mapPositionToSkill('Picker')).toBe('picker')
    expect(mapPositionToSkill('PICKER / SELECTOR')).toBe('picker')
    expect(mapPositionToSkill('  packer  ')).toBe('packer')
  })

  it('routes leadership terms before generic operator words', () => {
    // "Team Lead" must NOT be classified as the generic warehouse fallback.
    expect(mapPositionToSkill('Team Lead')).toBe('lead')
    expect(mapPositionToSkill('Outbound Supervisor')).toBe('lead')
    // Coordinator wins over the warehouse fallback.
    expect(mapPositionToSkill('Branch Coordinator')).toBe('coordinator')
  })

  it('matches multi-word real titles seen in production', () => {
    expect(mapPositionToSkill('Cycle Count Auditor')).toBe('cycle_count')
    expect(mapPositionToSkill('Shipping Clerk')).toBe('shipper')
    // "Quality Inspector" has no skill keyword; "Material Control Analyst"
    // is similarly unmatched — both fall back to the warehouse bucket.
    expect(mapPositionToSkill('Quality Inspector')).toBe('warehouse')
    expect(mapPositionToSkill('Material Control Analyst')).toBe('warehouse')
    // "Stocker" is checked before "Inbound" — the operational verb
    // wins over the area-name keyword.
    expect(mapPositionToSkill('Inbound Stocker')).toBe('putaway')
    expect(mapPositionToSkill('Inbound Receiver')).toBe('receiver')
    expect(mapPositionToSkill('RF Operator')).toBe('rf')
    expect(mapPositionToSkill('Radio Frequency Specialist')).toBe('rf')
  })

  it('falls back to "warehouse" when no rule matches', () => {
    expect(mapPositionToSkill('Warehouse Associate')).toBe('warehouse')
    expect(mapPositionToSkill(null)).toBe('warehouse')
    expect(mapPositionToSkill(undefined)).toBe('warehouse')
    expect(mapPositionToSkill('')).toBe('warehouse')
    expect(mapPositionToSkill('Plant Manager')).toBe('warehouse')
  })

  it('does not misclassify words that incidentally contain a keyword', () => {
    // "Material Handler" must not match `lead` even though it shares no
    // letters; we just want to confirm the routing isn't grabbing
    // unrelated titles.
    expect(mapPositionToSkill('Material Handler')).toBe('warehouse')
  })
})

describe('mapEventTypeToSkill', () => {
  it('maps every activity_source_config event_type observed in prod', () => {
    expect(mapEventTypeToSkill('inbound_scan')).toBe('receiver')
    expect(mapEventTypeToSkill('putaway')).toBe('putaway')
    expect(mapEventTypeToSkill('putaway_confirm')).toBe('putaway')
    expect(mapEventTypeToSkill('cart_stow')).toBe('putaway')
    expect(mapEventTypeToSkill('putback')).toBe('putaway')
    expect(mapEventTypeToSkill('picking')).toBe('picker')
    expect(mapEventTypeToSkill('kit_picking')).toBe('picker')
    expect(mapEventTypeToSkill('pack')).toBe('packer')
    expect(mapEventTypeToSkill('final_pack')).toBe('packer')
    expect(mapEventTypeToSkill('ship')).toBe('shipper')
    expect(mapEventTypeToSkill('cycle_count')).toBe('cycle_count')
  })

  it('returns null for activity types with no skill mapping', () => {
    expect(mapEventTypeToSkill('customer_response')).toBeNull()
    expect(mapEventTypeToSkill('unknown_thing')).toBeNull()
    expect(mapEventTypeToSkill('')).toBeNull()
  })
})

describe('deriveDemonstratedSkills', () => {
  it('produces a Set of canonical ids from a flat type list', () => {
    const set = deriveDemonstratedSkills([
      'picking',
      'picking',
      'putaway_confirm',
      'customer_response', // ignored
    ])
    expect(set.has('picker')).toBe(true)
    expect(set.has('putaway')).toBe(true)
    expect(set.size).toBe(2)
  })

  it('handles an empty event stream', () => {
    const set = deriveDemonstratedSkills([])
    expect(set.size).toBe(0)
  })

  it('ignores duplicate event types', () => {
    const set = deriveDemonstratedSkills(['picking', 'picking', 'kit_picking'])
    expect(set.size).toBe(1)
    expect(set.has('picker')).toBe(true)
  })
})

describe('getSkillState', () => {
  function mkSkills(
    primary: AssociateSkills['primarySkill'],
    demonstrated: SkillId[]
  ): AssociateSkills {
    return {
      primarySkill: primary,
      demonstratedSkills: new Set(demonstrated),
    }
  }

  it('returns primary when the skill matches the assignment', () => {
    const s = mkSkills('picker', ['putaway'])
    expect(getSkillState(s, 'picker')).toBe('primary')
  })

  it('returns demonstrated when activity exists but skill is not primary', () => {
    const s = mkSkills('picker', ['putaway'])
    expect(getSkillState(s, 'putaway')).toBe('demonstrated')
  })

  it('primary outranks demonstrated when both apply', () => {
    // If their position is "Picker" and they also picked today, the tile
    // shows "primary" — primary always wins.
    const s = mkSkills('picker', ['picker', 'putaway'])
    expect(getSkillState(s, 'picker')).toBe('primary')
  })

  it('returns none when neither primary nor demonstrated', () => {
    const s = mkSkills('picker', ['putaway'])
    expect(getSkillState(s, 'shipper')).toBe('none')
  })

  it('non-canonical primaries (warehouse / coordinator) leave every tile demonstrated-or-none', () => {
    const s = mkSkills('warehouse', ['picker'])
    // No tile is shaded primary because primarySkill is not in the tile list.
    expect(getSkillState(s, 'picker')).toBe('demonstrated')
    expect(getSkillState(s, 'shipper')).toBe('none')

    const s2 = mkSkills('coordinator', [])
    expect(getSkillState(s2, 'lead')).toBe('none')
    expect(getSkillState(s2, 'picker')).toBe('none')
  })
})

describe('CANONICAL_SKILLS list', () => {
  it('renders each tile in the documented order', () => {
    expect(CANONICAL_SKILLS.map((s) => s.id)).toEqual([
      'picker',
      'packer',
      'shipper',
      'putaway',
      'receiver',
      'cycle_count',
      'rf',
      'lead',
    ])
  })

  it('has unique tile codes (no two tiles render the same monogram)', () => {
    const codes = CANONICAL_SKILLS.map((s) => s.code)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('getSkillLabel / getPrimarySkillPillCode', () => {
  it('returns a human label for canonical and fallback ids', () => {
    expect(getSkillLabel('picker')).toBe('Picker')
    expect(getSkillLabel('cycle_count')).toBe('Cycle Count')
    expect(getSkillLabel('warehouse')).toBe('Warehouse')
    expect(getSkillLabel('coordinator')).toBe('Coordinator')
  })

  it('returns a short uppercase pill code', () => {
    expect(getPrimarySkillPillCode('picker')).toBe('PICK')
    expect(getPrimarySkillPillCode('cycle_count')).toBe('CYCLE')
    expect(getPrimarySkillPillCode('warehouse')).toBe('WHS')
    expect(getPrimarySkillPillCode('coordinator')).toBe('COORD')
  })
})

describe('deriveAreaColor', () => {
  it('returns one of the curated palette keys', () => {
    const color = deriveAreaColor('IB-001')
    expect(AREA_COLOR_KEYS).toContain(color)
  })

  it('is deterministic — same input always returns the same colour', () => {
    expect(deriveAreaColor('OB-001')).toBe(deriveAreaColor('OB-001'))
    expect(deriveAreaColor('IB-001')).toBe(deriveAreaColor('IB-001'))
    // Distinct inputs *can* collide (8 buckets) — but the function is
    // not allowed to return different colours for the same string.
  })

  it('falls back to emerald for null/undefined/empty input', () => {
    expect(deriveAreaColor(null)).toBe('emerald')
    expect(deriveAreaColor(undefined)).toBe('emerald')
    expect(deriveAreaColor('')).toBe('emerald')
  })
})

// Created and developed by Jai Singh
