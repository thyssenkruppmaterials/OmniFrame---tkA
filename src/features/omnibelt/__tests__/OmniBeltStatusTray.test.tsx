// Created and developed by Jai Singh
/**
 * OmniBeltStatusTray — auto-expand-for-4s on new own-job, click-to-
 * dismiss, behaviour-matrix gating.
 *
 * Mocks `useOmnibeltJobs` (the WS-driven aggregator) so the test
 * controls only the *rendering* surface. The store is mocked via
 * `useOmnibeltStore` selector overrides so the test can flip
 * `mach3Behavior` between cases without booting persist middleware.
 */
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'
import type { ActiveJob, Mach3Behavior } from '../store/omnibeltStore'

// ---- Mocks ---------------------------------------------------------------

vi.mock('../store/omnibeltStore', async () => {
  const actual = await vi.importActual<typeof import('../store/omnibeltStore')>(
    '../store/omnibeltStore'
  )
  return {
    ...actual,
    useOmnibeltStore: vi.fn(),
    getOmnibeltStore: vi.fn(),
  }
})

vi.mock('../hooks/useOmnibeltJobs', () => ({
  useOmnibeltJobs: () => ({ activeJobs: [], cancelJob: vi.fn() }),
}))

const { useOmnibeltStore, getOmnibeltStore } =
  await import('../store/omnibeltStore')
const { OmniBeltStatusTray, AUTOEXPAND_HOLD_MS, __test__ } =
  await import('../tray/OmniBeltStatusTray')

// ---- Helpers --------------------------------------------------------------

const setTrayOpen = vi.fn()

type StoreShape = {
  activeJobs: ActiveJob[]
  trayOpen: boolean
  mach3Behavior: Mach3Behavior
  setTrayOpen: typeof setTrayOpen
  positionByRoute: Record<string, { anchor: string } | undefined>
}

function makeJob(overrides: Partial<ActiveJob> = {}): ActiveJob {
  return {
    id: 'j-1',
    type: 'sap_import',
    label: 'Importing LX03',
    progress: 0.42,
    startedAt: Date.now(),
    startedByCurrentUser: true,
    cancelable: false,
    ...overrides,
  }
}

function applyStoreState(initial: Partial<StoreShape> = {}) {
  const bag: StoreShape = {
    activeJobs: [],
    trayOpen: false,
    mach3Behavior: 'halo_plus_autoexpand',
    setTrayOpen,
    positionByRoute: {},
    ...initial,
  }
  ;(useOmnibeltStore as unknown as Mock).mockImplementation(
    (selector: (s: StoreShape) => unknown) => selector(bag)
  )
  ;(getOmnibeltStore as unknown as Mock).mockImplementation(() => ({
    getState: () => bag,
  }))
  return bag
}

