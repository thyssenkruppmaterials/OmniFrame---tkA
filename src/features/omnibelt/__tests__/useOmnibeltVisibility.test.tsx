// Created and developed by Jai Singh
/**
 * useOmnibeltVisibility — every kill-switch layer.
 *
 * Heavy mock surface because the hook touches: Capacitor, TanStack Router,
 * the auth provider, TanStack Query, and the per-user Zustand store. We
 * mock each at the module boundary so the test can exercise one layer at
 * a time without booting the real provider tree.
 */
import { useQuery } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import { Capacitor } from '@capacitor/core'
import { renderHook } from '@testing-library/react'
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
import { useOmnibeltVisibility } from '../hooks/useOmnibeltVisibility'
import { useOmnibeltStore } from '../store/omnibeltStore'

// ---- Mocks (declared before the hook import) -------------------------------

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: vi.fn(),
}))

vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}))

vi.mock('@/lib/services/omnibelt-settings-service', () => ({
  OmnibeltSettingsService: { getEnabled: vi.fn(async () => true) },
  OMNIBELT_ENABLED_SETTING_KEY: 'system.omnibelt.enabled',
}))

vi.mock('../store/omnibeltStore', () => ({
  useOmnibeltStore: vi.fn(),
}))

// ---- Helpers ---------------------------------------------------------------

type OrgEnabled = boolean | undefined

