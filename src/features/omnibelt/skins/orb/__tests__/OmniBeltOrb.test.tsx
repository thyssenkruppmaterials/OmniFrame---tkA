// Created and developed by Jai Singh
/**
 * OmniBeltOrb — skin render + interactivity contract.
 *
 * P7 ships the Compass Orb skin with three collapse states:
 *   - 'orb' / 'pill' → render the OrbBody (button + pulse + status dot)
 *   - 'panel'        → render OrbBody PLUS the lazy <RadialFan />
 *   - 'nub'          → fall back to <PillEdgeNub />
 *
 * 2026-05-24 post-launch fix (this revision) adds two assertions
 * blocking the bugs that shipped to production:
 *
 *   - Bug 1A regression: the orb's primary button stays wired to
 *     `setCollapseState('panel')` so clicking it always opens the
 *     radial fan. The fix didn't change this behaviour but the
 *     refactor restructured the DOM (wrapping div + sibling overflow
 *     button), so the regression test pins both the click path AND
 *     the new wrapper structure in place.
 *   - Bug 2 escape hatch: the on-orb `⋮` settings button mounts the
 *     same `<PanelMenuContent>` the standard panel's `<PanelMenu>`
 *     uses, so picking the Orb skin no longer traps the user. The
 *     test renders the `pill` and `skystrip` options and asserts that
 *     clicking either dispatches `setSkin(...)` through the store.
 *
 * We mock the per-user store + the RadialFan / OrbShellPopover /
 * PillEdgeNub modules + the Radix dropdown primitives so the test
 * stays focused on the orb's branching logic without booting framer-
 * motion's full layout pipeline or Radix's pointer-event activation
 * (which is fragile in jsdom).
 */
import * as React from 'react'
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import {
  useOmnibeltStore,
  type CollapseState,
  type Skin,
} from '../../../store/omnibeltStore'
import OmniBeltOrb from '../OmniBeltOrb'

vi.mock('../../../store/omnibeltStore', () => ({
  useOmnibeltStore: vi.fn(),
}))
vi.mock('../../pill/PillEdgeNub', () => ({
  PillEdgeNub: () => <div data-testid='mock-edge-nub' />,
}))
vi.mock('../RadialFan', () => ({
  RadialFan: ({ orbSize }: { orbSize: number }) => (
    <div data-testid='mock-radial-fan' data-orb-size={orbSize} />
  ),
}))
vi.mock('../OrbShellPopover', () => ({
  OrbShellPopover: () => <div data-testid='mock-orb-shell-popover' />,
}))

// Stub Radix DropdownMenu — same approach as `PanelMenu.test.tsx`.
// Children render eagerly so the test can find the menu items
// without simulating pointer activation. Radio item clicks fire
// `onValueChange` on the surrounding group, mirroring Radix runtime.
vi.mock('@/components/ui/dropdown-menu', () => {
  type Children = { children?: React.ReactNode }
  type WithClassName = Children & { className?: string }
  const RadioGroupContext = React.createContext<{
    value?: string
    onValueChange?: (next: string) => void
  } | null>(null)
  return {
    DropdownMenu: ({ children }: Children) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: Children & { asChild?: boolean }) => (
      <div data-testid='mock-dropdown-trigger'>{children}</div>
    ),
    DropdownMenuContent: ({
      children,
      ...rest
    }: WithClassName & {
      align?: string
      side?: string
      [key: string]: unknown
    }) => (
      <div data-testid={rest['data-testid'] ?? 'mock-dropdown-content'}>
        {children}
      </div>
    ),
    DropdownMenuLabel: ({ children, className }: WithClassName) => (
      <div className={className}>{children}</div>
    ),
    DropdownMenuRadioGroup: ({
      value,
      onValueChange,
      children,
    }: Children & { value?: string; onValueChange?: (v: string) => void }) => (
      <RadioGroupContext.Provider value={{ value, onValueChange }}>
        <div role='radiogroup'>{children}</div>
      </RadioGroupContext.Provider>
    ),
    DropdownMenuRadioItem: ({
      value,
      children,
      ...rest
    }: WithClassName & {
      value: string
      [key: string]: unknown
    }) => {
      const ctx = React.useContext(RadioGroupContext)
      return (
        <button
          type='button'
          {...rest}
          onClick={() => ctx?.onValueChange?.(value)}
        >
          {children}
        </button>
      )
    },
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuGroup: ({ children }: Children) => <div>{children}</div>,
    DropdownMenuCheckboxItem: ({
      checked,
      onCheckedChange,
      children,
    }: Children & {
      checked?: boolean
      onCheckedChange?: (next: boolean) => void
    }) => (
      <button
        type='button'
        data-testid='mock-checkbox-item'
        aria-checked={checked ?? false}
        onClick={() => onCheckedChange?.(!checked)}
      >
        {children}
      </button>
    ),
    DropdownMenuItem: ({
      children,
      disabled,
      onSelect,
    }: Children & {
      disabled?: boolean
      onSelect?: () => void
    }) => (
      <button type='button' disabled={disabled} onClick={() => onSelect?.()}>
        {children}
      </button>
    ),
  }
})

