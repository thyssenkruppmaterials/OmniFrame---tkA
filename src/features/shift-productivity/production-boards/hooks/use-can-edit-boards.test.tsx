// Created and developed by Jai Singh
/**
 * Hook test for `useCanEditBoards`. Mocks the auth provider + auth-service
 * so we can verify:
 *   1. When `authService.checkPermission` resolves `granted: true`, the
 *      hook eventually settles with `canEdit: true`.
 *   2. When it resolves `granted: false`, the hook stays `canEdit: false`.
 *   3. When there's no signed-in user, the query is disabled (no fetch).
 */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCanEditBoards } from './use-can-edit-boards'

const checkPermissionMock = vi.fn()

vi.mock('@/lib/auth/auth-service', () => ({
  authService: {
    checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  },
}))

const useUnifiedAuthMock = vi.fn()
vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: () => useUnifiedAuthMock(),
}))

function wrap() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useCanEditBoards', () => {
  it('returns canEdit=true when auth-service grants the permission', async () => {
    useUnifiedAuthMock.mockReturnValue({
      authState: { user: { id: 'u-1' }, profile: null },
    })
    checkPermissionMock.mockResolvedValueOnce({ granted: true })

    const { result } = renderHook(() => useCanEditBoards(), { wrapper: wrap() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.canEdit).toBe(true)
    expect(checkPermissionMock).toHaveBeenCalledWith(
      'u-1',
      'production_boards',
      'edit'
    )
  })

  it('returns canEdit=false when the permission is not granted', async () => {
    useUnifiedAuthMock.mockReturnValue({
      authState: { user: { id: 'u-2' }, profile: null },
    })
    checkPermissionMock.mockResolvedValueOnce({ granted: false })

    const { result } = renderHook(() => useCanEditBoards(), { wrapper: wrap() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.canEdit).toBe(false)
  })

  it('does not call the auth service when there is no signed-in user', () => {
    useUnifiedAuthMock.mockReturnValue({
      authState: { user: null, profile: null },
    })
    checkPermissionMock.mockClear()

    const { result } = renderHook(() => useCanEditBoards(), { wrapper: wrap() })
    expect(result.current.canEdit).toBe(false)
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })
})

// Created and developed by Jai Singh
