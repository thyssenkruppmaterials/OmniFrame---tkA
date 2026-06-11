// Created and developed by Jai Singh
/**
 * OmniBeltHost — render-gate contract.
 *
 * Validates the three guarded render paths in `OmniBeltHost`:
 *   - returns null when there's no userId
 *   - returns null when `useOmnibeltVisibility` reports invisible
 *   - renders the lazy Pill + Panel layer when visible
 *
 * Visual / framer-motion behavior is exercised in the dedicated
 * Pill + Panel tests; this file is concerned only with the host's
 * mount logic so we mock everything below it.
 */
import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { OmniBeltHost } from '../OmniBeltHost'
import { useOmnibeltVisibility } from '../hooks/useOmnibeltVisibility'
import { initOmnibeltStore, useOmnibeltStore } from '../store/omnibeltStore'

vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: vi.fn(),
}))
vi.mock('../hooks/useOmnibeltVisibility', () => ({
  useOmnibeltVisibility: vi.fn(),
}))
vi.mock('../hooks/useOmnibeltConfigInvalidator', () => ({
  useOmnibeltConfigInvalidator: vi.fn(() => ({
    wsConnectionState: 'connected',
  })),
}))
vi.mock('../hooks/useOmnibeltKeyboard', () => ({
  useOmnibeltKeyboard: vi.fn(),
}))
vi.mock('../hooks/useOmnibeltJobs', () => ({
  useOmnibeltJobs: vi.fn(() => ({ activeJobs: [], cancelJob: vi.fn() })),
}))
vi.mock('../tray/OmniBeltStatusTray', () => ({
  OmniBeltStatusTray: () => <div data-testid='mock-tray' />,
}))
vi.mock('../store/omnibeltStore', () => ({
  initOmnibeltStore: vi.fn(),
  useOmnibeltStore: vi.fn(),
  // OmniBeltHost's dev-only window hook calls `getOmnibeltStore()` to
  // expose imperative setters for Playwright. Stub it to a minimal
  // store-like shape so the effect runs without throwing in jsdom.
  getOmnibeltStore: vi.fn(() => ({
    getState: () => ({
      setCollapseState: vi.fn(),
      setSkin: vi.fn(),
      setUserHidden: vi.fn(),
      setActiveJobs: vi.fn(),
    }),
  })),
}))
vi.mock('../panel/OmniBeltPanel', () => ({
  OmniBeltPanel: () => <div data-testid='mock-panel' />,
}))
vi.mock('../skins/pill/OmniBeltPill', () => ({
  default: () => <div data-testid='mock-pill' />,
}))
vi.mock('../skins/skystrip/OmniBeltSkyStrip', () => ({
  default: () => <div data-testid='mock-skystrip' />,
}))
vi.mock('../skins/orb/OmniBeltOrb', () => ({
  default: () => <div data-testid='mock-orb' />,
}))

function setup({
  userId = 'user-1' as string | null,
  visible = true,
  skin = 'pill' as 'pill' | 'orb' | 'skystrip',
}: {
  userId?: string | null
  visible?: boolean
  skin?: 'pill' | 'orb' | 'skystrip'
} = {}) {
  ;(useUnifiedAuth as unknown as Mock).mockReturnValue({
    authState: { user: userId ? { id: userId } : null, isAuthenticated: true },
  })
  ;(useOmnibeltVisibility as unknown as Mock).mockReturnValue({ visible })
  ;(initOmnibeltStore as unknown as Mock).mockReturnValue({})
  // P7 host now reads `s.skin` to decide whether to mount the shared
  // Panel (orb owns its own RadialFan). Stub a selector pass-through so
  // the mock matches the post-P7 contract.
  ;(useOmnibeltStore as unknown as Mock).mockImplementation(
    (selector: (s: { skin: typeof skin }) => unknown) => selector({ skin })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('OmniBeltHost', () => {
  it('renders nothing when there is no signed-in user', () => {
    setup({ userId: null })
    const { container } = render(<OmniBeltHost />)
    expect(container.firstChild).toBeNull()
    expect(initOmnibeltStore).not.toHaveBeenCalled()
  })

  it('renders nothing when visibility hook reports hidden', () => {
    setup({ visible: false })
    const { container } = render(<OmniBeltHost />)
    expect(container.querySelector('[data-testid="mock-pill"]')).toBeNull()
    expect(container.querySelector('[data-testid="mock-panel"]')).toBeNull()
  })

  it('initializes the per-user store and renders Pill + Panel when visible', async () => {
    setup({ visible: true, userId: 'user-42', skin: 'pill' })
    render(<OmniBeltHost />)
    expect(initOmnibeltStore).toHaveBeenCalledWith('user-42')
    // Pill is React.lazy — wait for the Suspense fallback to resolve.
    await waitFor(() =>
      expect(screen.getByTestId('mock-pill')).toBeInTheDocument()
    )
    expect(screen.getByTestId('mock-panel')).toBeInTheDocument()
  })

  it('renders SkyStrip WITHOUT the shared panel (skin owns its expanded form)', async () => {
    // Post-2026-05-24 the SkyStrip skin renders both its collapsed
    // strip and its bloomed panel from inside the skin component so
    // the morph is a single `layoutId` interpolation. The host must
    // NOT also mount the shared `<OmniBeltPanel>` for this skin —
    // doing so would duplicate the `layoutId='omnibelt-host'` target
    // and break the morph (framer warns + picks one arbitrarily).
    setup({ visible: true, userId: 'user-99', skin: 'skystrip' })
    render(<OmniBeltHost />)
    await waitFor(() =>
      expect(screen.getByTestId('mock-skystrip')).toBeInTheDocument()
    )
    expect(screen.queryByTestId('mock-panel')).toBeNull()
  })

  it('renders Orb WITHOUT the shared panel (orb owns its radial fan)', async () => {
    setup({ visible: true, userId: 'user-99', skin: 'orb' })
    render(<OmniBeltHost />)
    await waitFor(() =>
      expect(screen.getByTestId('mock-orb')).toBeInTheDocument()
    )
    expect(screen.queryByTestId('mock-panel')).toBeNull()
  })
})

// Created and developed by Jai Singh
