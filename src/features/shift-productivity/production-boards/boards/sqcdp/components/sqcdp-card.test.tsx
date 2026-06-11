// Created and developed by Jai Singh
/**
 * Smoke tests for <SqcdpCard>. v12 introduced the stacked sub-metric
 * layout — when `metric.subMetrics.length >= 1` the card swaps from the
 * single-value layout to a stack of sub-metric blocks.
 *
 * We mock the chart, the URL-state hooks, and the can-edit-boards hook
 * so the card renders cleanly in jsdom without a query client or a
 * URL-state provider.
 */
import * as React from 'react'
import { type ReactNode } from 'react'
/**
 * Hook-level structural tests. jsdom doesn't compute layout, so the
 * end-to-end "right px in a real browser" check lives in the visual
 * QA matrix. Here we mock `clientWidth` + `getBoundingClientRect` to
 * verify the compute pipeline picks the right tier-wide size from
 * the snuggest entry.
 */
import { act } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SqcdpMetricRow } from '../hooks/use-sqcdp-metrics'
import {
  DEFAULT_UNIFORM_HERO_FIT_OPTIONS,
  useUniformHeroFit,
} from '../hooks/use-uniform-hero-fit'
import { SqcdpHeroFitProvider } from './sqcdp-hero-fit-provider'

vi.mock('../../../hooks/use-board-edit-mode', () => ({
  useBoardEditMode: () => [false, () => {}],
}))
vi.mock('../../../hooks/use-can-edit-boards', () => ({
  useCanEditBoards: () => ({ canEdit: false }),
}))
vi.mock('./sqcdp-chart', () => ({
  SqcdpChart: () => null as unknown as ReactNode,
}))

const { SqcdpCard } = await import('./sqcdp-card')

