// Created and developed by Jai Singh
/**
 * OmniBeltSkyStrip — skin render contract (v1.1, 2026-05-24).
 *
 * v1 mounted at top-center and delegated the expanded surface to the
 * shared `<OmniBeltPanel>`. v1.1 moves the strip to bottom-center
 * and the skin now OWNS its expanded form (strip → panel is one
 * `layoutId` morph that grows upward from the strip's anchor).
 *
 * These tests validate:
 *   - resting state renders the strip at bottom-center (not top)
 *   - expanded state renders the bloomed panel anchored at the same
 *     bottom-center baseline
 *   - the strip and panel share the COLLAPSE_LAYOUT_ID so framer
 *     interpolates between them (the canonical Dynamic-Island morph
 *     primitive)
 *   - only one of (strip, panel) is mounted at any time
 *   - nub state still falls through to the shared edge nub
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
import {
  useOmnibeltStore,
  type CollapseState,
} from '../../../store/omnibeltStore'
import { TOOL_REGISTRY } from '../../../tools/registry'
import { useResolvedTools } from '../../../tools/use-resolved-tools'
import OmniBeltSkyStrip from '../OmniBeltSkyStrip'

vi.mock('../../../store/omnibeltStore', () => ({
  useOmnibeltStore: vi.fn(),
}))
vi.mock('../../../tools/use-resolved-tools', () => ({
  useResolvedTools: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: vi.fn(
    ({ select }: { select?: (loc: { pathname: string }) => unknown } = {}) =>
      select ? select({ pathname: '/' }) : { pathname: '/' }
  ),
}))
vi.mock('../../pill/PillEdgeNub', () => ({
  PillEdgeNub: () => <div data-testid='mock-edge-nub' />,
}))
vi.mock('../StripStatusSurface', () => ({
  StripStatusSurface: () => <span data-testid='mock-strip-status' />,
}))

type Job = { id: string; progress: number; label: string }

const setCollapseState = vi.fn()

function setup({
  state = 'pill' as CollapseState,
  activeJobs = [] as Job[],
}: { state?: CollapseState; activeJobs?: Job[] } = {}) {
  const bag = {
    collapseState: state,
    setCollapseState,
    activeJobs,
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

function renderStrip() {
  return render(
    <LayoutGroup id='omnibelt'>
      <OmniBeltSkyStrip />
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

describe('OmniBeltSkyStrip — collapsed strip', () => {
  it('renders the collapsed strip when collapseState is "pill"', () => {
    setup({ state: 'pill' })
    renderStrip()
    const strip = screen.getByTestId('omnibelt-skystrip')
    expect(strip).toBeInTheDocument()
    expect(strip).toHaveAttribute('data-omnibelt-skin', 'skystrip')
    expect(strip).toHaveAttribute('data-omnibelt-host')
  })

  it('renders the collapsed strip when collapseState is "orb"', () => {
    setup({ state: 'orb' })
    renderStrip()
    expect(screen.getByTestId('omnibelt-skystrip')).toBeInTheDocument()
  })

  it('anchors the collapsed strip at the BOTTOM-CENTER of the viewport', () => {
    // Bottom-center positioning is part of the visual contract — the
    // strip morphs upward into the panel from this anchor. v1.2 moved
    // the positioning OFF the morphing element onto a fixed shell
    // (so framer-motion's FLIP transform doesn't fight an inline
    // `translateX(-50%)`); the visual contract now lives on
    // `omnibelt-skystrip-anchor`, and the morphing strip stays pure
    // box-model so framer can interpolate the bounding rect cleanly.
    setup({ state: 'pill' })
    renderStrip()
    const anchor = screen.getByTestId('omnibelt-skystrip-anchor')
    expect(anchor).toHaveStyle({
      position: 'fixed',
      left: '0px',
      right: '0px',
      display: 'flex',
      justifyContent: 'center',
    })
    expect(anchor.getAttribute('style') ?? '').toMatch(/bottom:\s*24/)
    // Defensive: confirm we removed the top-anchored CSS that v1
    // shipped with so a regression to top-center fails the test.
    expect(anchor.getAttribute('style') ?? '').not.toMatch(/top:\s*[0-9]/)
    // The morphing strip itself must NOT carry an inline `translateX`
    // — that was the v1.1 bug that drifted the morph to the right as
    // width grew from 220 → 760 px.
    const strip = screen.getByTestId('omnibelt-skystrip')
    expect(strip.getAttribute('style') ?? '').not.toMatch(/translate/i)
    expect(strip.getAttribute('style') ?? '').not.toMatch(/left:/)
  })

  it('falls back to the shared edge nub when collapseState is "nub"', () => {
    setup({ state: 'nub' })
    renderStrip()
    expect(screen.getByTestId('mock-edge-nub')).toBeInTheDocument()
    expect(screen.queryByTestId('omnibelt-skystrip')).not.toBeInTheDocument()
  })

  it('clicking the strip opens the panel', () => {
    setup({ state: 'pill' })
    renderStrip()
    screen.getByTestId('omnibelt-skystrip').click()
    expect(setCollapseState).toHaveBeenCalledWith('panel')
  })

  it('renders the StripStatusSurface inside the strip', () => {
    setup({ state: 'pill' })
    renderStrip()
    expect(screen.getByTestId('mock-strip-status')).toBeInTheDocument()
  })

  it('renders the status dot with pulse styles when jobs are running', () => {
    setup({
      state: 'pill',
      activeJobs: [{ id: 'job-1', progress: 0.2, label: 'Importing' }],
    })
    renderStrip()
    const dot = screen.getByTestId('omnibelt-skystrip-dot')
    expect(dot).toHaveClass('motion-safe:animate-pulse')
    expect(dot).toHaveClass('bg-teal-400')
  })

  it('renders the status dot in neutral state when no jobs are running', () => {
    setup({ state: 'pill', activeJobs: [] })
    renderStrip()
    const dot = screen.getByTestId('omnibelt-skystrip-dot')
    expect(dot).not.toHaveClass('motion-safe:animate-pulse')
    expect(dot).toHaveClass('bg-neutral-500')
  })
})

describe('OmniBeltSkyStrip — expanded panel (skin-owned morph)', () => {
  it('renders the expanded panel (not the strip) when collapseState is "panel"', () => {
    setup({ state: 'panel' })
    renderStrip()
    // AnimatePresence mode='wait' keeps exactly one of (strip, panel)
    // mounted at any time. In 'panel' state the panel is the survivor.
    expect(screen.queryByTestId('omnibelt-skystrip')).toBeNull()
    expect(screen.getByTestId('omnibelt-skystrip-panel')).toBeInTheDocument()
  })

  it('expanded panel carries the SkyStrip skin marker + omnibelt-host tag', () => {
    setup({ state: 'panel' })
    renderStrip()
    const panel = screen.getByTestId('omnibelt-skystrip-panel')
    expect(panel).toHaveAttribute('data-omnibelt-skin', 'skystrip')
    expect(panel).toHaveAttribute('data-omnibelt-host')
    expect(panel).toHaveAttribute('role', 'dialog')
  })

  it('expanded panel anchors at the same bottom-center baseline as the strip', () => {
    // Bottom-edge of the panel sits where the strip was — this is what
    // makes the morph read as "strip blooms upward into panel" rather
    // than the panel teleporting in. Both forms render inside the same
    // `omnibelt-skystrip-anchor` fixed shell (v1.2), so checking the
    // anchor's positioning AND the single-child invariant covers the
    // contract.
    setup({ state: 'panel' })
    renderStrip()
    const anchor = screen.getByTestId('omnibelt-skystrip-anchor')
    expect(anchor).toHaveStyle({
      position: 'fixed',
      display: 'flex',
      justifyContent: 'center',
    })
    expect(anchor.getAttribute('style') ?? '').toMatch(/bottom:\s*24/)
    // Panel itself stays pure box-model — no inline `translateX` or
    // `left` that would fight framer's FLIP transform.
    const panel = screen.getByTestId('omnibelt-skystrip-panel')
    expect(panel.getAttribute('style') ?? '').not.toMatch(/translate/i)
    expect(panel.getAttribute('style') ?? '').not.toMatch(/left:/)
  })

  it('renders PanelContent inside the expanded panel (search + tabs)', () => {
    // Sanity: the SkyStrip reuses PanelContent so the user sees the
    // same UI as the Pill-skin panel — no parallel skin-specific
    // content paths to maintain.
    setup({ state: 'panel' })
    renderStrip()
    expect(screen.getByPlaceholderText(/search tools/i)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /pinned/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /all/i })).toBeInTheDocument()
  })

  it('does NOT render the strip while expanded (one layoutId target at a time)', () => {
    setup({ state: 'panel' })
    renderStrip()
    expect(screen.queryByTestId('omnibelt-skystrip')).toBeNull()
  })

  it('does NOT render the expanded panel while collapsed', () => {
    setup({ state: 'pill' })
    renderStrip()
    expect(screen.queryByTestId('omnibelt-skystrip-panel')).toBeNull()
  })
})

// Created and developed by Jai Singh
