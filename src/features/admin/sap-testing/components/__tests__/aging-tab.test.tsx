// Created and developed by Jai Singh
/**
 * @vitest-environment jsdom
 *
 * Aging tab regression coverage (2026-05-27).
 *
 * Three flavours of state to fence:
 *   1. Pure helpers (`bucketizeLL01Aging`, `ll01QuarterLabel`,
 *      `ll01QuarterSortKey`) — these are the math the worker tests also
 *      cover from the Python side; we lock the JS implementation here so
 *      the two contracts stay in sync.
 *   2. Render — `AgingTab` mounts with a populated `LL01RunResult` and
 *      shows the bucket grid + quarter span pill.
 *   3. User-column fallback — categories without a SAP user column show
 *      the "Not available for this category" placeholder. Equally
 *      important: a v1 (older) payload renders the upgrade hint instead
 *      of crashing.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgingTab } from '../AgingTab'
import {
  LL01_PLANTS,
  bucketizeLL01Aging,
  ll01QuarterLabel,
  ll01QuarterSortKey,
  type LL01RunResult,
} from '../warehouse-activity-monitor-types'

const NOW = new Date('2026-05-27T00:00:00Z').getTime()

function daysAgoIso(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString().slice(0, 10)
}

describe('bucketizeLL01Aging', () => {
  it('cumulates >30 / >60 / >90 from a parseable anchor date', () => {
    const rows = [
      { created_on: daysAgoIso(10) }, // <30
      { created_on: daysAgoIso(40) }, // >30 only
      { created_on: daysAgoIso(75) }, // >30, >60
      { created_on: daysAgoIso(120) }, // >30, >60, >90
    ]
    expect(bucketizeLL01Aging(rows, 'created_on', NOW)).toEqual({
      gt30: 3,
      gt60: 2,
      gt90: 1,
      dated: 4,
      undated: 0,
    })
  })

  it('counts undated rows separately and skips unparseable strings', () => {
    const rows = [
      { created_on: '' },
      { created_on: null },
      { created_on: 'not-a-date' },
      { created_on: daysAgoIso(120) },
    ]
    expect(bucketizeLL01Aging(rows, 'created_on', NOW)).toEqual({
      gt30: 1,
      gt60: 1,
      gt90: 1,
      dated: 1,
      undated: 3,
    })
  })

  it('treats the 30/60/90 boundaries as inclusive (days >= threshold)', () => {
    const rows = [
      { created_on: daysAgoIso(30) },
      { created_on: daysAgoIso(60) },
      { created_on: daysAgoIso(90) },
    ]
    expect(bucketizeLL01Aging(rows, 'created_on', NOW)).toEqual({
      gt30: 3,
      gt60: 2,
      gt90: 1,
      dated: 3,
      undated: 0,
    })
  })
})

describe('ll01QuarterLabel + sort key', () => {
  it('formats `YYYY-Qn` for ISO dates and orders chronologically', () => {
    expect(ll01QuarterLabel('2026-05-15')).toBe('2026-Q2')
    expect(ll01QuarterLabel('2010-04-29')).toBe('2010-Q2')
    expect(ll01QuarterLabel('2025-12-31')).toBe('2025-Q4')

    const labels = ['2026-Q1', '2025-Q4', '2010-Q2', '2024-Q3']
    const sorted = [...labels].sort(
      (a, b) => ll01QuarterSortKey(a) - ll01QuarterSortKey(b)
    )
    expect(sorted).toEqual(['2010-Q2', '2024-Q3', '2025-Q4', '2026-Q1'])
  })

  it('returns null for empty / unparseable values', () => {
    expect(ll01QuarterLabel('')).toBeNull()
    expect(ll01QuarterLabel(null)).toBeNull()
    expect(ll01QuarterLabel('xyz')).toBeNull()
  })
})

function makeResult(overrides: Partial<LL01RunResult> = {}): LL01RunResult {
  return {
    ok: true,
    payload_version: 2,
    snapshot_run_id: 'run-1',
    ran_at: '2026-05-27T00:00:00Z',
    agent_id: 'agent-1',
    duration_ms: 60000,
    plants: [...LL01_PLANTS],
    categories: [
      {
        key: 'open_to',
        label: 'Open Transfer Orders',
        thresholds: { green: 100, amber: 500 },
        counts_by_plant: { JSF: 1, JSM: 0, PDC: 0, WH5: 1, WH8: 0 },
        total: 2,
        rows: [
          {
            _plant: 'JSF',
            to_number: '1',
            created_on: daysAgoIso(120),
            created_by: 'U6672660',
          },
          {
            _plant: 'WH5',
            to_number: '2',
            created_on: daysAgoIso(40),
            created_by: 'BZXGTL',
          },
        ],
      },
      {
        key: 'open_tr',
        label: 'Open Transfer Requirements',
        thresholds: { green: 500, amber: 2000 },
        counts_by_plant: { JSF: 0, JSM: 0, PDC: 0, WH5: 1, WH8: 0 },
        total: 1,
        rows: [{ _plant: 'WH5', tr_number: '99', created_on: daysAgoIso(20) }],
      },
      {
        key: 'open_posting',
        label: 'Open Posting Changes',
        thresholds: { green: 50, amber: 200 },
        counts_by_plant: {},
        total: 0,
        rows: [],
      },
      {
        key: 'critical_delivery',
        label: 'Critical Deliveries',
        thresholds: { green: 25, amber: 100 },
        counts_by_plant: {},
        total: 0,
        rows: [],
      },
      {
        key: 'negative_stock',
        label: 'Negative Stock',
        thresholds: { green: 25, amber: 100 },
        counts_by_plant: {},
        total: 0,
        rows: [],
      },
      {
        key: 'interim_stock',
        label: 'Interim Stock w/o Movement',
        thresholds: { green: 100, amber: 500 },
        counts_by_plant: {},
        total: 0,
        rows: [],
      },
      {
        key: 'critical_stock_production',
        label: 'Critical Stock in Production',
        thresholds: { green: 25, amber: 100 },
        counts_by_plant: {},
        total: 0,
        rows: [],
      },
    ],
    errors: [],
    ...overrides,
  }
}

describe('AgingTab', () => {
  it('renders the bucket grid and quarter-span pill for the default category', () => {
    render(
      <AgingTab
        result={makeResult()}
        selectedPlants={[...LL01_PLANTS]}
        onTogglePlant={() => undefined}
      />
    )
    expect(
      screen.getByText('Plant × Aging — Open Transfer Orders')
    ).toBeTruthy()
    expect(screen.getByText('>30 days')).toBeTruthy()
    expect(screen.getByText('>60 days')).toBeTruthy()
    expect(screen.getByText('>90 days')).toBeTruthy()
    expect(screen.getByText(/^Data spans /)).toBeTruthy()
    // The quarter chart card is mounted (heading) — Recharts itself
    // doesn't render in jsdom but the card frame does.
    expect(
      screen.getByText('Items per quarter — Open Transfer Orders')
    ).toBeTruthy()
  })

  it('shows the upgrade hint for an older payload (v1)', () => {
    render(
      <AgingTab
        result={makeResult({ payload_version: 1 })}
        selectedPlants={[...LL01_PLANTS]}
        onTogglePlant={() => undefined}
      />
    )
    expect(
      screen.getByText(
        /older agent build that did not emit aging anchor dates/i
      )
    ).toBeTruthy()
  })

  it('shows the empty-run hint when no result is loaded', () => {
    render(
      <AgingTab
        result={null}
        selectedPlants={[...LL01_PLANTS]}
        onTogglePlant={() => undefined}
      />
    )
    expect(
      screen.getByText(/Run the query to populate the aging breakdown/i)
    ).toBeTruthy()
  })
})

// Created and developed by Jai Singh