function buildMetric(overrides: Partial<SqcdpMetricRow> = {}): SqcdpMetricRow {
  return {
    id: 'm-1',
    organizationId: 'org-1',
    category: 'maintenance',
    displayOrder: 0,
    title: 'Maintenance',
    subtitle: null,
    valueFormat: 'number',
    currentValue: 12,
    targetValue: null,
    unit: null,
    trendPeriod: 'rolling_4_weeks',
    colorHex: '#7C3AED',
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
      { recordedAt: '2026-04-01T00:00:00Z', value: 10 },
      { recordedAt: '2026-04-15T00:00:00Z', value: 11 },
      { recordedAt: '2026-05-01T00:00:00Z', value: 12 },
    ],
    lastDataAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

describe('<SqcdpCard> — single-value layout (legacy)', () => {
  it('renders one big-number block when subMetrics is empty', () => {
    render(
      <SqcdpCard category='maintenance' metric={buildMetric()} index={0} />
    )
    const body = screen.getByTestId('sqcdp-card-body')
    expect(body.getAttribute('data-stacked')).toBe('false')
    expect(screen.queryAllByTestId('sqcdp-sub-metric-block')).toHaveLength(0)
    // Big number "12" rendered.
    expect(screen.getByText('12')).toBeDefined()
  })

  it('applies prefix + suffix to the big primary value', () => {
    render(
      <SqcdpCard
        category='cost'
        metric={buildMetric({
          category: 'cost',
          currentValue: 1.234,
          valuePrefix: '$',
          valueSuffix: ' /unit',
          decimalPlaces: 2,
        })}
      />
    )
    expect(screen.getByText('$1.23 /unit')).toBeDefined()
  })

  it('renders the trend indicator when 2+ history points exist', () => {
    render(
      <SqcdpCard
        category='quality'
        metric={buildMetric({ category: 'quality' })}
      />
    )
    const trend = screen.getByTestId('sqcdp-trend-indicator')
    // Last value (12) > previous (11) → trend up.
    expect(trend.getAttribute('data-trend')).toBe('up')
  })

  it('flips trend color polarity when lower_is_better is true', () => {
    render(
      <SqcdpCard
        category='safety'
        metric={buildMetric({ category: 'safety', lowerIsBetter: true })}
      />
    )
    const trend = screen.getByTestId('sqcdp-trend-indicator')
    // ↑ when lower_is_better should paint red. SVG elements expose
    // `className` as `SVGAnimatedString`, so read the literal class
    // attribute instead.
    expect(trend.getAttribute('class') ?? '').toMatch(/text-red-600/)
  })

  it('renders the comparison value (vs N period-label)', () => {
    render(<SqcdpCard category='quality' metric={buildMetric()} />)
    const cmp = screen.getByTestId('sqcdp-comparison-value')
    // "vs 11 last week" — rolling_4_weeks → "last week".
    expect(cmp.textContent).toMatch(/vs/)
    expect(cmp.textContent).toMatch(/11/)
    expect(cmp.textContent).toMatch(/last week/)
  })

  // v12.1 — explicit per-metric opt-out for the trend arrow + comparison
  // subtext. Same history that produced an `up` trend + a comparison
  // subtext in the prior tests should yield neither element when
  // `showTrend === false`.
  it('suppresses BOTH trend arrow and comparison subtext when showTrend is false', () => {
    render(
      <SqcdpCard
        category='quality'
        metric={buildMetric({ category: 'quality', showTrend: false })}
      />
    )
    expect(screen.queryByTestId('sqcdp-trend-indicator')).toBeNull()
    expect(screen.queryByTestId('sqcdp-comparison-value')).toBeNull()
    // Primary number still renders — the toggle only hides the trend
    // affordances, not the headline value.
    expect(screen.getByText('12')).toBeDefined()
  })
})

describe('<SqcdpCard> — v16 auto-counter', () => {
  // The auto-counter compute is bound to `Date.now()` inside the
  // useAutoValueClock hook. We freeze the wall-clock here so the
  // assertions don't drift with calendar time.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 24, 9, 0, 0)) // Sun May 24 2026 09:00 local
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the live-computed value instead of currentValue when auto-counter is on (days)', () => {
    const metric = buildMetric({
      category: 'safety',
      currentValue: 12, // <- ignored when auto-counter is on
      valueSuffix: ' Days',
      autoValueConfig: {
        mode: 'count_up_days',
        anchor_at: new Date(2026, 4, 21, 13, 0, 0).toISOString(),
        // 2026-05-21 → 2026-05-24 with midnight floor = 3 days.
      },
    })
    render(<SqcdpCard category='safety' metric={metric} />)
    expect(screen.getByText('3 Days')).toBeDefined()
    expect(screen.queryByText('12 Days')).toBeNull()
  })

  it('renders hours when mode is count_up_hours', () => {
    const metric = buildMetric({
      autoValueConfig: {
        mode: 'count_up_hours',
        anchor_at: new Date(2026, 4, 24, 6, 30, 0).toISOString(),
        // 06:30 → 09:00 = 2h30m → floor to 2 hours.
      },
      currentValue: 999,
      valueSuffix: ' h',
    })
    render(<SqcdpCard category='maintenance' metric={metric} />)
    expect(screen.getByText('2 h')).toBeDefined()
  })

  it('falls back to currentValue when config is partial / inactive', () => {
    const metric = buildMetric({
      currentValue: 42,
      autoValueConfig: { mode: 'count_up_days' }, // missing anchor_at
    })
    render(<SqcdpCard category='maintenance' metric={metric} />)
    expect(screen.getByText('42')).toBeDefined()
  })
})

