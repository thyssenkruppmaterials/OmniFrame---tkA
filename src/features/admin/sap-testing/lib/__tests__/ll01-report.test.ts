import { describe, expect, it } from 'vitest'
import type {
  LL01CategoryResult,
  LL01RunResult,
} from '../../components/warehouse-activity-monitor-types'
import { buildLL01ReportModel } from '../ll01-report'

function cat(over: Partial<LL01CategoryResult>): LL01CategoryResult {
  return {
    key: 'open_to',
    label: 'Open Transfer Orders',
    thresholds: { green: 100, amber: 500 },
    counts_by_plant: {},
    total: 0,
    rows: [],
    ...over,
  }
}

function result(over: Partial<LL01RunResult> = {}): LL01RunResult {
  return {
    ok: true,
    payload_version: 2,
    snapshot_run_id: 'run-1',
    ran_at: '2026-06-01T10:00:00Z',
    agent_id: 'agent-1',
    duration_ms: 350000,
    plants: ['JSF', 'WH5'],
    categories: [
      cat({
        key: 'open_to',
        counts_by_plant: { JSF: 2, WH5: 1 },
        total: 3,
        rows: [
          { _plant: 'JSF', created_on: '2020-01-01', created_by: 'USER1' },
          { _plant: 'JSF', created_on: '2020-02-01', created_by: 'USER1' },
          { _plant: 'WH5', created_on: '2020-03-01', created_by: 'USER2' },
        ],
      }),
    ],
    errors: [],
    ...over,
  }
}

describe('buildLL01ReportModel', () => {
  it('builds the heatmap with counts, totals and severity', () => {
    const m = buildLL01ReportModel(result())
    const openTo = m.heatmap.find((r) => r.key === 'open_to')!
    expect(openTo.cells.map((c) => [c.plant, c.count])).toEqual([
      ['JSF', 2],
      ['WH5', 1],
    ])
    expect(openTo.total).toBe(3)
    expect(openTo.severity).toBe('green') // 3 <= green threshold 100
    // Plant + grand totals account for all 7 META categories (others 0).
    expect(m.plantTotals).toEqual([
      { plant: 'JSF', total: 2 },
      { plant: 'WH5', total: 1 },
    ])
    expect(m.grandTotal).toBe(3)
    expect(m.heatmap).toHaveLength(7) // one row per LL01 category
  })

  it('computes cumulative aging buckets per plant (old dates → all >90)', () => {
    const m = buildLL01ReportModel(result())
    const aging = m.aging.find((s) => s.key === 'open_to')!
    const jsf = aging.byPlant.find((b) => b.plant === 'JSF')!
    expect(jsf).toMatchObject({
      gt30: 2,
      gt60: 2,
      gt90: 2,
      dated: 2,
      undated: 0,
    })
    expect(aging.totals).toMatchObject({
      gt30: 3,
      gt60: 3,
      gt90: 3,
      dated: 3,
      undated: 0,
    })
    expect(aging.anchorKey).toBe('created_on')
  })

  it('counts top users for categories with a user field', () => {
    const m = buildLL01ReportModel(result())
    const aging = m.aging.find((s) => s.key === 'open_to')!
    expect(aging.userField).toBe('created_by')
    expect(aging.topUsers).toEqual([
      { user: 'USER1', count: 2 },
      { user: 'USER2', count: 1 },
    ])
  })

  it('buckets records by calendar quarter', () => {
    const m = buildLL01ReportModel(result())
    const aging = m.aging.find((s) => s.key === 'open_to')!
    expect(aging.quarters).toEqual([{ quarter: '2020-Q1', total: 3 }])
    expect(aging.span).toEqual({ oldest: '2020-Q1', newest: '2020-Q1' })
  })

  it('flags supportsAging from payload_version', () => {
    expect(
      buildLL01ReportModel(result({ payload_version: 2 })).supportsAging
    ).toBe(true)
    expect(
      buildLL01ReportModel(result({ payload_version: 1 })).supportsAging
    ).toBe(false)
  })

  it('falls back to the default plant list when result.plants is empty', () => {
    const m = buildLL01ReportModel(result({ plants: [] }))
    expect(m.plants).toEqual(['JSF', 'JSM', 'PDC', 'WH5', 'WH8'])
  })
})