beforeEach(() => {
  vi.clearAllMocks()
  setTrayOpen.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

// ---- Tests ---------------------------------------------------------------

describe('OmniBeltStatusTray — visibility gate', () => {
  it('renders nothing when no active jobs', () => {
    applyStoreState({ activeJobs: [], trayOpen: true })
    const { container } = render(<OmniBeltStatusTray />)
    expect(
      container.querySelector('[data-testid="omnibelt-status-tray"]')
    ).toBeNull()
  })

  it('renders nothing when trayOpen=false', () => {
    applyStoreState({ activeJobs: [makeJob()], trayOpen: false })
    const { container } = render(<OmniBeltStatusTray />)
    expect(
      container.querySelector('[data-testid="omnibelt-status-tray"]')
    ).toBeNull()
  })

  it('renders one row per active job when both gates pass', () => {
    applyStoreState({
      activeJobs: [
        makeJob({ id: 'a' }),
        makeJob({ id: 'b', type: 'sap_export', label: 'Confirming TO' }),
      ],
      trayOpen: true,
    })
    render(<OmniBeltStatusTray />)
    expect(screen.getByTestId('omnibelt-status-tray')).toBeInTheDocument()
    expect(screen.getByTestId('omnibelt-job-row-a')).toBeInTheDocument()
    expect(screen.getByTestId('omnibelt-job-row-b')).toBeInTheDocument()
  })
})

describe('OmniBeltStatusTray — halo_plus_autoexpand (default)', () => {
  it('opens the tray when a new own-job appears, then auto-collapses after 4s', () => {
    vi.useFakeTimers()

    // Initial render — no jobs.
    const bag = applyStoreState({
      activeJobs: [],
      trayOpen: false,
      mach3Behavior: 'halo_plus_autoexpand',
    })
    const { rerender } = render(<OmniBeltStatusTray />)
    expect(setTrayOpen).not.toHaveBeenCalled()

    // New own-job appears.
    bag.activeJobs = [makeJob({ id: 'j-1', startedByCurrentUser: true })]
    rerender(<OmniBeltStatusTray />)
    expect(setTrayOpen).toHaveBeenCalledWith(true)

    // Advance just before the 4s deadline — no collapse yet.
    setTrayOpen.mockClear()
    act(() => {
      vi.advanceTimersByTime(AUTOEXPAND_HOLD_MS - 100)
    })
    expect(setTrayOpen).not.toHaveBeenCalled()

    // Cross the 4s boundary — auto-collapse.
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(setTrayOpen).toHaveBeenCalledWith(false)
  })

  it('does NOT auto-expand for jobs started by other users', () => {
    vi.useFakeTimers()
    const bag = applyStoreState({
      activeJobs: [],
      mach3Behavior: 'halo_plus_autoexpand',
    })
    const { rerender } = render(<OmniBeltStatusTray />)

    bag.activeJobs = [makeJob({ id: 'j-2', startedByCurrentUser: false })]
    rerender(<OmniBeltStatusTray />)
    expect(setTrayOpen).not.toHaveBeenCalled()
  })

  it('does not re-fire auto-expand on subsequent re-renders for the same own-job', () => {
    vi.useFakeTimers()
    const bag = applyStoreState({
      activeJobs: [],
      mach3Behavior: 'halo_plus_autoexpand',
    })
    const { rerender } = render(<OmniBeltStatusTray />)

    const job = makeJob({ id: 'j-3' })
    bag.activeJobs = [job]
    rerender(<OmniBeltStatusTray />)
    expect(setTrayOpen).toHaveBeenCalledTimes(1)

    // Same job's progress ticks — must not re-trigger setTrayOpen(true).
    setTrayOpen.mockClear()
    bag.activeJobs = [{ ...job, progress: 0.6 }]
    rerender(<OmniBeltStatusTray />)
    expect(setTrayOpen).not.toHaveBeenCalled()
  })
})

describe('OmniBeltStatusTray — halo_only', () => {
  it('never auto-expands the tray, even on a new own-job', () => {
    vi.useFakeTimers()
    const bag = applyStoreState({
      activeJobs: [],
      mach3Behavior: 'halo_only',
    })
    const { rerender } = render(<OmniBeltStatusTray />)

    bag.activeJobs = [makeJob({ id: 'j-4', startedByCurrentUser: true })]
    rerender(<OmniBeltStatusTray />)
    expect(setTrayOpen).not.toHaveBeenCalled()
  })
})

describe('OmniBeltStatusTray — halo_plus_tray_pinned', () => {
  it('pins the tray open while jobs are active', () => {
    const bag = applyStoreState({
      activeJobs: [makeJob({ id: 'j-5' })],
      trayOpen: false,
      mach3Behavior: 'halo_plus_tray_pinned',
    })
    render(<OmniBeltStatusTray />)
    expect(setTrayOpen).toHaveBeenCalledWith(true)

    setTrayOpen.mockClear()
    bag.activeJobs = []
    bag.trayOpen = true
    // Render again with no jobs — should auto-collapse.
    const { rerender } = render(<OmniBeltStatusTray />)
    rerender(<OmniBeltStatusTray />)
    expect(setTrayOpen).toHaveBeenCalledWith(false)
  })
})

describe('OmniBeltStatusTray — manual dismiss', () => {
  it('dismiss button calls setTrayOpen(false)', () => {
    applyStoreState({
      activeJobs: [makeJob()],
      trayOpen: true,
      mach3Behavior: 'halo_plus_autoexpand',
    })
    render(<OmniBeltStatusTray />)
    fireEvent.click(screen.getByTestId('omnibelt-status-tray-dismiss'))
    expect(setTrayOpen).toHaveBeenCalledWith(false)
  })
})

describe('inferSide heuristic', () => {
  it('defaults to bottom when no anchors stored', () => {
    const { inferSide } = __test__
    expect(inferSide({})).toBe('bottom')
  })

  it('returns top when any anchor is on the top edge', () => {
    const { inferSide } = __test__
    expect(inferSide({ '/foo': { anchor: 'TR' } })).toBe('top')
    expect(inferSide({ '/foo': { anchor: 'NUB_T' } })).toBe('top')
  })

  it('returns bottom when only middle/bottom anchors are set', () => {
    const { inferSide } = __test__
    expect(inferSide({ '/foo': { anchor: 'MR' } })).toBe('bottom')
    expect(inferSide({ '/foo': { anchor: 'BR' } })).toBe('bottom')
  })
})

// Created and developed by Jai Singh