type Job = { id: string; progress: number; label: string }

function setup({
  state = 'pill' as CollapseState,
  skin = 'orb' as Skin,
  activeJobs = [] as Job[],
  userHidden = false,
}: {
  state?: CollapseState
  skin?: Skin
  activeJobs?: Job[]
  userHidden?: boolean
} = {}) {
  const setCollapseState = vi.fn()
  const setSkin = vi.fn()
  const setUserHidden = vi.fn()
  const bag = {
    collapseState: state,
    setCollapseState,
    activeJobs,
    skin,
    setSkin,
    userHidden,
    setUserHidden,
  }
  ;(useOmnibeltStore as unknown as Mock).mockImplementation(
    (selector: (s: typeof bag) => unknown) => selector(bag)
  )
  return { bag, setCollapseState, setSkin, setUserHidden }
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.clearAllMocks()
})

function renderOrb() {
  return render(
    <LayoutGroup id='omnibelt'>
      <OmniBeltOrb />
    </LayoutGroup>
  )
}

describe('OmniBeltOrb — render branches', () => {
  it('renders the orb button (data-omnibelt-skin="orb") when collapseState is "pill"', () => {
    setup({ state: 'pill' })
    renderOrb()
    const orb = screen.getByTestId('omnibelt-orb')
    expect(orb).toBeInTheDocument()
    expect(orb).toHaveAttribute('data-omnibelt-skin', 'orb')
    expect(orb).toHaveAttribute('data-omnibelt-host')
  })

  it('wraps the orb in a positioning anchor div so the overflow trigger can be a sibling', () => {
    // HTML disallows nested <button>s, so the overflow trigger must
    // be a SIBLING of the orb's <button>. Asserting the wrapper's
    // testid pins the structure in place so a regression that flattens
    // it (and re-introduces the nested-button bug) fails loudly.
    setup({ state: 'pill' })
    renderOrb()
    const anchor = screen.getByTestId('omnibelt-orb-anchor')
    expect(anchor).toBeInTheDocument()
    expect(anchor).toContainElement(screen.getByTestId('omnibelt-orb'))
    expect(anchor).toContainElement(screen.getByTestId('omnibelt-orb-overflow'))
  })

  it('renders the orb body for the "orb" collapse state too', () => {
    setup({ state: 'orb' })
    renderOrb()
    expect(screen.getByTestId('omnibelt-orb')).toBeInTheDocument()
  })

  it('renders the RadialFan in addition to the orb when collapseState is "panel"', async () => {
    setup({ state: 'panel' })
    renderOrb()
    // OrbBody renders synchronously; RadialFan is React.lazy-wrapped.
    expect(screen.getByTestId('omnibelt-orb')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('mock-radial-fan')).toBeInTheDocument()
    )
    // Orb size constant (68) is forwarded so fan tile origins line up
    // with the orb centre.
    expect(screen.getByTestId('mock-radial-fan')).toHaveAttribute(
      'data-orb-size',
      '68'
    )
  })

  it('falls back to the shared edge nub when collapseState is "nub"', () => {
    setup({ state: 'nub' })
    renderOrb()
    expect(screen.getByTestId('mock-edge-nub')).toBeInTheDocument()
    expect(screen.queryByTestId('omnibelt-orb')).not.toBeInTheDocument()
  })

  it('shows the status dot when activeJobs is non-empty', () => {
    setup({
      state: 'pill',
      activeJobs: [{ id: 'job-1', progress: 0.4, label: 'Importing' }],
    })
    renderOrb()
    expect(screen.getByTestId('omnibelt-orb-status-dot')).toBeInTheDocument()
  })

  it('hides the status dot when there are no active jobs', () => {
    setup({ state: 'pill', activeJobs: [] })
    renderOrb()
    expect(
      screen.queryByTestId('omnibelt-orb-status-dot')
    ).not.toBeInTheDocument()
  })
})

