// Created and developed by Jai Singh
/**
 * Smoke tests for <SqcdpChart>. We don't try to assert SVG output (Recharts
 * renders to SVG inside a <ResponsiveContainer> which jsdom can't size),
 * just the structural contract:
 *  - the right Recharts geometry component is mounted for each chart_type
 *  - the empty-state placeholder appears when history < 2 points
 *  - the data-chart-type attribute matches the metric.chartType
 */
import { type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SqcdpMetricRow } from '../hooks/use-sqcdp-metrics'
import { SqcdpChart } from './sqcdp-chart'

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
}))

vi.mock('recharts', async () => {
  const { Children, isValidElement, createElement: ce } = await import('react')

  function passthrough(name: string) {
    return ({
      children,
      'data-testid': dataTestId,
    }: {
      children?: ReactNode
      'data-testid'?: string
    }) =>
      ce('div', { 'data-recharts': name, 'data-testid': dataTestId }, children)
  }
  function leaf(name: string) {
    return () => ce('div', { 'data-recharts': name })
  }
  function geometry(name: string) {
    return ({ dot }: { dot?: unknown }) =>
      ce(
        'div',
        {
          'data-recharts': name,
          // Stash the dot callback on a data attribute so the parent chart
          // mock (which has the data) can invoke it for each datum.
        },
        typeof dot === 'function' ? null : null
      )
  }
  // The chart parent mock walks its children, locates any geometry that
  // carries a function-shaped `dot` prop, and calls that prop once per
  // datum so the production code's marker render path actually paints
  // <circle> markers in jsdom — which is what our smoke assertions check.
  function chartParent(name: string) {
    return ({
      children,
      data,
    }: {
      children?: ReactNode
      data?: { value: number; recordedAt?: string }[]
    }) => {
      const rendered: ReactNode[] = []
      Children.forEach(children, (child) => {
        if (!isValidElement(child)) {
          rendered.push(child)
          return
        }
        const props = (child as { props?: { dot?: unknown } }).props
        const dotProp = props?.dot
        if (typeof dotProp === 'function' && Array.isArray(data)) {
          const dots = data.map((d, i) =>
            (
              dotProp as (p: {
                cx?: number
                cy?: number
                payload?: { value: number; recordedAt?: string }
                index?: number
              }) => ReactNode
            )({
              cx: 10 + i * 10,
              cy: 20,
              payload: d,
              index: i,
            })
          )
          rendered.push(...dots)
        }
        rendered.push(child)
      })
      return ce('div', { 'data-recharts': name }, rendered)
    }
  }
  return {
    ResponsiveContainer: passthrough('ResponsiveContainer'),
    LineChart: chartParent('LineChart'),
    AreaChart: chartParent('AreaChart'),
    BarChart: passthrough('BarChart'),
    Line: geometry('Line'),
    Area: geometry('Area'),
    Bar: ({ children }: { children?: ReactNode }) =>
      ce('div', { 'data-recharts': 'Bar' }, children),
    Cell: ({ 'data-extreme': dataExtreme }: { 'data-extreme'?: string }) =>
      ce('div', {
        'data-recharts': 'Cell',
        'data-testid': 'sqcdp-chart-bar-cell',
        'data-extreme': dataExtreme,
      }),
    XAxis: leaf('XAxis'),
    YAxis: leaf('YAxis'),
    CartesianGrid: leaf('CartesianGrid'),
    Tooltip: leaf('Tooltip'),
    ReferenceLine: passthrough('ReferenceLine'),
    Label: leaf('Label'),
  }
})

