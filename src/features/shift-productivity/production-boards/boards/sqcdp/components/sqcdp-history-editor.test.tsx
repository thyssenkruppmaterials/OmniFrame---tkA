// Created and developed by Jai Singh
/**
 * Smoke tests for <SqcdpHistoryEditor>. We don't drive the date-picker
 * here (Radix Popover + day-picker is a black box from this layer's
 * point of view); we just assert the empty state copy, the toolbar
 * buttons appear, and the "save first" placeholder renders for the
 * create-mode (no metric) case.
 */
import { type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SqcdpMetricRow } from '../hooks/use-sqcdp-metrics'

vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: () => ({
    authState: { profile: { organization_id: 'org-test' } },
  }),
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                gte() {
                  return {
                    order() {
                      return Promise.resolve({ data: [], error: null })
                    },
                  }
                },
              }
            },
          }
        },
      }
    },
  },
}))

const { SqcdpHistoryEditor } = await import('./sqcdp-history-editor')

function buildMetric(): SqcdpMetricRow {
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
    history: [],
    lastDataAt: null,
    updatedAt: '2026-05-01T00:00:00Z',
  }
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('<SqcdpHistoryEditor>', () => {
  it('renders the "save first" placeholder when no metric is provided', () => {
    const Wrapper = makeWrapper()
    render(<SqcdpHistoryEditor metric={null} />, { wrapper: Wrapper })
    expect(
      screen.getByText(/Save the metric first to start recording history/i)
    ).toBeDefined()
  })

  it('renders the empty state copy + toolbar buttons when history is empty', async () => {
    const Wrapper = makeWrapper()
    render(<SqcdpHistoryEditor metric={buildMetric()} />, {
      wrapper: Wrapper,
    })
    expect(screen.getByText(/Historical data points/i)).toBeDefined()
    // Toolbar — both Add and Generate buttons render when empty.
    expect(
      screen.getByRole('button', { name: /Add data point/i })
    ).toBeDefined()
    expect(
      screen.getByRole('button', { name: /Generate sample data/i })
    ).toBeDefined()
    // Empty state copy renders inside the table body. The query starts
    // in `isLoading=true`, then resolves to an empty array; either of
    // those two messages can be in the document at first paint.
    const emptyCopyMatch = await screen.findByText(
      /No history recorded yet|Loading history/i
    )
    expect(emptyCopyMatch).toBeDefined()
  })
})

// Created and developed by Jai Singh
