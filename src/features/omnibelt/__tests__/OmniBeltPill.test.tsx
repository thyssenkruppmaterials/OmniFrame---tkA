// Created and developed by Jai Singh
/**
 * OmniBeltPill — collapse-state branching.
 *
 * The Pill renders one of four states based on
 * `useOmnibeltStore(s => s.collapseState)`. We mock the store, resolved-
 * tools hook, and the P6 position / collision hooks to assert the right
 * sub-component mounts each time without booting the full framer-motion
 * + TanStack Router stack.
 */
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
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
import { useOmnibeltCollisionAvoidance } from '../hooks/useOmnibeltCollisionAvoidance'
import { useOmnibeltPosition } from '../hooks/useOmnibeltPosition'
import OmniBeltPill from '../skins/pill/OmniBeltPill'
import { useOmnibeltStore, type CollapseState } from '../store/omnibeltStore'
import { useResolvedTools } from '../tools/use-resolved-tools'

vi.mock('../store/omnibeltStore', () => ({
  useOmnibeltStore: vi.fn(),
}))
vi.mock('../tools/use-resolved-tools', () => ({
  useResolvedTools: vi.fn(),
}))
vi.mock('../hooks/useOmnibeltPosition', () => ({
  useOmnibeltPosition: vi.fn(),
  DEFAULT_WIDGET_SIZE: { widgetW: 220, widgetH: 44 },
}))
vi.mock('../hooks/useOmnibeltCollisionAvoidance', () => ({
  useOmnibeltCollisionAvoidance: vi.fn(),
}))

function setup({
  state = 'pill' as CollapseState,
  pinned = [],
  all = [],
  anchor = 'BR' as const,
}: {
  state?: CollapseState
  pinned?: { id: string }[]
  all?: { id: string }[]
  anchor?: 'BR' | 'PINNED'
} = {}) {
  const stateBag = {
    collapseState: state,
    setCollapseState: vi.fn(),
    // P5 — Mach 3 halo additions. Default to no jobs / closed tray
    // so the existing collapse-state branching tests don't have to
    // care about the halo overlay.
    activeJobs: [],
    trayOpen: false,
    setTrayOpen: vi.fn(),
  }
  ;(useOmnibeltStore as unknown as Mock).mockImplementation(
    (selector: (s: typeof stateBag) => unknown) => selector(stateBag)
  )
  ;(useResolvedTools as unknown as Mock).mockReturnValue({
    pinned,
    all,
    filtered_count: 0,
  })
  const positionStub = {
    x: 800,
    y: 700,
    anchor,
    isDraggable: anchor !== 'PINNED',
    // framer-motion 12 calls `dragControls.subscribe(controls)` on mount
    // (gestures/drag/index.mjs:17) and expects an unsubscribe fn back —
    // mirror that shape so the gesture wiring doesn't crash in jsdom.
    dragControls: { start: vi.fn(), subscribe: vi.fn(() => () => {}) },
    isDragging: false,
    reducedMotion: false,
    rect: { x: 800, y: 700, w: 220, h: 44 },
    routeClass: 'default' as const,
    onDragEnd: vi.fn(),
    onDragStart: vi.fn(),
    setAnchor: vi.fn(),
    setPinned: vi.fn(),
    storedPosition: { anchor, offset: { x: 0, y: 0 } },
  }
  ;(useOmnibeltPosition as unknown as Mock).mockReturnValue(positionStub)
  ;(useOmnibeltCollisionAvoidance as unknown as Mock).mockReturnValue({
    adjustedRect: { x: 800, y: 700, w: 220, h: 44 },
    reason: 'no_overlap',
    competing: [],
  })
  return { stateBag, positionStub }
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('OmniBeltPill', () => {
  it('renders the mini-orb when state is "orb"', () => {
    setup({ state: 'orb' })
    render(
      <LayoutGroup id='omnibelt'>
        <OmniBeltPill />
      </LayoutGroup>
    )
    expect(screen.getByTestId('omnibelt-mini-orb')).toBeInTheDocument()
  })

  it('renders the pill body when state is "pill"', () => {
    setup({ state: 'pill' })
    render(
      <LayoutGroup id='omnibelt'>
        <OmniBeltPill />
      </LayoutGroup>
    )
    expect(screen.getByTestId('omnibelt-pill')).toBeInTheDocument()
  })

  it('returns null when state is "panel" (Panel owns that render)', () => {
    setup({ state: 'panel' })
    const { container } = render(
      <LayoutGroup id='omnibelt'>
        <OmniBeltPill />
      </LayoutGroup>
    )
    expect(container.querySelector('[data-omnibelt-host]')).toBeNull()
  })

  it('renders the edge nub when state is "nub"', () => {
    setup({ state: 'nub' })
    render(
      <LayoutGroup id='omnibelt'>
        <OmniBeltPill />
      </LayoutGroup>
    )
    expect(screen.getByTestId('omnibelt-edge-nub')).toBeInTheDocument()
  })

  it('positions the pill via transform: translate3d (no layout thrash)', () => {
    setup({ state: 'pill' })
    render(
      <LayoutGroup id='omnibelt'>
        <OmniBeltPill />
      </LayoutGroup>
    )
    const pill = screen.getByTestId('omnibelt-pill') as HTMLElement
    expect(pill.style.transform).toContain('translate3d')
    expect(pill.style.transform).toContain('800px')
    expect(pill.style.transform).toContain('700px')
    expect(pill.style.position).toBe('fixed')
  })

  it('disables drag when PINNED', () => {
    setup({ state: 'pill', anchor: 'PINNED' })
    render(
      <LayoutGroup id='omnibelt'>
        <OmniBeltPill />
      </LayoutGroup>
    )
    const pill = screen.getByTestId('omnibelt-pill') as HTMLElement
    // framer reflects `drag={false}` by setting touch-action: auto.
    expect(pill.style.touchAction).toBe('auto')
  })
})

// Created and developed by Jai Singh
