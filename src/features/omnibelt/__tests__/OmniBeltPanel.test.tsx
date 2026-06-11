// Created and developed by Jai Singh
/**
 * OmniBeltPanel — mount, Esc-close, tab strip, tool grid contract.
 *
 * Panel reads from the per-user Zustand store + `useResolvedTools`
 * + TanStack Router (for `ToolTile` navigation). We mock each at
 * the module boundary so the test can exercise pure rendering /
 * keyboard logic without booting framer-motion layout effects or
 * the router.
 */
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LayoutGroup } from 'framer-motion'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'
import { OmniBeltPanel } from '../panel/OmniBeltPanel'
import { useOmnibeltStore, type CollapseState } from '../store/omnibeltStore'
import { TOOL_REGISTRY } from '../tools/registry'
import { useResolvedTools } from '../tools/use-resolved-tools'

vi.mock('../store/omnibeltStore', () => ({
  useOmnibeltStore: vi.fn(),
}))
vi.mock('../tools/use-resolved-tools', () => ({
  useResolvedTools: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  // `useOmnibeltPosition` reads pathname from the router to key into
  // `positionByRoute`. We stub it to a stable default route so the
  // anchor math resolves without booting the real router context.
  useLocation: vi.fn(
    ({ select }: { select?: (loc: { pathname: string }) => unknown } = {}) =>
      select ? select({ pathname: '/' }) : { pathname: '/' }
  ),
}))
// `useOmnibeltPosition` also subscribes to the position store + drag
// controls + ResizeObserver — stub the whole hook to keep this test
// purely about Panel mount / dismiss / grid behaviour.
vi.mock('../hooks/useOmnibeltPosition', () => ({
  useOmnibeltPosition: () => ({
    x: 1000,
    y: 500,
    anchor: 'BR' as const,
    isDraggable: true,
    dragControls: { start: vi.fn(), subscribe: vi.fn(() => () => {}) },
    isDragging: false,
    reducedMotion: false,
    rect: { x: 1000, y: 500, w: 448, h: 480 },
    routeClass: 'default' as const,
    onDragEnd: vi.fn(),
    onDragStart: vi.fn(),
    setAnchor: vi.fn(),
    setPinned: vi.fn(),
    storedPosition: { anchor: 'BR' as const, offset: { x: 0, y: 0 } },
  }),
  DEFAULT_WIDGET_SIZE: { widgetW: 220, widgetH: 44 },
}))

const setCollapseState = vi.fn()

function setup({
  state = 'panel' as CollapseState,
  skin = 'pill' as 'pill' | 'orb' | 'skystrip',
  userHidden = false,
}: {
  state?: CollapseState
  skin?: 'pill' | 'orb' | 'skystrip'
  userHidden?: boolean
} = {}) {
  const bag = {
    collapseState: state,
    setCollapseState,
    skin,
    setSkin: vi.fn(),
    userHidden,
    setUserHidden: vi.fn(),
  }
  ;(useOmnibeltStore as unknown as Mock).mockImplementation(
    (selector: (s: typeof bag) => unknown) => selector(bag)
  )
  ;(useResolvedTools as unknown as Mock).mockReturnValue({
    pinned: [],
    all: TOOL_REGISTRY,
    filtered_count: 0,
  })
}

function renderPanel() {
  return render(
    <LayoutGroup id='omnibelt'>
      <OmniBeltPanel />
    </LayoutGroup>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  setCollapseState.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('OmniBeltPanel', () => {
  it('renders nothing when collapseState !== "panel"', () => {
    setup({ state: 'pill' })
    const { container } = renderPanel()
    expect(container.querySelector('[data-testid="omnibelt-panel"]')).toBeNull()
  })

  it('renders the panel, search box, tab strip and tool grid when open', () => {
    setup({ state: 'panel' })
    renderPanel()
    expect(screen.getByTestId('omnibelt-panel')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/search tools/i)).toBeInTheDocument()
    // Tab triggers
    expect(screen.getByRole('tab', { name: /pinned/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /all/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /recent/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /running/i })).toBeInTheDocument()
    // Tool tiles render at least one of the placeholder tools
    expect(
      screen.getByRole('grid', { name: /omnibelt tools/i })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('gridcell').length).toBeGreaterThan(0)
  })

  it('collapses back to pill on Escape', () => {
    setup({ state: 'panel' })
    renderPanel()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(setCollapseState).toHaveBeenCalledWith('pill')
  })

  it('collapses back to pill on outside pointerdown', () => {
    setup({ state: 'panel' })
    renderPanel()
    // Synthesize a pointerdown on document.body (outside the panel).
    fireEvent.pointerDown(document.body)
    expect(setCollapseState).toHaveBeenCalledWith('pill')
  })

  it('does NOT collapse when the pointerdown lands inside the panel', () => {
    setup({ state: 'panel' })
    renderPanel()
    const panel = screen.getByTestId('omnibelt-panel')
    fireEvent.pointerDown(panel)
    expect(setCollapseState).not.toHaveBeenCalled()
  })
})

// Created and developed by Jai Singh