describe('OmniBeltOrb — Bug 1A: orb click toggles the radial fan', () => {
  it('clicking the orb toggles the panel via setCollapseState', () => {
    const { setCollapseState } = setup({ state: 'pill' })
    renderOrb()
    screen.getByTestId('omnibelt-orb').click()
    expect(setCollapseState).toHaveBeenCalledWith('panel')
  })

  it('clicking the orb while open collapses back to pill', () => {
    const { setCollapseState } = setup({ state: 'panel' })
    renderOrb()
    screen.getByTestId('omnibelt-orb').click()
    expect(setCollapseState).toHaveBeenCalledWith('pill')
  })
})

describe('OmniBeltOrb — Bug 2: on-orb settings escape hatch', () => {
  it('renders an overflow button with an a11y label so the orb skin always has a settings entry point', () => {
    setup({ state: 'pill' })
    renderOrb()
    const overflow = screen.getByTestId('omnibelt-orb-overflow')
    expect(overflow).toBeInTheDocument()
    expect(overflow).toHaveAttribute('aria-label', 'OmniBelt settings')
  })

  it('renders the same skin options the standard panel menu exposes (pill / orb / skystrip)', () => {
    setup({ state: 'pill', skin: 'orb' })
    renderOrb()
    // PanelMenuContent renders eagerly under our stubbed dropdown so
    // we don't need to simulate the trigger click — Radix runtime
    // would gate this on pointer activation; jsdom can't fake that
    // reliably and the test only cares about the round-trip.
    expect(screen.getByTestId('omnibelt-skin-option-pill')).toBeInTheDocument()
    expect(screen.getByTestId('omnibelt-skin-option-orb')).toBeInTheDocument()
    expect(
      screen.getByTestId('omnibelt-skin-option-skystrip')
    ).toBeInTheDocument()
  })

  it('selecting the Pill skin from the orb menu dispatches setSkin("pill") (escape hatch)', () => {
    const { setSkin } = setup({ state: 'pill', skin: 'orb' })
    renderOrb()
    fireEvent.click(screen.getByTestId('omnibelt-skin-option-pill'))
    expect(setSkin).toHaveBeenCalledWith('pill')
  })

  it('selecting the Sky Strip skin from the orb menu dispatches setSkin("skystrip")', () => {
    const { setSkin } = setup({ state: 'pill', skin: 'orb' })
    renderOrb()
    fireEvent.click(screen.getByTestId('omnibelt-skin-option-skystrip'))
    expect(setSkin).toHaveBeenCalledWith('skystrip')
  })

  it('clicking the overflow button does not also fire the orb toggle (e.stopPropagation guard)', () => {
    const { setCollapseState } = setup({ state: 'pill' })
    renderOrb()
    // The overflow button and the orb button overlap by a few pixels
    // at the top-right corner (the orb's hit area is the full
    // bounding box rect, not the visible circle). The trigger's
    // stopPropagation MUST keep the orb's toggle from firing when
    // the user opens the settings menu — otherwise the menu opens AND
    // the fan opens at the same time.
    fireEvent.click(screen.getByTestId('omnibelt-orb-overflow'))
    expect(setCollapseState).not.toHaveBeenCalled()
  })
})

describe('OmniBeltOrb — Bug 1C: shell tool launch surface', () => {
  it('does not mount the shell popover by default', () => {
    setup({ state: 'panel' })
    renderOrb()
    expect(
      screen.queryByTestId('mock-orb-shell-popover')
    ).not.toBeInTheDocument()
  })

  // The popover-on-launch path is exercised end-to-end in the
  // RadialFan tests (which assert that picking a shell tool invokes
  // the `onLaunchShell` callback the orb wires in). Keeping the
  // assertion split avoids re-mocking the resolved-tools hook here.
})

// Created and developed by Jai Singh