describe('<SqcdpCard> — stacked sub-metric layout (v12)', () => {
  it('renders one block per sub-metric and hides the legacy big number', () => {
    const metric = buildMetric({
      subMetrics: [
        {
          id: 'sm-1',
          title: 'Open Work Orders',
          value: 8,
          value_format: 'number',
          subtitle: 'This Month',
        },
        {
          id: 'sm-2',
          title: 'Machine Down',
          value: 6,
          value_format: 'number',
          subtitle: null,
        },
      ],
    })
    render(<SqcdpCard category='maintenance' metric={metric} />)

    const body = screen.getByTestId('sqcdp-card-body')
    expect(body.getAttribute('data-stacked')).toBe('true')

    const blocks = screen.getAllByTestId('sqcdp-sub-metric-block')
    expect(blocks).toHaveLength(2)

    // Each sub-metric's title + value appears in the rendered card.
    expect(screen.getByText('Open Work Orders')).toBeDefined()
    expect(screen.getByText('Machine Down')).toBeDefined()
    expect(screen.getByText('8')).toBeDefined()
    expect(screen.getByText('6')).toBeDefined()

    // Legacy single-mode artefacts are absent.
    expect(screen.queryByTestId('sqcdp-trend-indicator')).toBeNull()
    expect(screen.queryByTestId('sqcdp-comparison-value')).toBeNull()
  })

  it('renders a single sub-metric block when subMetrics has length 1 (Shipping case)', () => {
    const metric = buildMetric({
      category: 'shipping',
      subMetrics: [
        {
          id: 'sm-only',
          title: 'Shipments Today',
          value: 47,
          value_format: 'number',
          subtitle: 'Backed by ASNs',
        },
      ],
    })
    render(<SqcdpCard category='shipping' metric={metric} />)
    const blocks = screen.getAllByTestId('sqcdp-sub-metric-block')
    expect(blocks).toHaveLength(1)
    expect(screen.getByText('47')).toBeDefined()
  })
})

/**
 * v15.2 — TV-only **measured** uniform hero typography. Supersedes
 * the v15.1 `vh`-only recipe (see [[Implement-SQCDP-Measured-Hero-
 * Typography]] + [[ADR-SQCDP-Measured-vs-Viewport-Hero-Typography]]).
 *
 * The v15.1 `vh` clamp picked the SAME px in every card but had no
 * width awareness, so longer values overflowed and shorter ones
 * wrapped. v15.2 measures each value's natural one-line width
 * against the actual card-body width and picks a tier-wide uniform
 * px that fits the snuggest card. Three independent tiers
 * (`primary`, `sub`, `secondarySingle`) so the secondary tier's
 * longer values can't drag the primary tier's size down.
 *
 * jsdom doesn't compute layout, so these tests assert the structural
 * contract (class composition, registry wiring, ref attachment,
 * curator-override gate) rather than the precise computed px. The
 * end-to-end "right px in a real browser" check lives in the visual
 * QA matrix in [[Implement-SQCDP-Measured-Hero-Typography]].
 */
