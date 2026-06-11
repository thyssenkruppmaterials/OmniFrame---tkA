// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLANT_LOCATIONS,
  normalizePlantLocations,
  withCurrentPlantOption,
} from '@/lib/kitting/plant-locations'

describe('normalizePlantLocations', () => {
  it('trims whitespace on both ends of every entry', () => {
    expect(
      normalizePlantLocations([
        '  Plant A - Main Assembly  ',
        '\tPlant B - Component Shop\n',
      ])
    ).toEqual(['Plant A - Main Assembly', 'Plant B - Component Shop'])
  })

  it('drops blank and whitespace-only entries', () => {
    expect(
      normalizePlantLocations(['Plant A', '', '   ', 'Plant B', '\t\n'])
    ).toEqual(['Plant A', 'Plant B'])
  })

  it('deduplicates case-insensitively but preserves first-seen casing', () => {
    expect(
      normalizePlantLocations([
        'Plant A - Main Assembly',
        'plant a - main assembly',
        'PLANT A - MAIN ASSEMBLY',
        'Plant B - Component Shop',
      ])
    ).toEqual(['Plant A - Main Assembly', 'Plant B - Component Shop'])
  })

  it('preserves insertion order of unique entries', () => {
    expect(
      normalizePlantLocations([
        'Shipping Dock',
        'Plant E - Quality Center',
        'Plant A - Main Assembly',
      ])
    ).toEqual([
      'Shipping Dock',
      'Plant E - Quality Center',
      'Plant A - Main Assembly',
    ])
  })

  it('returns an empty array when given an empty array', () => {
    expect(normalizePlantLocations([])).toEqual([])
  })

  it('ignores non-string entries defensively', () => {
    expect(
      normalizePlantLocations([
        'Plant A',
        // @ts-expect-error — intentional bad input
        null,
        // @ts-expect-error — intentional bad input
        undefined,
        // @ts-expect-error — intentional bad input
        42,
        'Plant B',
      ])
    ).toEqual(['Plant A', 'Plant B'])
  })

  it('does NOT uppercase entries (these are user-facing labels)', () => {
    expect(normalizePlantLocations(['plant a - assembly'])).toEqual([
      'plant a - assembly',
    ])
  })
})

describe('withCurrentPlantOption', () => {
  it('returns the list unchanged when currentValue is empty', () => {
    expect(withCurrentPlantOption(['Plant A', 'Plant B'], undefined)).toEqual([
      'Plant A',
      'Plant B',
    ])
    expect(withCurrentPlantOption(['Plant A', 'Plant B'], null)).toEqual([
      'Plant A',
      'Plant B',
    ])
    expect(withCurrentPlantOption(['Plant A', 'Plant B'], '')).toEqual([
      'Plant A',
      'Plant B',
    ])
    expect(withCurrentPlantOption(['Plant A', 'Plant B'], '   ')).toEqual([
      'Plant A',
      'Plant B',
    ])
  })

  it('returns the list unchanged when currentValue is already present (case-insensitive)', () => {
    expect(withCurrentPlantOption(['Plant A', 'Plant B'], 'plant a')).toEqual([
      'Plant A',
      'Plant B',
    ])
  })

  it('appends currentValue when it is not present', () => {
    expect(
      withCurrentPlantOption(['Plant A', 'Plant B'], 'Legacy Plant Z')
    ).toEqual(['Plant A', 'Plant B', 'Legacy Plant Z'])
  })
})

describe('DEFAULT_PLANT_LOCATIONS', () => {
  it('matches the eight values that used to be hardcoded in the dialog', () => {
    expect(DEFAULT_PLANT_LOCATIONS).toEqual([
      'Plant A - Main Assembly',
      'Plant B - Component Shop',
      'Plant C - Engine Test',
      'Plant D - Logistics Hub',
      'Plant E - Quality Center',
      'Warehouse 1',
      'Warehouse 2',
      'Shipping Dock',
    ])
  })
})

// Created and developed by Jai Singh
