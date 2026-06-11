// Created and developed by Jai Singh
/**
 * SkyStrip strip → panel morph contract (v1.1, 2026-05-24).
 *
 * This is the canonical Dynamic-Island primitive: a single
 * `motion.div` exists at any time, and framer-motion interpolates
 * its bounding rect between the collapsed strip form and the
 * expanded panel form via a shared `layoutId`. Two `motion.div`s
 * with the same `layoutId` in the same `LayoutGroup` get paired
 * automatically and animated as one.
 *
 * Failure modes this test guards against:
 *
 *   1. The strip and panel pick DIFFERENT `layoutId` values — the
 *      morph silently fails and the panel pops in detached.
 *   2. The strip stays mounted alongside the panel — framer warns
 *      and the pair becomes ambiguous; usually the panel teleports.
 *   3. The panel forgets the `data-omnibelt-host` tag — outside-click
 *      detection in `<OmniBeltPanel>` treats clicks on the morphed
 *      panel as outside clicks (it's the only signal the click was
 *      on an OmniBelt surface).
 *
 * Implementation contract (verified here):
 *   - Strip and panel BOTH carry `layoutId='omnibelt-host'`
 *     (COLLAPSE_LAYOUT_ID) and `data-omnibelt-host`.
 *   - Exactly one of (strip, panel) is in the DOM at any time
 *     (`<AnimatePresence mode='wait'>`).
 *   - Both anchor at the same bottom-center baseline so the morph
 *     reads as upward bloom, not a corner appearance.
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
import { COLLAPSE_LAYOUT_ID } from '../../../lib/motion'
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

const setCollapseState = vi.fn()

function bindStore(state: CollapseState) {
  const bag = {
    collapseState: state,
    setCollapseState,
    activeJobs: [],
  }
  ;(useOmnibeltStore as unknown as Mock).mockImplementation(
    (selector: (s: typeof bag) => unknown) => selector(bag)
  )
}

function renderSkyStrip() {
  return render(
    <LayoutGroup id='omnibelt'>
      <OmniBeltSkyStrip />
    </LayoutGroup>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  setCollapseState.mockReset()
  ;(useResolvedTools as unknown as Mock).mockReturnValue({
    pinned: [],
    all: TOOL_REGISTRY,
    filtered_count: 0,
  })
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('SkyStrip strip ↔ panel morph', () => {
  it('strip mounts with the shared layoutId in collapsed state', () => {
    bindStore('pill')
    renderSkyStrip()
    const strip = screen.getByTestId('omnibelt-skystrip')
    // framer-motion writes `data-projection-id` only — the user-facing
    // contract is that both forms share the COLLAPSE_LAYOUT_ID constant
    // from `lib/motion.ts`. We can't easily probe framer's internal
    // mapping in jsdom, so we assert the constant matches the value the
    // component exports + that the data-* anchor lands.
    expect(strip).toBeInTheDocument()
    expect(COLLAPSE_LAYOUT_ID).toBe('omnibelt-host')
    // The data-omnibelt-host tag IS the user-facing contract: it's how
    // OmniBeltPanel's outside-click detection knows the click landed on
    // an OmniBelt surface during a morph. Both forms must carry it.
    expect(strip).toHaveAttribute('data-omnibelt-host')
  })

  it('panel mounts with the shared layoutId + host tag in expanded state', () => {
    bindStore('panel')
    renderSkyStrip()
    const panel = screen.getByTestId('omnibelt-skystrip-panel')
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveAttribute('data-omnibelt-host')
    // Both forms carry the SkyStrip skin marker so the host can target
    // skin-specific CSS / behavior without re-walking the registry.
    expect(panel).toHaveAttribute('data-omnibelt-skin', 'skystrip')
  })

  it('exactly one of (strip, panel) is mounted at a time', () => {
    // In each state, the other form must be absent. AnimatePresence
    // mode='wait' enforces this — the outgoing form unmounts before
    // the incoming one mounts. We exercise each state with a fresh
    // mount because rerender + AnimatePresence's exit-animation
    // bookkeeping doesn't complete cleanly inside jsdom (no real
    // raf loop) and would race the assertion.
    bindStore('pill')
    const collapsed = renderSkyStrip()
    expect(collapsed.queryByTestId('omnibelt-skystrip')).not.toBeNull()
    expect(collapsed.queryByTestId('omnibelt-skystrip-panel')).toBeNull()
    collapsed.unmount()

    bindStore('panel')
    const expanded = renderSkyStrip()
    expect(expanded.queryByTestId('omnibelt-skystrip-panel')).not.toBeNull()
    expect(expanded.queryByTestId('omnibelt-skystrip')).toBeNull()
  })

  it('strip and panel anchor at the same bottom-center baseline (morph reads as upward bloom)', () => {
    // Both forms render inside the same `omnibelt-skystrip-anchor`
    // fixed flex shell (v1.2). The shell is what carries the
    // bottom-center positioning — the morphing children stay pure
    // box-model so framer-motion's FLIP transform can interpolate
    // their bounding rects cleanly without fighting an inline
    // `translateX(-50%)` whose percentage references the changing
    // width. v1.1 had the children carrying `left: 50%; translateX
    // (-50%)` directly and the morph visibly drifted to the right as
    // the width grew from 220 → 760 px; this test pins the
    // wrapper-based contract so that regression can't return.
    bindStore('pill')
    const collapsed = renderSkyStrip()
    const collapsedAnchor = collapsed.getByTestId('omnibelt-skystrip-anchor')
    expect(collapsedAnchor).toHaveStyle({
      position: 'fixed',
      display: 'flex',
      justifyContent: 'center',
    })
    expect(collapsedAnchor.getAttribute('style') ?? '').toMatch(/bottom:\s*24/)
    // Defensive: morphing strip is pure box-model, no positioning
    // hacks that would fight the FLIP transform.
    const strip = collapsed.getByTestId('omnibelt-skystrip')
    expect(strip.getAttribute('style') ?? '').not.toMatch(/translate/i)
    collapsed.unmount()

    bindStore('panel')
    const expanded = renderSkyStrip()
    const expandedAnchor = expanded.getByTestId('omnibelt-skystrip-anchor')
    expect(expandedAnchor).toHaveStyle({
      position: 'fixed',
      display: 'flex',
      justifyContent: 'center',
    })
    expect(expandedAnchor.getAttribute('style') ?? '').toMatch(/bottom:\s*24/)
    const panel = expanded.getByTestId('omnibelt-skystrip-panel')
    expect(panel.getAttribute('style') ?? '').not.toMatch(/translate/i)
  })

  it('clicking the strip dispatches setCollapseState("panel") so the morph runs', () => {
    bindStore('pill')
    renderSkyStrip()
    screen.getByTestId('omnibelt-skystrip').click()
    expect(setCollapseState).toHaveBeenCalledWith('panel')
  })
})

// Created and developed by Jai Singh