function buildMetric(overrides: Partial<SqcdpMetricRow> = {}): SqcdpMetricRow {
  return {
    id: 'm-1',
    organizationId: 'org-1',
    category: 'safety',
    displayOrder: 0,
    title: 'Recordable Incidents',
    subtitle: null,
    valueFormat: 'number',
    currentValue: 4,
    targetValue: 0,
    unit: null,
    trendPeriod: 'last_6_months',
    colorHex: '#10b981',
    accentHex: null,
    chartType: 'area',
    showMarkers: false,
    isVisible: true,
    notes: null,
    styleConfig: {},
    subMetrics: [],
    valuePrefix: null,
    valueSuffix: null,
    decimalPlaces: null,
    lowerIsBetter: false,
    showTrend: true,
    chartConfig: {},
    autoValueConfig: {},
    history: [
      { recordedAt: '2026-04-01T00:00:00Z', value: 1 },
      { recordedAt: '2026-04-15T00:00:00Z', value: 3 },
      { recordedAt: '2026-05-01T00:00:00Z', value: 4 },
    ],
    lastDataAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

describe('<SqcdpChart>', () => {
  it('renders a Recharts AreaChart for chart_type=area', () => {
    render(<SqcdpChart metric={buildMetric({ chartType: 'area' })} />)
    expect(document.querySelector('[data-recharts="AreaChart"]')).not.toBeNull()
    expect(document.querySelector('[data-recharts="Area"]')).not.toBeNull()
    expect(
      screen.getByTestId('sqcdp-chart').getAttribute('data-chart-type')
    ).toBe('area')
  })

  it('renders a Recharts LineChart for chart_type=line', () => {
    render(<SqcdpChart metric={buildMetric({ chartType: 'line' })} />)
    expect(document.querySelector('[data-recharts="LineChart"]')).not.toBeNull()
    expect(document.querySelector('[data-recharts="Line"]')).not.toBeNull()
    expect(
      screen.getByTestId('sqcdp-chart').getAttribute('data-chart-type')
    ).toBe('line')
  })

  it('renders a Recharts BarChart for chart_type=bar', () => {
    render(<SqcdpChart metric={buildMetric({ chartType: 'bar' })} />)
    expect(document.querySelector('[data-recharts="BarChart"]')).not.toBeNull()
    expect(document.querySelector('[data-recharts="Bar"]')).not.toBeNull()
    expect(
      screen.getByTestId('sqcdp-chart').getAttribute('data-chart-type')
    ).toBe('bar')
  })

  it('renders the dashed-line empty state when history has fewer than 2 points', () => {
    render(<SqcdpChart metric={buildMetric({ history: [] })} />)
    expect(
      screen.getByText(/History will appear here once values are updated/i)
    ).toBeDefined()
    expect(document.querySelector('[data-recharts="AreaChart"]')).toBeNull()
    expect(document.querySelector('[data-recharts="LineChart"]')).toBeNull()
    expect(document.querySelector('[data-recharts="BarChart"]')).toBeNull()
  })

  it('renders a target reference line when target_value is set', () => {
    render(<SqcdpChart metric={buildMetric({ targetValue: 2 })} />)
    expect(
      document.querySelector('[data-recharts="ReferenceLine"]')
    ).not.toBeNull()
  })

  it('omits the target reference line when target_value is null', () => {
    render(<SqcdpChart metric={buildMetric({ targetValue: null })} />)
    expect(document.querySelector('[data-recharts="ReferenceLine"]')).toBeNull()
  })

  it('renders dot markers when show_markers is true (line variant)', () => {
    render(
      <SqcdpChart
        metric={buildMetric({ chartType: 'line', showMarkers: true })}
      />
    )
    expect(
      screen.getByTestId('sqcdp-chart').getAttribute('data-show-markers')
    ).toBe('true')
    const dots = document.querySelectorAll('[data-testid="sqcdp-chart-dot"]')
    expect(dots.length).toBe(3)
  })

  it('renders dot markers when show_markers is true (area variant)', () => {
    render(
      <SqcdpChart
        metric={buildMetric({ chartType: 'area', showMarkers: true })}
      />
    )
    expect(
      screen.getByTestId('sqcdp-chart').getAttribute('data-show-markers')
    ).toBe('true')
    const dots = document.querySelectorAll('[data-testid="sqcdp-chart-dot"]')
    expect(dots.length).toBe(3)
  })

  it('does NOT render dot markers when show_markers is false (default)', () => {
    render(<SqcdpChart metric={buildMetric({ chartType: 'line' })} />)
    expect(
      screen.getByTestId('sqcdp-chart').getAttribute('data-show-markers')
    ).toBe('false')
    expect(
      document.querySelectorAll('[data-testid="sqcdp-chart-dot"]').length
    ).toBe(0)
  })

  it('marks above-target dots with data-above-target=true', () => {
    render(
      <SqcdpChart
        metric={buildMetric({
          chartType: 'line',
          showMarkers: true,
          targetValue: 2,
          // history values: 1, 3, 4 — the latter two are at-or-above 2.
        })}
      />
    )
    const aboveTargetDots = document.querySelectorAll(
      '[data-testid="sqcdp-chart-dot"][data-above-target="true"]'
    )
    expect(aboveTargetDots.length).toBe(2)
  })

  it('uses overrideHistory when provided (editor live preview path)', () => {
    render(
      <SqcdpChart
        metric={buildMetric({ chartType: 'line', showMarkers: true })}
        overrideHistory={[
          { recordedAt: '2026-05-01T00:00:00Z', value: 10 },
          { recordedAt: '2026-05-02T00:00:00Z', value: 20 },
        ]}
      />
    )
    const dots = document.querySelectorAll('[data-testid="sqcdp-chart-dot"]')
    expect(dots.length).toBe(2)
  })

  // v13 — chart_config goal lines, average, extremes.
  it('renders an additional ReferenceLine for each goal_line (v13)', () => {
    render(
      <SqcdpChart
        metric={buildMetric({
          chartType: 'line',
          targetValue: null,
          chartConfig: {
            goal_lines: [
              { id: 'g1', value: 5, label: 'Stretch goal' },
              { id: 'g2', value: 1, label: 'Floor', style: 'dotted' },
            ],
          },
        })}
      />
    )
    const goalLines = document.querySelectorAll(
      '[data-testid="sqcdp-chart-goal-line"]'
    )
    expect(goalLines.length).toBe(2)
  })

  it('renders the average reference line + extremes caption when toggled (v13)', () => {
    render(
      <SqcdpChart
        metric={buildMetric({
          chartType: 'line',
          chartConfig: { show_average: true, highlight_extremes: true },
        })}
      />
    )
    expect(
      document.querySelector('[data-testid="sqcdp-chart-average-line"]')
    ).not.toBeNull()
    const caption = screen.getByTestId('sqcdp-chart-extremes-caption')
    expect(caption.textContent).toMatch(/MAX/)
    expect(caption.textContent).toMatch(/MIN/)
    expect(
      screen.getByTestId('sqcdp-chart').getAttribute('data-highlight-extremes')
    ).toBe('true')
  })

  it('marks the min/max bar Cells when highlight_extremes is on (bar variant)', () => {
    render(
      <SqcdpChart
        metric={buildMetric({
          chartType: 'bar',
          chartConfig: { highlight_extremes: true },
        })}
      />
    )
    const extremeCells = document.querySelectorAll(
      '[data-testid="sqcdp-chart-bar-cell"]:not([data-extreme="none"])'
    )
    // history values = 1, 3, 4 → min cell + max cell = 2 extreme cells
    expect(extremeCells.length).toBe(2)
  })
})

// Created and developed by Jai Singh
