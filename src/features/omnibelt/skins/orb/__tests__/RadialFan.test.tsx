// Created and developed by Jai Singh
/**
 * RadialFan — fan layout + dismissal + launch contract.
 *
 * Covers:
 *   - Pure polar→Cartesian + fanAngles math (no rendering).
 *   - Tile count is clamped to RADIAL_FAN_MAX_TILES (=8).
 *   - Pinned tools win over `all`; empty pin set falls back to all.
 *   - Esc + click-outside collapse back to 'pill' (mirrors Panel).
 *   - Each tile is a `<button>` with `role='menuitem'` so keyboard
 *     activation works without a custom click translator (Bug 1C
 *     regression).
 *   - Navigation tools call `navigate(...)` and close on click.
 *   - Shell-backed tools invoke the `onLaunchShell` callback when
 *     provided (the Orb skin opens an `<OrbShellPopover>` above the
 *     orb on this callback — Bug 1C fix, 2026-05-24). When no
 *     handler is supplied, the legacy "close only" path stands so
 *     other future skins that mount the fan without a popover don't
 *     get broken by the new contract.
 */
import { IconCircle } from '@tabler/icons-react'
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
import { useOmnibeltStore } from '../../../store/omnibeltStore'
import type { ToolAccent, ToolDef } from '../../../tools/registry'
import { useResolvedTools } from '../../../tools/use-resolved-tools'
import {
  RadialFan,
  RADIAL_FAN_MAX_TILES,
  fanAngles,
  polarToOffset,
} from '../RadialFan'

vi.mock('../../../store/omnibeltStore', () => ({
  useOmnibeltStore: vi.fn(),
}))
vi.mock('../../../tools/use-resolved-tools', () => ({
  useResolvedTools: vi.fn(),
}))
const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

function makeTool(id: string, overrides: Partial<ToolDef> = {}): ToolDef {
  return {
    id,
    label: id,
    icon: IconCircle,
    accent: 'teal' as ToolAccent,
    category: 'self',
    searchable: false,
    ...overrides,
  }
}

function setup({
  pinned = [] as ToolDef[],
  all = [] as ToolDef[],
}: { pinned?: ToolDef[]; all?: ToolDef[] } = {}) {
  const setCollapseState = vi.fn()
  const bag = { setCollapseState }
  ;(useOmnibeltStore as unknown as Mock).mockImplementation(
    (selector: (s: typeof bag) => unknown) => selector(bag)
  )
  ;(useResolvedTools as unknown as Mock).mockReturnValue({
    pinned,
    all,
    filtered_count: 0,
  })
  return { setCollapseState }
}

