// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  detectNonWarehouseBins,
  normaliseBinPatterns,
} from '@/lib/kitting/non-warehouse-bins'
import type { TransferOrderRecord } from '@/components/ui/add-kit-build-plan-dialog'

function makeRecord(
  overrides: Partial<TransferOrderRecord> = {}
): TransferOrderRecord {
  return {
    destStorageBin: '2010102614',
    transferOrderNumber: '7289909',
    sourceStorageType: '',
    warehouseNumber: '',
    destStorageType: '',
    movementTypeIM: '',
    movementTypeWM: '',
    sourceStorageBin: '',
    plant: '',
    storageLocation: '',
    material: 'M250-10657',
    materialDescription: 'BRACKET, OIL PRESSURE -- Torquemeter',
    batch: '',
    sourceTargetQty: '1',
    creationDate: '',
    creationTime: '',
    user: '',
    printer: '',
    specialStockNumber: '',
    ...overrides,
  }
}

describe('detectNonWarehouseBins', () => {
  it('returns an empty detection when patterns are empty', () => {
    const out = detectNonWarehouseBins(
      [makeRecord({ sourceStorageBin: '112NEEDBIN' })],
      []
    )
    expect(out.hasMatches).toBe(false)
    expect(out.matches).toEqual([])
    expect(out.patternsTriggered).toEqual([])
    expect(out.binsTriggered).toEqual([])
  })

  it('returns an empty detection when records are empty', () => {
    const out = detectNonWarehouseBins([], ['NEEDBIN'])
    expect(out.hasMatches).toBe(false)
    expect(out.matches).toEqual([])
  })

  it('matches case-insensitively on a substring of sourceStorageBin', () => {
    const records = [
      makeRecord({
        transferOrderNumber: 'TO-1',
        sourceStorageBin: '112NEEDBIN',
      }),
      makeRecord({
        transferOrderNumber: 'TO-2',
        sourceStorageBin: 'r0needbin', // lowercase still matches NEEDBIN
      }),
      makeRecord({
        transferOrderNumber: 'TO-3',
        sourceStorageBin: 'WH-A-01-01',
      }),
    ]
    const out = detectNonWarehouseBins(records, ['NEEDBIN'])
    expect(out.hasMatches).toBe(true)
    expect(out.matches.map((m) => m.record.transferOrderNumber)).toEqual([
      'TO-1',
      'TO-2',
    ])
    expect(out.matches.every((m) => m.matchedPattern === 'NEEDBIN')).toBe(true)
    expect(out.binsTriggered).toEqual(['112NEEDBIN', 'r0needbin'])
    expect(out.patternsTriggered).toEqual(['NEEDBIN'])
  })

  it('reports the first pattern matched per record', () => {
    const out = detectNonWarehouseBins(
      [makeRecord({ sourceStorageBin: '112NEEDBIN-EXT' })],
      ['NEEDBIN', '112']
    )
    expect(out.matches).toHaveLength(1)
    // 'NEEDBIN' comes first in the normalised list — pattern order matters.
    expect(out.matches[0].matchedPattern).toBe('NEEDBIN')
  })

  it('drops blank patterns and trims whitespace', () => {
    const out = detectNonWarehouseBins(
      [makeRecord({ sourceStorageBin: '112NEEDBIN' })],
      ['  ', '\tNEEDBIN  ', '']
    )
    expect(out.hasMatches).toBe(true)
    expect(out.matches[0].matchedPattern).toBe('NEEDBIN')
  })

  it('never matches a record with an empty sourceStorageBin', () => {
    const out = detectNonWarehouseBins(
      [
        makeRecord({ sourceStorageBin: '' }),
        makeRecord({ sourceStorageBin: '   ' }),
        makeRecord({ sourceStorageBin: undefined as unknown as string }),
      ],
      ['NEEDBIN']
    )
    expect(out.hasMatches).toBe(false)
  })

  it('deduplicates patternsTriggered and binsTriggered', () => {
    const records = [
      makeRecord({
        transferOrderNumber: 'TO-1',
        sourceStorageBin: '112NEEDBIN',
      }),
      makeRecord({
        transferOrderNumber: 'TO-2',
        sourceStorageBin: '112NEEDBIN',
      }),
      makeRecord({
        transferOrderNumber: 'TO-3',
        sourceStorageBin: 'OTHERNEEDBIN',
      }),
    ]
    const out = detectNonWarehouseBins(records, ['NEEDBIN'])
    expect(out.binsTriggered).toEqual(['112NEEDBIN', 'OTHERNEEDBIN'])
    expect(out.patternsTriggered).toEqual(['NEEDBIN'])
  })
})

describe('normaliseBinPatterns', () => {
  it('uppercases + trims + dedupes', () => {
    expect(
      normaliseBinPatterns(['needbin', ' NeedBin ', 'OFFSITE', 'offsite', ''])
    ).toEqual(['NEEDBIN', 'OFFSITE'])
  })

  it('returns an empty array when all inputs are blank', () => {
    expect(normaliseBinPatterns(['', '   ', '\t'])).toEqual([])
  })

  it('preserves first-seen order across duplicates', () => {
    expect(normaliseBinPatterns(['B', 'A', 'a', 'b'])).toEqual(['B', 'A'])
  })
})

// Created and developed by Jai Singh