describe('<SqcdpCard> — TV measured hero typography (v15.2)', () => {
  it('applies the measured-hero class chain on the hero in TV density when no size override', () => {
    render(
      <SqcdpCard category='maintenance' metric={buildMetric()} density='tv' />
    )
    const value = screen.getByTestId('sqcdp-primary-value')
    // v15.1's vh clamp is gone — we measure & fit at runtime instead.
    expect(value.className).not.toMatch(/text-\[clamp/)
    // Single-line wrap + clip + leading-0.95 are the v15.2 hero chain.
    expect(value.className).toMatch(/whitespace-nowrap/)
    expect(value.className).toMatch(/overflow-hidden/)
    expect(value.className).toMatch(/leading-\[0\.95\]/)
  })

  it('does NOT apply measured sizing in normal density (in-page rendering unchanged)', () => {
    render(
      <SqcdpCard
        category='maintenance'
        metric={buildMetric()}
        density='normal'
      />
    )
    const value = screen.getByTestId('sqcdp-primary-value')
    expect(value.className).not.toMatch(/whitespace-nowrap/)
    expect(value.className).not.toMatch(/text-\[clamp/)
    expect(value.style.fontSize).toBe('')
  })

  it('defers to a curator size override (measured sizing skipped when primary.size is pinned)', () => {
    render(
      <SqcdpCard
        category='maintenance'
        metric={buildMetric({
          styleConfig: { primary: { size: '7xl' } },
        })}
        density='tv'
      />
    )
    const value = screen.getByTestId('sqcdp-primary-value')
    // Curator's pinned size still wins — measured class chain absent on
    // the inner registered div, inline fontSize not set. The static
    // `text-7xl` survives on the outer styled container (CSS
    // inheritance feeds it down to the rendered value text).
    expect(value.className).not.toMatch(/whitespace-nowrap/)
    expect(value.style.fontSize).toBe('')
    const outer = value.parentElement
    expect(outer?.className ?? '').toMatch(/text-7xl/)
  })

  it('applies the measured-sub class chain on each stacked block in TV density', () => {
    const metric = buildMetric({
      subMetrics: [
        {
          id: 'sm-1',
          title: 'Open Work Orders',
          value: 8,
          value_format: 'number',
          subtitle: null,
        },
        {
          id: 'sm-2',
          title: 'Machine Down',
          value: 6,
          value_format: 'number',
          subtitle: null,
        },
      ],
    })
    render(<SqcdpCard category='maintenance' metric={metric} density='tv' />)
    const blocks = screen.getAllByTestId('sqcdp-sub-metric-block')
    expect(blocks).toHaveLength(2)
    for (const block of blocks) {
      const valueDiv = block.querySelector(
        '[data-testid="sqcdp-sub-metric-value"]'
      ) as HTMLElement | null
      expect(valueDiv).toBeTruthy()
      expect(valueDiv?.className).not.toMatch(/text-\[clamp/)
      expect(valueDiv?.className).toMatch(/whitespace-nowrap/)
      expect(valueDiv?.className).toMatch(/overflow-hidden/)
      // Each block still grows equally inside the stacked-mode wrapper
      // — that's a layout concern (so 1/2/3 stacks distribute evenly)
      // independent of the typography model.
      expect(block.className).toMatch(/flex-1/)
      expect(block.className).toMatch(/min-h-0/)
    }
  })

  it('does NOT apply sub-metric measured sizing in normal density', () => {
    const metric = buildMetric({
      subMetrics: [
        {
          id: 'sm-1',
          title: 'Open Work Orders',
          value: 8,
          value_format: 'number',
          subtitle: null,
        },
      ],
    })
    render(
      <SqcdpCard category='maintenance' metric={metric} density='normal' />
    )
    const block = screen.getByTestId('sqcdp-sub-metric-block')
    const valueDiv = block.querySelector(
      '[data-testid="sqcdp-sub-metric-value"]'
    ) as HTMLElement | null
    expect(valueDiv?.className).not.toMatch(/whitespace-nowrap/)
    expect(valueDiv?.style.fontSize).toBe('')
    expect(block.className).not.toMatch(/\bflex-1\b/)
  })

  it('keeps the trend icon at the density baseline class (no vh-based class) and applies inline size when measured', () => {
    render(
      <SqcdpCard
        category='quality'
        metric={buildMetric({ category: 'quality' })}
        density='tv'
      />
    )
    const trend = screen.getByTestId('sqcdp-trend-indicator')
    const cls = trend.getAttribute('class') ?? ''
    // v15.1's `h-[7vh]` clamp is gone; the density baseline survives.
    expect(cls).not.toMatch(/h-\[7vh\]/)
    expect(cls).toMatch(/h-10/)
    expect(cls).toMatch(/w-10/)
    // No inline size before measurement lands (jsdom doesn't measure).
    expect(trend.getAttribute('style') ?? '').toBe('')
  })
})

interface TestProbeProps {
  enabled: boolean
  tier: 'primary' | 'sub' | 'secondarySingle'
  id: string
  text: string
  containerWidthPx: number
}

function TestProbe({
  enabled,
  tier,
  id,
  text,
  containerWidthPx,
}: TestProbeProps) {
  const fit = useUniformHeroFit({ enabled, tier, id, text })
  const fitRef = fit.ref
  const containerWidthRef = React.useRef(containerWidthPx)
  containerWidthRef.current = containerWidthPx
  const setRef = React.useCallback(
    (el: HTMLDivElement | null): void => {
      if (el) {
        Object.defineProperty(el, 'clientWidth', {
          configurable: true,
          get: () => containerWidthRef.current,
        })
      }
      fitRef(el)
    },
    [fitRef]
  )
  return (
    <div
      ref={setRef}
      data-testid={`probe-${id}`}
      data-overflow={fit.overflow ? 'true' : 'false'}
      style={fit.style}
    >
      {text}
    </div>
  )
}

/**
 * jsdom mocks for ResizeObserver + the measurement element's
 * getBoundingClientRect. The cloned span is appended to body, so we
 * intercept it via a MutationObserver on insert.
 */
function installFitTestMocks(): () => void {
  const originalRO = globalThis.ResizeObserver
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver

  // Patch getBoundingClientRect on the measurement span. The hook
  // creates `<span data-sqcdp-measurer="true">` with a known font-size,
  // measures its width, then removes it. We intercept on insert.
  const originalGet = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement
  ): DOMRect {
    if (this.getAttribute('data-sqcdp-measurer') === 'true') {
      const text = this.textContent ?? ''
      // Approximate: each character at ref-px 100 contributes ~60 px.
      // Tests can override via the probe's `naturalWidthPerCharPx` and
      // a separately wired prop.
      const probePerChar = (
        this as HTMLElement & {
          __perChar?: number
        }
      ).__perChar
      const perChar = probePerChar ?? 60
      return {
        width: text.length * perChar,
        height: 100,
        top: 0,
        left: 0,
        right: text.length * perChar,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect
    }
    return originalGet.call(this)
  }

  return () => {
    HTMLElement.prototype.getBoundingClientRect = originalGet
    if (originalRO) {
      ;(
        globalThis as { ResizeObserver: typeof ResizeObserver }
      ).ResizeObserver = originalRO
    } else {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver })
        .ResizeObserver
    }
  }
}

async function flushFit(ms = 50): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

describe('useUniformHeroFit registry — measured fit pipeline (v15.2)', () => {
  let restoreMocks: () => void
  beforeEach(() => {
    restoreMocks = installFitTestMocks()
  })
  afterEach(() => {
    restoreMocks()
  })

  it('picks the largest font that fits the snuggest entry, uniform across the tier', async () => {
    // Two primary entries: one with a long value and a tight card,
    // one with a short value and a roomy card. Tier size = min(maxFit)
    // = the long/tight entry's max-fit. Both entries should render
    // with the SAME computed px.
    //
    // Computation at ref 100 px:
    //   - "99.7%" (5 chars) → natural 300 px
    //     containerWidth = 320 - 16 = 304 → maxFit = (304/300) * 100 ≈ 101 px
    //   - "475" (3 chars) → natural 180 px
    //     containerWidth = 360 - 16 = 344 → maxFit = (344/180) * 100 ≈ 191 px
    //   tier minFit = 101 px → clamped by viewport ceiling (768 * 0.11
    //     = 84 px) → ceiling wins for jsdom's 768 height → 84 px → floor
    //     min check → 84 > 56 floor → keep → round to 4 → 84 px.
    render(
      <SqcdpHeroFitProvider enabled>
        <TestProbe
          enabled
          tier='primary'
          id='delivery'
          text='99.7%'
          containerWidthPx={320}
        />
        <TestProbe
          enabled
          tier='primary'
          id='production'
          text='475'
          containerWidthPx={360}
        />
      </SqcdpHeroFitProvider>
    )

    await flushFit()
    const delivery = screen.getByTestId('probe-delivery')
    const production = screen.getByTestId('probe-production')
    expect(delivery.style.fontSize).toBe(production.style.fontSize)
    expect(delivery.style.fontSize).not.toBe('')
  })

  it('produces distinct sizes per tier (primary vs sub vs secondarySingle)', async () => {
    render(
      <SqcdpHeroFitProvider enabled>
        <TestProbe
          enabled
          tier='primary'
          id='p1'
          text='475'
          containerWidthPx={400}
        />
        <TestProbe
          enabled
          tier='sub'
          id='s1'
          text='12'
          containerWidthPx={400}
        />
        <TestProbe
          enabled
          tier='secondarySingle'
          id='ss1'
          text='500 Orders'
          containerWidthPx={400}
        />
      </SqcdpHeroFitProvider>
    )
    await flushFit()
    const primary = screen.getByTestId('probe-p1').style.fontSize
    const sub = screen.getByTestId('probe-s1').style.fontSize
    const secondary = screen.getByTestId('probe-ss1').style.fontSize
    expect(primary).not.toBe('')
    expect(sub).not.toBe('')
    expect(secondary).not.toBe('')
    // Sub-tier ceiling is 6vh vs primary's 11vh → distinct px.
    expect(primary).not.toBe(sub)
  })

  it('skips registration entirely when enabled is false (curator override path)', async () => {
    render(
      <SqcdpHeroFitProvider enabled>
        <TestProbe
          enabled={false}
          tier='primary'
          id='pinned'
          text='99.7%'
          containerWidthPx={320}
        />
      </SqcdpHeroFitProvider>
    )
    await flushFit()
    const probe = screen.getByTestId('probe-pinned')
    expect(probe.style.fontSize).toBe('')
  })

  it('re-runs the fit after a window resize event (debounced)', async () => {
    render(
      <SqcdpHeroFitProvider enabled>
        <TestProbe
          enabled
          tier='primary'
          id='p1'
          text='475'
          containerWidthPx={400}
        />
      </SqcdpHeroFitProvider>
    )
    await flushFit()
    const probe = screen.getByTestId('probe-p1')
    const before = probe.style.fontSize
    // Shrink the viewport — the per-tier ceiling drops, so the chosen
    // size should track down. window.innerHeight is read inside the
    // compute pass.
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      get: () => 400,
    })
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    await flushFit(200) // 100 ms debounce + RAF + buffer
    const after = probe.style.fontSize
    expect(after).not.toBe('')
    expect(after).not.toBe(before)
  })

  it('exposes a default tuning constant with sensible per-tier values', () => {
    expect(DEFAULT_UNIFORM_HERO_FIT_OPTIONS.floorPx.primary).toBeGreaterThan(0)
    expect(
      DEFAULT_UNIFORM_HERO_FIT_OPTIONS.viewportCeilingVh.primary
    ).toBeGreaterThan(0)
    expect(DEFAULT_UNIFORM_HERO_FIT_OPTIONS.initialPx.primary).toBeGreaterThan(
      0
    )
    expect(DEFAULT_UNIFORM_HERO_FIT_OPTIONS.inlineSafetyPx).toBeGreaterThan(0)
    expect(DEFAULT_UNIFORM_HERO_FIT_OPTIONS.resizeDebounceMs).toBeGreaterThan(0)
  })

  /*
   * v15.2.1 regression — sole-survivor demote. Two secondary-single
   * entries both have `maxFit < floor` (long values, narrow cards).
   * Before this fix, the demote loop's `working.length > 1` guard
   * meant only the SNUGGEST entry was added to the overflow set; the
   * second entry was left as a sole survivor that picked the floor as
   * its chosen size and rendered single-line at a size its width
   * couldn't actually hold — visible as "500 Orders Shipp" clipping
   * on the user's 2026-05-18 TV screenshot. After the fix BOTH
   * entries land in overflow set and render with `whitespace-normal`
   * + `line-clamp-2`. See `Sessions/2026-05-17.md` § "Fix: v15.2
   * hero-fit overflow on secondary single-mode cards".
   *
   * Probe natural-width mock: 60 px/char at ref 100 px. Card width
   * 220 px → available = 220 - 16 = 204 px.
   *  - "500 Orders Shipped" (18 chars) → naturalRef = 1080 px →
   *    maxFit = 204/1080 * 100 ≈ 18.9 px (well below 48 px floor).
   *  - "73 DAYS FOR PHYSICAL" (20 chars) → naturalRef = 1200 px →
   *    maxFit = 204/1200 * 100 = 17 px (also below floor).
   * Both below floor ⇒ both should be in overflow set after the fix.
   */
  it('demotes BOTH entries to overflow when the secondary tier has 2 unfittable values', async () => {
    render(
      <SqcdpHeroFitProvider enabled>
        <TestProbe
          enabled
          tier='secondarySingle'
          id='shipping'
          text='500 Orders Shipped'
          containerWidthPx={220}
        />
        <TestProbe
          enabled
          tier='secondarySingle'
          id='announcement'
          text='73 DAYS FOR PHYSICAL'
          containerWidthPx={220}
        />
      </SqcdpHeroFitProvider>
    )
    await flushFit()
    const shipping = screen.getByTestId('probe-shipping')
    const announcement = screen.getByTestId('probe-announcement')
    expect(shipping.dataset.overflow).toBe('true')
    expect(announcement.dataset.overflow).toBe('true')
    // Both at the same tier size — measured-fit guarantees uniformity
    // even when both entries are in the overflow set.
    expect(shipping.style.fontSize).toBe(announcement.style.fontSize)
    expect(shipping.style.fontSize).not.toBe('')
  })

  it('still demotes the sole entry when only one secondary-single card has a value too long for its width', async () => {
    // Single-entry tier with maxFit below floor: must still flip to
    // overflow so the card wraps instead of clipping single-line.
    render(
      <SqcdpHeroFitProvider enabled>
        <TestProbe
          enabled
          tier='secondarySingle'
          id='shipping'
          text='500 Orders Shipped'
          containerWidthPx={220}
        />
      </SqcdpHeroFitProvider>
    )
    await flushFit()
    const shipping = screen.getByTestId('probe-shipping')
    expect(shipping.dataset.overflow).toBe('true')
    // Chosen size lands on the tier floor (the only candidate left
    // once the entry can't fit one-line) — `whitespace-normal` +
    // `line-clamp-2` from the OVERFLOW class chain on the card then
    // wraps the value to ≤ 2 lines at that floor size.
    expect(shipping.style.fontSize).toBe(
      `${DEFAULT_UNIFORM_HERO_FIT_OPTIONS.floorPx.secondarySingle}px`
    )
  })

  it('keeps a fittable entry out of overflow even when the snuggest sibling gets demoted', async () => {
    // Mixed case: one entry fits at >= floor (survivor), one doesn't
    // (demoted). Survivor MUST stay in nowrap mode so the size still
    // tracks the snuggest survivor — adding the survivor to overflow
    // when it doesn't need to be there would needlessly wrap a value
    // that fits perfectly fine.
    //
    // "475" (3 chars, 180 px naturalRef) at containerWidthPx 800 →
    // available 784 → maxFit ≈ 435 px (clamped by ceiling but well
    // above floor). "73 DAYS FOR PHYSICAL" (20 chars, 1200 px) at
    // containerWidthPx 220 → maxFit ≈ 17 px (below floor → demote).
    render(
      <SqcdpHeroFitProvider enabled>
        <TestProbe
          enabled
          tier='secondarySingle'
          id='survivor'
          text='475'
          containerWidthPx={800}
        />
        <TestProbe
          enabled
          tier='secondarySingle'
          id='demoted'
          text='73 DAYS FOR PHYSICAL'
          containerWidthPx={220}
        />
      </SqcdpHeroFitProvider>
    )
    await flushFit()
    const survivor = screen.getByTestId('probe-survivor')
    const demoted = screen.getByTestId('probe-demoted')
    expect(survivor.dataset.overflow).toBe('false')
    expect(demoted.dataset.overflow).toBe('true')
    // Tier size is uniform across survivors + demoted (the demoted
    // entry wraps at the chosen size).
    expect(survivor.style.fontSize).toBe(demoted.style.fontSize)
  })
})

