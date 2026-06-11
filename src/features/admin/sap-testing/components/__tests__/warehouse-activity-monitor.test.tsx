// Created and developed by Jai Singh
/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HeatmapTab, exportDrilldownCsv } from '../HeatmapTab'
import { TrendTab, computeSpikeAlerts, exportTrendCsv } from '../TrendTab'
import {
  LL01_CATEGORY_META,
  LL01_PLANTS,
  classifyLL01Severity,
  trendArrow,
  type LL01RunResult,
  type LL01SnapshotRow,
} from '../warehouse-activity-monitor-types'

const mockResult: LL01RunResult = {
  ok: true,
  snapshot_run_id: 'run-1',
  ran_at: '2026-05-22T12:00:00Z',
  agent_id: 'agent-1',
  duration_ms: 120000,
  plants: [...LL01_PLANTS],
  categories: LL01_CATEGORY_META.map((meta) => ({
    key: meta.key,
    label: meta.label,
    thresholds: meta.thresholds,
    counts_by_plant: Object.fromEntries(
      LL01_PLANTS.map((plant, idx) => [
        plant,
        (idx + 1) * (meta.thresholds.green + 1),
      ])
    ),
    total: LL01_PLANTS.length * (meta.thresholds.green + 1),
    rows: [],
  })),
  errors: [],
}

const priorSnapshots: LL01SnapshotRow[] = LL01_PLANTS.flatMap((plant) =>
  LL01_CATEGORY_META.map((meta) => ({
    ran_at: '2026-05-21T12:00:00Z',
    plant,
    category: meta.key,
    count: 10,
    snapshot_run_id: 'run-0',
  }))
)

describe('LL01 severity + trend helpers', () => {
  it('classifies green/amber/red per threshold table', () => {
    expect(classifyLL01Severity(50, { green: 100, amber: 500 })).toBe('green')
    expect(classifyLL01Severity(200, { green: 100, amber: 500 })).toBe('amber')
    expect(classifyLL01Severity(600, { green: 100, amber: 500 })).toBe('red')
  })

  it('trend arrow direction matches prior-run deltas', () => {
    expect(trendArrow(120, 100)).toBe('up')
    expect(trendArrow(95, 100)).toBe('flat')
    expect(trendArrow(80, 100)).toBe('down')
  })
})

describe('HeatmapTab', () => {
  it('renders 5×7 grid cells with mock data', () => {
    render(
      <HeatmapTab
        result={mockResult}
        priorSnapshots={priorSnapshots}
        isRunning={false}
        progress={null}
        lastRunAt='2026-05-22T12:00:00Z'
        selectedPlants={[...LL01_PLANTS]}
        onTogglePlant={() => undefined}
        onRefresh={() => undefined}
      />
    )
    expect(screen.getByText('Plant × Category Heatmap')).toBeTruthy()
    for (const meta of LL01_CATEGORY_META) {
      expect(screen.getByText(meta.label)).toBeTruthy()
    }
    for (const plant of LL01_PLANTS) {
      expect(screen.getAllByText(plant).length).toBeGreaterThan(0)
    }
  })

  // Regression: the fleet dispatch path unwraps `{ ok, error, step,
  // ...JobRow.result }` — a failed/result-less job yields a truthy
  // `result` whose `categories` is `undefined`. `result?.categories` only
  // guards a NULL result, so `.find(...)` inside the category map used to
  // throw "Cannot read properties of undefined (reading 'find')" and
  // white-screen the whole tab. Render must survive a drifted shape.
  it('does not crash when a drifted result is missing categories', () => {
    const drifted = {
      ok: false,
      error: 'Picked fleet agent is offline',
    } as unknown as LL01RunResult
    expect(() =>
      render(
        <HeatmapTab
          result={drifted}
          priorSnapshots={[]}
          isRunning={false}
          progress={null}
          lastRunAt='2026-05-31T12:00:00Z'
          selectedPlants={[...LL01_PLANTS]}
          onTogglePlant={() => undefined}
          onRefresh={() => undefined}
        />
      )
    ).not.toThrow()
    // Grid still renders the category labels with zeroed cells.
    expect(screen.getByText('Plant × Category Heatmap')).toBeTruthy()
    expect(screen.getByText(LL01_CATEGORY_META[0].label)).toBeTruthy()
  })

  // Regression: a failed run (ok:false, plants:[]) must NOT collapse the grid
  // to just Category/Trend/Total — the plant columns fall back to the default
  // list, and a failure banner explains why the cells are empty.
  it('keeps plant columns and shows a failure banner on a failed run', () => {
    const failed: LL01RunResult = {
      ok: false,
      snapshot_run_id: '',
      ran_at: '2026-05-31T12:00:00Z',
      agent_id: '',
      duration_ms: 0,
      plants: [],
      categories: [],
      errors: [
        {
          plant: '*',
          category: '*',
          step: 'connect',
          detail: 'SAP not connected',
        },
      ],
    }
    render(
      <HeatmapTab
        result={failed}
        priorSnapshots={[]}
        isRunning={false}
        progress={null}
        lastRunAt='2026-05-31T12:00:00Z'
        selectedPlants={[...LL01_PLANTS]}
        onTogglePlant={() => undefined}
        onRefresh={() => undefined}
      />
    )
    // Plant column headers are restored from the default list.
    for (const plant of LL01_PLANTS) {
      expect(screen.getAllByText(plant).length).toBeGreaterThan(0)
    }
    // Failure reason is surfaced.
    expect(screen.getByText(/SAP not connected/i)).toBeTruthy()
  })
})

