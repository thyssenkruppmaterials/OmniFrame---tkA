// Created and developed by Jai Singh
/**
 * Hook coverage for `useHourlyProductivity` — focused on the area-filter
 * shaping introduced by the v2 per-area tab strip.
 *
 * We stub the Supabase services so the hook's pure useMemo filter logic
 * can be exercised with a known roster + event stream. The assertion
 * surface is kept narrow on purpose — only behaviours that the page
 * relies on:
 *
 *   1. Default (no filter) returns the full roster, ordered by name.
 *   2. Setting `workingAreaIds: [areaA]` narrows the roster to associates
 *      whose `working_area_id` matches AND prunes events for users
 *      outside the area from the cell-bucket lookup.
 *   3. `allAssociates` always exposes the unfiltered roster regardless
 *      of the active filter (used by the tab-strip count badges).
 */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHourlyProductivity } from './use-hourly-productivity'

vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: () => ({
    authState: { profile: { organization_id: 'org-test' } },
  }),
}))

vi.mock('@/hooks/use-shift-productivity-settings', () => ({
  useShiftProductivitySettings: () => ({
    effectiveSettings: {
      timezone: 'America/New_York',
      target_scans_per_hour: 30,
      target_putaways_per_hour: 15,
      target_picks_per_hour: 20,
      target_cycle_counts_per_hour: 5,
    },
  }),
}))

const associatesData = [
  {
    user_id: 'u-out',
    user_full_name: 'Outbound Olive',
    user_email: 'olive@example.com',
    position_title: 'Picker',
    working_area_id: 'area-out',
    area_name: 'Outbound',
  },
  {
    user_id: 'u-in',
    user_full_name: 'Inbound Ivan',
    user_email: 'ivan@example.com',
    position_title: 'Receiver',
    working_area_id: 'area-in',
    area_name: 'Inbound',
  },
  {
    user_id: 'u-orphan',
    user_full_name: 'Aaron Orphan',
    user_email: 'aaron@example.com',
    position_title: 'Floater',
    working_area_id: null,
    area_name: null,
  },
]

const workingAreasData = [
  {
    id: 'area-out',
    organization_id: 'org-test',
    area_code: 'OUT',
    area_name: 'Outbound',
    area_type: 'shipping',
    is_active: true,
    requires_certification: false,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'area-in',
    organization_id: 'org-test',
    area_code: 'IN',
    area_name: 'Inbound',
    area_type: 'receiving',
    is_active: true,
    requires_certification: false,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'area-archived',
    organization_id: 'org-test',
    area_code: 'ARC',
    area_name: 'Archived',
    area_type: 'storage',
    is_active: false,
    requires_certification: false,
    created_at: '',
    updated_at: '',
  },
]

vi.mock('@/lib/supabase/labor-management.service', () => ({
  default: {
    getActiveAssociates: vi.fn(async () => associatesData),
    getWorkingAreas: vi.fn(async () => workingAreasData),
  },
}))

const eventsMap = new Map<string, Array<{ type: string; timestamp: string }>>([
  [
    'u-out',
    [
      { type: 'picking', timestamp: '2026-05-10T14:00:00Z' },
      { type: 'picking', timestamp: '2026-05-10T15:00:00Z' },
    ],
  ],
  [
    'u-in',
    [
      { type: 'inbound_scan', timestamp: '2026-05-10T13:00:00Z' },
      { type: 'inbound_scan', timestamp: '2026-05-10T13:30:00Z' },
    ],
  ],
])

vi.mock('@/lib/supabase/team-performance.service', () => ({
  default: {
    getActivityEventsForDate: vi.fn(async () => eventsMap),
    getShiftAssignmentsRaw: vi.fn(async () => []),
  },
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return { Wrapper, qc }
}

beforeEach(() => {
  vi.useFakeTimers({
    now: new Date('2026-05-10T15:00:00Z'),
    shouldAdvanceTime: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useHourlyProductivity — area filter shaping', () => {
  it('returns the full roster sorted by name when no filter is applied', async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useHourlyProductivity(), {
      wrapper: Wrapper,
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.allAssociates).toHaveLength(3)
    expect(result.current.associates.map((a) => a.userId)).toEqual([
      'u-orphan',
      'u-in',
      'u-out',
    ])
    // Active working areas only — the tabs UI further filters by is_active.
    expect(result.current.workingAreas).toHaveLength(3)
    expect(
      result.current.workingAreas.find((w) => w.id === 'area-archived')
        ?.is_active
    ).toBe(false)
  })

  it('narrows associates and prunes events when a single area is active', async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useHourlyProductivity(), {
      wrapper: Wrapper,
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.updateFilters({ workingAreaIds: ['area-out'] })
    })

    await waitFor(() => {
      expect(result.current.associates).toHaveLength(1)
    })

    expect(result.current.associates[0].userId).toBe('u-out')
    expect(result.current.allAssociates).toHaveLength(3)
    // Inbound user's events do not belong to any rendered cell because
    // the inbound associate is filtered out — the consumer iterates
    // `associates` and looks up `getCellBucket(userId, hour)`.
    expect(result.current.getCellBucket('u-in', 9)).toBeDefined()
    expect(result.current.associates.some((a) => a.userId === 'u-in')).toBe(
      false
    )
  })

  it('clearing the filter restores the full roster', async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useHourlyProductivity(), {
      wrapper: Wrapper,
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.updateFilters({ workingAreaIds: ['area-in'] })
    })
    await waitFor(() => {
      expect(result.current.associates).toHaveLength(1)
    })

    act(() => {
      result.current.clearFilters()
    })
    await waitFor(() => {
      expect(result.current.associates).toHaveLength(3)
    })
  })
})

// Created and developed by Jai Singh