function setup(
  opts: {
    pathname?: string
    authenticated?: boolean
    native?: boolean
    orgEnabled?: OrgEnabled
    userHidden?: boolean
  } = {}
) {
  const {
    pathname = '/dashboard',
    authenticated = true,
    native = false,
    orgEnabled = true,
    userHidden = false,
  } = opts

  ;(Capacitor.isNativePlatform as unknown as Mock).mockReturnValue(native)
  ;(useLocation as unknown as Mock).mockReturnValue(pathname)
  ;(useUnifiedAuth as unknown as Mock).mockReturnValue({
    authState: { isAuthenticated: authenticated },
    isLoading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    checkPermission: vi.fn(),
  })
  ;(useQuery as unknown as Mock).mockReturnValue({ data: orgEnabled })
  ;(useOmnibeltStore as unknown as Mock).mockImplementation(
    (selector: (s: { userHidden: boolean }) => unknown) =>
      selector({ userHidden })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ---- Tests -----------------------------------------------------------------

describe('useOmnibeltVisibility — happy path', () => {
  it('returns visible:true when every layer permits', () => {
    setup({})
    const { result } = renderHook(() => useOmnibeltVisibility())
    expect(result.current).toEqual({ visible: true })
  })
})

describe('useOmnibeltVisibility — kill switch layers (in order)', () => {
  it('layer 2: hides when Capacitor reports native platform', () => {
    // Skipping layer 1 (env) here — env is build-time inlined and the
    // hook reads it at module load. We exercise the env path in its own
    // dedicated test below.
    setup({ native: true })
    const { result } = renderHook(() => useOmnibeltVisibility())
    expect(result.current).toEqual({
      visible: false,
      reason: 'native_excluded',
    })
  })

  it('layer 3: hides on excluded route', () => {
    setup({ pathname: '/rf-interface/putaway' })
    const { result } = renderHook(() => useOmnibeltVisibility())
    expect(result.current).toEqual({
      visible: false,
      reason: 'route_excluded',
    })
  })

  it('layer 4: hides when unauthenticated', () => {
    setup({ authenticated: false })
    const { result } = renderHook(() => useOmnibeltVisibility())
    expect(result.current).toEqual({
      visible: false,
      reason: 'unauthenticated',
    })
  })

  it('layer 5: hides when org explicitly disabled', () => {
    setup({ orgEnabled: false })
    const { result } = renderHook(() => useOmnibeltVisibility())
    expect(result.current).toEqual({ visible: false, reason: 'org_disabled' })
  })

  it('layer 5: hides while org-enabled query is still loading (undefined)', () => {
    // Fail closed until the org value is positively confirmed `true`.
    // `undefined` (not yet fetched) stays hidden — the launcher must not
    // flash on a cold load for an org that has OmniBelt turned off. A
    // confirmed-enabled org decides synchronously via the persisted
    // `placeholderData` seed, so this only adds a one-frame delay on the
    // first-ever load of a never-seen org.
    //
    // NB: drive the mock directly rather than via `setup({ orgEnabled:
    // undefined })` — the helper's destructuring default (`orgEnabled =
    // true`) coerces an explicit `undefined` back to `true`, so passing
    // it through `setup` would silently test the enabled path instead of
    // the pending one (which is exactly how the prior fail-open behavior
    // went unnoticed).
    setup({})
    ;(useQuery as unknown as Mock).mockReturnValue({ data: undefined })
    const { result } = renderHook(() => useOmnibeltVisibility())
    expect(result.current).toEqual({ visible: false, reason: 'org_disabled' })
  })

  it('layer 6: hides when the user has flipped userHidden', () => {
    setup({ userHidden: true })
    const { result } = renderHook(() => useOmnibeltVisibility())
    expect(result.current).toEqual({ visible: false, reason: 'user_hidden' })
  })
})

describe('useOmnibeltVisibility — layer 1 env disable', () => {
  it('hides when VITE_OMNIBELT_DISABLED is truthy at module load', async () => {
    // Env var is read inside the hook module at first import. To exercise
    // it we stub the env, reset the module graph so the IIFE re-runs, then
    // import the hook again — separate from the top-of-file import that
    // saw `VITE_OMNIBELT_DISABLED=undefined`.
    vi.stubEnv('VITE_OMNIBELT_DISABLED', 'true')
    vi.resetModules()

    // Re-establish the same mocks on the fresh module graph.
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: vi.fn(() => false) },
    }))
    vi.doMock('@tanstack/react-router', () => ({
      useLocation: vi.fn(() => '/dashboard'),
    }))
    vi.doMock('@/lib/auth/unified-auth-provider', () => ({
      useUnifiedAuth: vi.fn(() => ({
        authState: { isAuthenticated: true },
        isLoading: false,
        error: null,
        signIn: vi.fn(),
        signOut: vi.fn(),
        checkPermission: vi.fn(),
      })),
    }))
    vi.doMock('@tanstack/react-query', () => ({
      useQuery: vi.fn(() => ({ data: true })),
    }))
    vi.doMock('@/lib/services/omnibelt-settings-service', () => ({
      OmnibeltSettingsService: { getEnabled: vi.fn(async () => true) },
      OMNIBELT_ENABLED_SETTING_KEY: 'system.omnibelt.enabled',
    }))
    vi.doMock('../store/omnibeltStore', () => ({
      useOmnibeltStore: vi.fn(
        (selector: (s: { userHidden: boolean }) => unknown) =>
          selector({ userHidden: false })
      ),
    }))

    const mod = await import('../hooks/useOmnibeltVisibility')
    const { result } = renderHook(() => mod.useOmnibeltVisibility())
    expect(result.current).toEqual({ visible: false, reason: 'env_disabled' })

    // Cleanup so subsequent tests use the original mocks.
    vi.doUnmock('@capacitor/core')
    vi.doUnmock('@tanstack/react-router')
    vi.doUnmock('@/lib/auth/unified-auth-provider')
    vi.doUnmock('@tanstack/react-query')
    vi.doUnmock('@/lib/services/omnibelt-settings-service')
    vi.doUnmock('../store/omnibeltStore')
    vi.resetModules()
  })
})

describe('useOmnibeltVisibility — ordering precedence', () => {
  it('native excludes even when route is allowed and user authed', () => {
    setup({ native: true, pathname: '/admin', authenticated: true })
    const { result } = renderHook(() => useOmnibeltVisibility())
    expect(result.current.reason).toBe('native_excluded')
  })

  it('route excludes even when org is enabled and user authed', () => {
    setup({
      pathname: '/sign-in',
      authenticated: true,
      orgEnabled: true,
    })
    const { result } = renderHook(() => useOmnibeltVisibility())
    expect(result.current.reason).toBe('route_excluded')
  })

  it('unauthenticated wins over org_disabled and user_hidden', () => {
    setup({ authenticated: false, orgEnabled: false, userHidden: true })
    const { result } = renderHook(() => useOmnibeltVisibility())
    expect(result.current.reason).toBe('unauthenticated')
  })

  it('org_disabled wins over user_hidden', () => {
    setup({ orgEnabled: false, userHidden: true })
    const { result } = renderHook(() => useOmnibeltVisibility())
    expect(result.current.reason).toBe('org_disabled')
  })
})

// Created and developed by Jai Singh