function renderFan({
  onLaunchShell,
}: { onLaunchShell?: (tool: ToolDef) => void } = {}) {
  return render(
    <LayoutGroup id='omnibelt'>
      <RadialFan orbSize={68} onLaunchShell={onLaunchShell} />
    </LayoutGroup>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  navigate.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('polarToOffset', () => {
  it('handles 0° (positive x, zero y)', () => {
    const { x, y } = polarToOffset(0, 100)
    expect(x).toBeCloseTo(100)
    expect(y).toBeCloseTo(0)
  })

  it('handles 90° (zero x, positive y — CSS down)', () => {
    const { x, y } = polarToOffset(90, 100)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(100)
  })

  it('handles 180° (negative x)', () => {
    const { x, y } = polarToOffset(180, 100)
    expect(x).toBeCloseTo(-100)
    expect(y).toBeCloseTo(0)
  })

  it('handles 270° (zero x, negative y — CSS up)', () => {
    const { x, y } = polarToOffset(270, 100)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(-100)
  })
})

describe('fanAngles', () => {
  it('returns [] for 0 tiles', () => {
    expect(fanAngles(0)).toEqual([])
  })

  it('returns [centerDeg] for a single tile', () => {
    expect(fanAngles(1, 225, 130)).toEqual([225])
  })

  it('spreads N tiles evenly across the arc', () => {
    const result = fanAngles(3, 225, 130)
    // 130° spread / (3-1) → 65° step starting at 225-65=160.
    expect(result.length).toBe(3)
    expect(result[0]).toBeCloseTo(160)
    expect(result[1]).toBeCloseTo(225)
    expect(result[2]).toBeCloseTo(290)
  })

  it('spans full spread end-to-end for 8 tiles', () => {
    const result = fanAngles(8, 225, 130)
    expect(result.length).toBe(8)
    expect(result[0]).toBeCloseTo(225 - 65)
    expect(result[result.length - 1]).toBeCloseTo(225 + 65)
  })
})

describe('RadialFan rendering', () => {
  it('renders nothing when there are no tools to display', () => {
    setup({ pinned: [], all: [] })
    const { container } = renderFan()
    expect(
      container.querySelector('[data-testid="omnibelt-radial-fan"]')
    ).toBeNull()
  })

  it('renders one tile per pinned tool when pinned set is non-empty', () => {
    const tools = ['a', 'b', 'c'].map((id) => makeTool(id))
    setup({ pinned: tools, all: tools })
    renderFan()
    expect(screen.getByTestId('omnibelt-radial-fan')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem').length).toBe(3)
  })

  it('falls back to `all` when pinned is empty', () => {
    const tools = ['x', 'y'].map((id) => makeTool(id))
    setup({ pinned: [], all: tools })
    renderFan()
    expect(screen.getAllByRole('menuitem').length).toBe(2)
  })

  it('caps the displayed tiles at RADIAL_FAN_MAX_TILES (8)', () => {
    const tools = Array.from({ length: 12 }, (_, i) => makeTool(`t${i}`))
    setup({ pinned: tools, all: tools })
    renderFan()
    expect(screen.getAllByRole('menuitem').length).toBe(RADIAL_FAN_MAX_TILES)
  })

  it('collapses back to "pill" on Escape', () => {
    const { setCollapseState } = setup({
      pinned: [makeTool('a')],
      all: [makeTool('a')],
    })
    renderFan()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(setCollapseState).toHaveBeenCalledWith('pill')
  })

  it('collapses back to "pill" on outside pointerdown', () => {
    const { setCollapseState } = setup({
      pinned: [makeTool('a')],
      all: [makeTool('a')],
    })
    renderFan()
    fireEvent.pointerDown(document.body)
    expect(setCollapseState).toHaveBeenCalledWith('pill')
  })

  it('ignores pointerdown on elements tagged data-omnibelt-host', () => {
    const { setCollapseState } = setup({
      pinned: [makeTool('a')],
      all: [makeTool('a')],
    })
    renderFan()
    // Insert a sibling node with the host tag; the fan's pointerdown
    // handler should short-circuit on closest('[data-omnibelt-host]').
    const orbStub = document.createElement('div')
    orbStub.setAttribute('data-omnibelt-host', '')
    document.body.appendChild(orbStub)
    fireEvent.pointerDown(orbStub)
    expect(setCollapseState).not.toHaveBeenCalled()
    orbStub.remove()
  })

  it('renders each tile as a real <button> with role=menuitem', () => {
    // Regression for Bug 1C: keyboard activation + screen readers
    // both rely on the tile being a focusable button with an
    // accessible name + the menuitem role. A `<div onClick>` would
    // render but be inaccessible.
    const tools = ['alpha', 'beta'].map((id) =>
      makeTool(id, { label: id.toUpperCase() })
    )
    setup({ pinned: tools, all: tools })
    renderFan()
    for (const tool of tools) {
      const tile = screen.getByTestId(`omnibelt-fan-tile-${tool.id}`)
      expect(tile.tagName).toBe('BUTTON')
      expect(tile).toHaveAttribute('role', 'menuitem')
      expect(tile).toHaveAttribute('type', 'button')
      expect(tile).toHaveAccessibleName(tool.label)
    }
  })

  it('launches navigation tools via navigate() and collapses', () => {
    const tool = makeTool('quick', { navigationUrl: '/quick' })
    const { setCollapseState } = setup({ pinned: [tool], all: [tool] })
    renderFan()
    screen.getByTestId('omnibelt-fan-tile-quick').click()
    expect(navigate).toHaveBeenCalledWith({ to: '/quick' })
    expect(setCollapseState).toHaveBeenCalledWith('pill')
  })

  it('navigation tools ignore the onLaunchShell callback (callback is shell-only)', () => {
    const tool = makeTool('quick', { navigationUrl: '/quick' })
    const onLaunchShell = vi.fn()
    setup({ pinned: [tool], all: [tool] })
    renderFan({ onLaunchShell })
    screen.getByTestId('omnibelt-fan-tile-quick').click()
    expect(navigate).toHaveBeenCalledWith({ to: '/quick' })
    expect(onLaunchShell).not.toHaveBeenCalled()
  })

  it('shell-only tools invoke onLaunchShell (Bug 1C: tile click actually launches the shell)', () => {
    // Bug 1C root cause: 6 of 9 v1 tools are shell-backed; the v1 fan
    // called `close()` for these and did nothing visible. The Orb
    // skin now passes an `onLaunchShell` callback that mounts an
    // `<OrbShellPopover>` above the orb. This test pins that
    // delegation in place so a future refactor doesn't regress it.
    const tool = makeTool('shell-only')
    const onLaunchShell = vi.fn()
    const { setCollapseState } = setup({ pinned: [tool], all: [tool] })
    renderFan({ onLaunchShell })
    screen.getByTestId('omnibelt-fan-tile-shell-only').click()
    expect(navigate).not.toHaveBeenCalled()
    expect(onLaunchShell).toHaveBeenCalledTimes(1)
    expect(onLaunchShell).toHaveBeenCalledWith(tool)
    // Fan still collapses — the popover takes over rendering and the
    // orb stays mounted underneath as the dismissal target.
    expect(setCollapseState).toHaveBeenCalledWith('pill')
  })

  it('shell-only tools fall back to closing when no onLaunchShell is provided (legacy contract)', () => {
    // Future skins that mount the fan without a shell popover should
    // not crash — the fan defers to closing so the user can re-open
    // into whatever the surrounding chrome offers.
    const tool = makeTool('shell-only')
    const { setCollapseState } = setup({ pinned: [tool], all: [tool] })
    renderFan()
    screen.getByTestId('omnibelt-fan-tile-shell-only').click()
    expect(navigate).not.toHaveBeenCalled()
    expect(setCollapseState).toHaveBeenCalledWith('pill')
  })
})

// Created and developed by Jai Singh