describe('TrendTab', () => {
  it('renders 7 category chart cards', () => {
    const snapshots: LL01SnapshotRow[] = [
      {
        ran_at: '2026-05-21T12:00:00Z',
        plant: 'WH5',
        category: 'negative_stock',
        count: 100,
        snapshot_run_id: 'a',
      },
      {
        ran_at: '2026-05-22T12:00:00Z',
        plant: 'WH5',
        category: 'negative_stock',
        count: 164,
        snapshot_run_id: 'b',
      },
    ]
    render(
      <TrendTab
        snapshots={snapshots}
        selectedPlants={['WH5']}
        onTogglePlant={() => undefined}
      />
    )
    for (const meta of LL01_CATEGORY_META) {
      expect(screen.getByText(meta.label)).toBeTruthy()
    }
  })

  it('spike alerts card shows >50% delta copy', () => {
    const alerts = computeSpikeAlerts([
      {
        ran_at: '2026-05-21T12:00:00Z',
        plant: 'WH5',
        category: 'negative_stock',
        count: 1058,
        snapshot_run_id: 'prior',
      },
      {
        ran_at: '2026-05-22T16:00:00Z',
        plant: 'WH5',
        category: 'negative_stock',
        count: 1734,
        snapshot_run_id: 'latest',
      },
    ])
    expect(alerts[0]).toContain('Negative Stock at WH5 grew')
    expect(alerts[0]).toContain('1,058')
    expect(alerts[0]).toContain('1,734')
  })
})

describe('CSV export', () => {
  it('builds drilldown csv blob', () => {
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi.fn()
    vi.stubGlobal(
      'document',
      Object.assign(document, {
        createElement: () => ({ click, href: '', download: '' }),
      })
    )
    exportDrilldownCsv(
      [{ to_number: '1', material: 'M' }],
      ['to_number', 'material']
    )
    expect(createObjectURL).toHaveBeenCalled()
  })

  it('builds trend csv blob', () => {
    const createObjectURL = vi.fn(() => 'blob:mock')
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
    vi.stubGlobal(
      'document',
      Object.assign(document, {
        createElement: () => ({ click: vi.fn(), href: '', download: '' }),
      })
    )
    exportTrendCsv([
      {
        ran_at: '2026-05-22T12:00:00Z',
        plant: 'WH5',
        category: 'open_to',
        count: 3,
      },
    ])
    expect(createObjectURL).toHaveBeenCalled()
  })
})

// Created and developed by Jai Singh
