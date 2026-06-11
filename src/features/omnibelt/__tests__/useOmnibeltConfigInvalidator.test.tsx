// Created and developed by Jai Singh
/**
 * useOmnibeltConfigInvalidator — basic smoke + invalidation contract.
 *
 * The hook subscribes to `workServiceWs` and, on every
 * `OmnibeltConfigChanged` event matching the user's org, invalidates
 * the bootstrap query on the queryClient. We mock both surfaces and
 * assert the invalidate call shape.
 */
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
import { useOmnibeltConfigInvalidator } from '../hooks/useOmnibeltConfigInvalidator'

// ---- Mocks (declared before the hook import) -------------------------------

vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: vi.fn(),
}))

const mockInvalidateQueries = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

// Capture handler registered via workServiceWs.connect so the test
// can synthesize WS events. State-change subscribe returns a noop
// unsubscribe.
let capturedHandler: ((event: unknown) => void) | null = null
const mockConnect = vi.fn((_orgId: string, h: (event: unknown) => void) => {
  capturedHandler = h
})
const mockRemoveHandler = vi.fn(() => {
  capturedHandler = null
})
const mockOnStateChange = vi.fn(
  (_cb: (state: 'connected' | 'disconnected') => void) => () => {}
)
const mockGetConnectionState = vi.fn(() => 'connected' as const)

vi.mock('@/lib/work-service', () => ({
  workServiceWs: {
    connect: (...args: unknown[]) =>
      (mockConnect as unknown as (...a: unknown[]) => unknown)(...args),
    removeHandler: (...args: unknown[]) =>
      (mockRemoveHandler as unknown as (...a: unknown[]) => unknown)(...args),
    onStateChange: (...args: unknown[]) =>
      (mockOnStateChange as unknown as (...a: unknown[]) => unknown)(...args),
    getConnectionState: () => mockGetConnectionState(),
  },
}))

const ORG_ID = 'org-123e4567-e89b-12d3-a456-426614174000'
const OTHER_ORG_ID = 'org-other-deadbeef-0000-0000-0000-000000000000'

function setup({ orgId = ORG_ID as string | null } = {}) {
  ;(useUnifiedAuth as unknown as Mock).mockReturnValue({
    authState: {
      isAuthenticated: Boolean(orgId),
      profile: orgId ? { organization_id: orgId } : null,
    },
    isLoading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    checkPermission: vi.fn(),
  })
}

beforeEach(() => {
  capturedHandler = null
  mockInvalidateQueries.mockReset()
  mockConnect.mockClear()
  mockRemoveHandler.mockClear()
  mockOnStateChange.mockClear()
  mockGetConnectionState.mockReset().mockReturnValue('connected' as const)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useOmnibeltConfigInvalidator', () => {
  it('connects to workServiceWs with the user organization_id', () => {
    setup()
    renderHook(() => useOmnibeltConfigInvalidator())
    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(mockConnect.mock.calls[0]?.[0]).toBe(ORG_ID)
  })

  it('does not connect while organization_id is missing', () => {
    setup({ orgId: null })
    renderHook(() => useOmnibeltConfigInvalidator())
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('invalidates the bootstrap query on OmnibeltConfigChanged for the user org', () => {
    setup()
    renderHook(() => useOmnibeltConfigInvalidator())
    expect(capturedHandler).toBeTruthy()
    capturedHandler?.({
      type: 'OmnibeltConfigChanged',
      organization_id: ORG_ID,
    })
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(1)
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['omnibelt', 'bootstrap'],
    })
  })

  it('ignores events for a different organization (defence-in-depth)', () => {
    setup()
    renderHook(() => useOmnibeltConfigInvalidator())
    capturedHandler?.({
      type: 'OmnibeltConfigChanged',
      organization_id: OTHER_ORG_ID,
    })
    expect(mockInvalidateQueries).not.toHaveBeenCalled()
  })

  it('ignores unrelated WS event types', () => {
    setup()
    renderHook(() => useOmnibeltConfigInvalidator())
    capturedHandler?.({ type: 'TaskAssigned', organization_id: ORG_ID })
    capturedHandler?.({ type: 'PresenceJoined', organization_id: ORG_ID })
    expect(mockInvalidateQueries).not.toHaveBeenCalled()
  })

  it('removes its handler on unmount', () => {
    setup()
    const { unmount } = renderHook(() => useOmnibeltConfigInvalidator())
    expect(mockRemoveHandler).not.toHaveBeenCalled()
    unmount()
    expect(mockRemoveHandler).toHaveBeenCalledTimes(1)
  })
})

// Created and developed by Jai Singh
