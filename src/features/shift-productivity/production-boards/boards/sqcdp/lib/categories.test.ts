// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_CATEGORIES,
  BUILTIN_CATEGORY_SEED,
  BUILTIN_SQCDP_CATEGORY_IDS,
  defaultColorFor,
  getCategory,
  getCategoryOrThrow,
  slugifyCategoryLabel,
  visiblePrimaryCategories,
  visibleSecondaryCategories,
  type SqcdpCategoryDef,
} from './categories'
import { resolveCategoryIcon } from './category-icons'

const empty: readonly SqcdpCategoryDef[] = []

function makeCustom(
  id: string,
  tier: 'primary' | 'secondary' = 'primary',
  overrides: Partial<SqcdpCategoryDef> = {}
): SqcdpCategoryDef {
  return {
    id,
    label: id.toUpperCase(),
    defaultColor: '#0EA5A9',
    Icon: resolveCategoryIcon('IconCircleDashed'),
    iconName: 'IconCircleDashed',
    tier,
    displayOrder: 0,
    isBuiltin: false,
    isHidden: false,
    ...overrides,
  }
}

describe('SQCDP categories — builtin seed', () => {
  it('locks the canonical list at exactly 9 entries', () => {
    expect(BUILTIN_CATEGORY_SEED.length).toBe(9)
    expect(BUILTIN_SQCDP_CATEGORY_IDS.length).toBe(9)
    expect(BUILTIN_CATEGORIES.length).toBe(9)
  })

  it('uses valid 6-digit hex colours for every default colour', () => {
    const hex = /^#[0-9A-Fa-f]{6}$/
    for (const c of BUILTIN_CATEGORY_SEED) {
      expect(c.defaultColor).toMatch(hex)
    }
  })

  it('classifies the 5 SQCDP primaries and 4 secondaries correctly', () => {
    const primaries = BUILTIN_CATEGORY_SEED.filter((c) => c.tier === 'primary')
    const secondaries = BUILTIN_CATEGORY_SEED.filter(
      (c) => c.tier === 'secondary'
    )
    expect(primaries.map((c) => c.id)).toEqual([
      'safety',
      'quality',
      'cost',
      'delivery',
      'production',
    ])
    expect(secondaries.map((c) => c.id)).toEqual([
      'maintenance',
      'shipping',
      'big_idea',
      'announcement',
    ])
  })

  it('seed icon names all resolve to a real Tabler icon', () => {
    for (const c of BUILTIN_CATEGORY_SEED) {
      const Icon = resolveCategoryIcon(c.iconName)
      expect(typeof Icon).toBe('object')
    }
  })
})

describe('SQCDP categories — getCategory', () => {
  it('finds a category in the passed list', () => {
    const list: SqcdpCategoryDef[] = [makeCustom('safety')]
    expect(getCategory('safety', list)?.label).toBe('SAFETY')
  })

  it('falls back to the builtin seed when not in the list', () => {
    expect(getCategory('safety', empty)?.label).toBe('Safety')
    expect(getCategory('big_idea', empty)?.label).toBe('Big Idea')
  })

  it('returns null for an unknown non-builtin slug', () => {
    expect(getCategory('does_not_exist', empty)).toBeNull()
  })

  it('getCategoryOrThrow throws when nothing matches', () => {
    expect(() => getCategoryOrThrow('does_not_exist', empty)).toThrow(
      /Unknown SQCDP category/
    )
  })

  it('hidden categories still resolve via getCategory', () => {
    const list: SqcdpCategoryDef[] = [
      makeCustom('safety', 'primary', { isHidden: true }),
    ]
    const cat = getCategory('safety', list)
    expect(cat?.isHidden).toBe(true)
  })
})

describe('SQCDP categories — defaultColorFor', () => {
  it('returns the seed default for a builtin even when the list is empty', () => {
    expect(defaultColorFor('safety', empty)).toBe('#DC2626')
    expect(defaultColorFor('big_idea', empty)).toBe('#1E3A8A')
  })

  it('returns a neutral fallback for an unknown slug', () => {
    expect(defaultColorFor('does_not_exist', empty)).toBe('#0EA5A9')
  })

  it('prefers the passed-list value over the builtin', () => {
    const list: SqcdpCategoryDef[] = [
      makeCustom('safety', 'primary', { defaultColor: '#000000' }),
    ]
    expect(defaultColorFor('safety', list)).toBe('#000000')
  })
})

describe('SQCDP categories — slugifyCategoryLabel', () => {
  it('lowercases, replaces spaces, strips bad characters', () => {
    expect(slugifyCategoryLabel('My New Category!')).toBe('my_new_category')
    expect(slugifyCategoryLabel('  Audits & Compliance  ')).toBe(
      'audits_compliance'
    )
  })

  it('falls back to a non-empty placeholder for whitespace', () => {
    expect(slugifyCategoryLabel('   ')).toBe('category')
    expect(slugifyCategoryLabel('')).toBe('category')
  })

  it('clamps to 64 chars', () => {
    const long = 'a'.repeat(100)
    expect(slugifyCategoryLabel(long).length).toBeLessThanOrEqual(64)
  })

  it('matches the DB CHECK constraint regex', () => {
    const re = /^[a-z0-9_]+$/
    for (const sample of ['Cost', 'On-Time Delivery', '5S Audits']) {
      expect(slugifyCategoryLabel(sample)).toMatch(re)
    }
  })
})

describe('SQCDP categories — visible filters', () => {
  it('drops hidden categories and sorts by displayOrder', () => {
    const list: SqcdpCategoryDef[] = [
      makeCustom('quality', 'primary', { displayOrder: 1 }),
      makeCustom('safety', 'primary', { displayOrder: 0 }),
      makeCustom('hidden', 'primary', { isHidden: true, displayOrder: 99 }),
      makeCustom('shipping', 'secondary', { displayOrder: 1 }),
      makeCustom('maintenance', 'secondary', { displayOrder: 0 }),
    ]
    expect(visiblePrimaryCategories(list).map((c) => c.id)).toEqual([
      'safety',
      'quality',
    ])
    expect(visibleSecondaryCategories(list).map((c) => c.id)).toEqual([
      'maintenance',
      'shipping',
    ])
  })

  it('returns empty arrays when the tier is empty', () => {
    expect(visiblePrimaryCategories([])).toEqual([])
    expect(visibleSecondaryCategories([])).toEqual([])
  })
})

// Created and developed by Jai Singh
