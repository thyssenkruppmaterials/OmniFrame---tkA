// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import { parseLL01PlantLine } from '../../components/warehouse-activity-monitor-types'

describe('parseLL01PlantLine', () => {
  it('parses the agent per-plant progress line', () => {
    expect(parseLL01PlantLine('[ll01] Plant 2/5: JSM')).toEqual({
      plantIndex: 2,
      plantTotal: 5,
      plant: 'JSM',
    })
  })

  it('tolerates extra whitespace and is case-insensitive', () => {
    expect(parseLL01PlantLine('[LL01]  Plant  1 / 5 :  WH5')).toEqual({
      plantIndex: 1,
      plantTotal: 5,
      plant: 'WH5',
    })
  })

  it('handles the last plant', () => {
    expect(parseLL01PlantLine('[ll01] Plant 5/5: PDC')).toEqual({
      plantIndex: 5,
      plantTotal: 5,
      plant: 'PDC',
    })
  })

  it('returns null for non-progress LL01 lines', () => {
    expect(parseLL01PlantLine('[ll01] Snapshot insert failed: boom')).toBeNull()
    expect(parseLL01PlantLine('[ll01] Run payload insert failed')).toBeNull()
  })

  it('returns null for unrelated console lines and empty input', () => {
    expect(parseLL01PlantLine('[jobs] Claimed job abc')).toBeNull()
    expect(parseLL01PlantLine('')).toBeNull()
    expect(parseLL01PlantLine('random text')).toBeNull()
  })

  it('rejects a zero or malformed plant total', () => {
    expect(parseLL01PlantLine('[ll01] Plant 0/0: ?')).toBeNull()
  })
})

// Created and developed by Jai Singh