describe('<SqcdpGrid> — every primary hero registers with the same tier (v15.2)', () => {
  it('every primary card exposes the measured-hero class chain', async () => {
    const { SqcdpGrid } = await import('./sqcdp-grid')
    const { BUILTIN_CATEGORIES } = await import('../lib/categories')

    const primary = BUILTIN_CATEGORIES.filter((c) => c.tier === 'primary')

    const metricFor = (
      slug: string,
      value: number,
      subtitle: string | null
    ): SqcdpMetricRow =>
      buildMetric({
        id: `m-${slug}`,
        category: slug,
        currentValue: value,
        subtitle,
      })

    const metrics = [
      metricFor('safety', 848, '848 Days'),
      metricFor('quality', 35, '35 QNs'),
      metricFor('cost', 8, '8 % OT'),
      metricFor('delivery', 99.7, '99.7%'),
      metricFor('production', 475, null),
    ]

    render(
      <SqcdpHeroFitProvider enabled>
        <SqcdpGrid
          metrics={metrics}
          density='tv'
          categoriesOverride={primary}
        />
      </SqcdpHeroFitProvider>
    )

    const heroes = document.querySelectorAll(
      '[data-testid="sqcdp-primary-value"]'
    )
    expect(heroes.length).toBe(primary.length)
    for (const hero of Array.from(heroes)) {
      const cls = hero.className
      expect(cls).toMatch(/whitespace-nowrap/)
      expect(cls).toMatch(/overflow-hidden/)
    }
  })
})

// Created and developed by Jai Singh
