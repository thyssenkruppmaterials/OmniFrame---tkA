// Created and developed by Jai Singh
import { createElement, type ReactNode } from 'react'
import { PermissionProvider } from '@/providers/PermissionProvider'
import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockLoadPermissions = vi.fn().mockResolvedValue(undefined)
const mockClearPermissions = vi.fn()
const mockLoadTabPermissions = vi.fn().mockResolvedValue(undefined)
const mockClearTabPermissions = vi.fn()
const mockLoadNavigationPermissions = vi.fn().mockResolvedValue(undefined)
const mockClearNavigationPermissions = vi.fn()

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: Object.assign(
    vi.fn(() => ({
      loadPermissions: mockLoadPermissions,
      clearPermissions: mockClearPermissions,
      currentUserId: null as string | null,
      loadTabPermissions: mockLoadTabPermissions,
      clearTabPermissions: mockClearTabPermissions,
      permissions: [] as string[],
      isLoading: false,
    })),
    {
      getState: vi.fn(() => ({
        permissions: [] as string[],
        isLoading: false,
      })),
    }
  ),
}))

vi.mock('@/stores/navigationStore', () => ({
  useNavigationStore: Object.assign(
    vi.fn(() => ({
      loadNavigationPermissions: mockLoadNavigationPermissions,
      clearNavigationPermissions: mockClearNavigationPermissions,
      currentRole: null as string | null,
      navigationPermissions: [] as unknown[],
      isLoading: false,
    })),
    {
      getState: vi.fn(() => ({
        navigationPermissions: [] as unknown[],
        isLoading: false,
      })),
    }
  ),
}))

const mockAuthState = {
  isAuthenticated: false,
  user: null as { id: string; email: string } | null,
  profile: null as { id: string; role_id: string; role: string } | null,
  error: null,
  isLoading: false,
}

vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: vi.fn(() => ({
    authState: mockAuthState,
    isLoading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    checkPermission: vi.fn(),
  })),
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function TestWrapper({ children }: { children: ReactNode }) {
  return createElement(PermissionProvider, null, children)
}

describe('PermissionProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthState.isAuthenticated = false
    mockAuthState.user = null
    mockAuthState.profile = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads permissions once on authentication', async () => {
    mockAuthState.isAuthenticated = true
    mockAuthState.user = { id: 'user-1', email: 'test@example.com' }
    mockAuthState.profile = {
      id: 'user-1',
      role_id: 'role-uuid-123',
      role: 'admin',
    }

    render(
      createElement(TestWrapper, null, createElement('div', null, 'child'))
    )

    await waitFor(() => {
      expect(mockLoadPermissions).toHaveBeenCalledTimes(1)
      expect(mockLoadPermissions).toHaveBeenCalledWith('user-1', false)
    })
  })

  it('clears permissions on logout', async () => {
    mockAuthState.isAuthenticated = true
    mockAuthState.user = { id: 'user-1', email: 'test@example.com' }
    mockAuthState.profile = {
      id: 'user-1',
      role_id: 'role-uuid-123',
      role: 'admin',
    }

    const { rerender } = render(
      createElement(TestWrapper, null, createElement('div', null, 'child'))
    )

    vi.mocked(
      (await import('@/stores/permissionStore')).usePermissionStore
    ).mockReturnValue({
      loadPermissions: mockLoadPermissions,
      clearPermissions: mockClearPermissions,
      currentUserId: 'user-1',
      loadTabPermissions: mockLoadTabPermissions,
      clearTabPermissions: mockClearTabPermissions,
      permissions: ['admin:*'],
      isLoading: false,
    } as any)

    vi.mocked(
      (await import('@/stores/navigationStore')).useNavigationStore
    ).mockReturnValue({
      loadNavigationPermissions: mockLoadNavigationPermissions,
      clearNavigationPermissions: mockClearNavigationPermissions,
      currentRole: 'admin',
      navigationPermissions: [{ name: 'dashboard', visible: true }],
      isLoading: false,
    } as any)

    mockAuthState.isAuthenticated = false
    mockAuthState.user = null
    mockAuthState.profile = null

    rerender(
      createElement(TestWrapper, null, createElement('div', null, 'child'))
    )

    await waitFor(
      () => {
        expect(mockClearPermissions).toHaveBeenCalled()
      },
      { timeout: 2000 }
    )
  })

  it('does not double-load when user and role are already current', async () => {
    mockAuthState.isAuthenticated = true
    mockAuthState.user = { id: 'user-1', email: 'test@example.com' }
    mockAuthState.profile = {
      id: 'user-1',
      role_id: 'role-uuid-123',
      role: 'admin',
    }

    const { usePermissionStore } = await import('@/stores/permissionStore')
    const { useNavigationStore } = await import('@/stores/navigationStore')

    vi.mocked(usePermissionStore).mockReturnValue({
      loadPermissions: mockLoadPermissions,
      clearPermissions: mockClearPermissions,
      currentUserId: 'user-1',
      loadTabPermissions: mockLoadTabPermissions,
      clearTabPermissions: mockClearTabPermissions,
      permissions: ['admin:*'],
      isLoading: false,
    } as any)

    vi.mocked(usePermissionStore.getState as any).mockReturnValue({
      permissions: ['admin:*'],
      isLoading: false,
    })

    vi.mocked(useNavigationStore).mockReturnValue({
      loadNavigationPermissions: mockLoadNavigationPermissions,
      clearNavigationPermissions: mockClearNavigationPermissions,
      currentRole: 'role-uuid-123',
      navigationPermissions: [{ name: 'dashboard', visible: true }],
      isLoading: false,
    } as any)

    vi.mocked(useNavigationStore.getState as any).mockReturnValue({
      navigationPermissions: [{ name: 'dashboard', visible: true }],
      isLoading: false,
    })

    render(
      createElement(TestWrapper, null, createElement('div', null, 'child'))
    )

    await waitFor(() => {
      expect(mockLoadPermissions).not.toHaveBeenCalled()
    })
  })
})

// Created and developed by Jai Singh
