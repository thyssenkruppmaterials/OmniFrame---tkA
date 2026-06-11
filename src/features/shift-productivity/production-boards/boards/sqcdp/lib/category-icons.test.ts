// Created and developed by Jai Singh
import { IconCircleDashed, IconShield } from '@tabler/icons-react'
import { describe, expect, it, beforeEach } from 'vitest'
import {
  SQCDP_CATEGORY_ICONS,
  SQCDP_CATEGORY_ICON_OPTIONS,
  resolveCategoryIcon,
  _resetCategoryIconWarnCache,
} from './category-icons'

describe('SQCDP category icons — allowlist', () => {
  beforeEach(() => {
    _resetCategoryIconWarnCache()
  })

  it('every option in the picker grid resolves to a registered icon', () => {
    for (const opt of SQCDP_CATEGORY_ICON_OPTIONS) {
      expect(SQCDP_CATEGORY_ICONS[opt.name]).toBeTruthy()
    }
  })

  it('every name has a non-empty human-readable label', () => {
    for (const opt of SQCDP_CATEGORY_ICON_OPTIONS) {
      expect(opt.label.trim().length).toBeGreaterThan(0)
    }
  })

  it('resolves the 9 builtin SQCDP icons by name', () => {
    expect(resolveCategoryIcon('IconShield')).toBe(IconShield)
  })

  it('falls back to IconCircleDashed for unknown names', () => {
    expect(resolveCategoryIcon('IconDoesNotExist')).toBe(IconCircleDashed)
  })

  it('falls back to IconCircleDashed for null / empty', () => {
    expect(resolveCategoryIcon(null)).toBe(IconCircleDashed)
    expect(resolveCategoryIcon('')).toBe(IconCircleDashed)
  })
})

// Created and developed by Jai Singh
