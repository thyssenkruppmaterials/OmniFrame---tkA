// Created and developed by Jai Singh
import { createElement } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTabPermissions } from '@/hooks/useTabPermissions'

const mockLoadTabPermissions = vi.fn().mockResolvedValue(undefined)
const mockRefreshTabPermissions = vi.fn().mockResolvedValue(undefined)

const authState = {
  isAuthenticated: false,
  user: null as { id: string; email: string } | null,
  session: null,
  profile: null as { id: string; role_id: string } | null,
  isLoading: false,
  error: null,
  lastUpdate: 0,
}

const permissionStoreState = {
  tabPermissions: [] as Array<{
    page_resource: string
    tab_id: string
    tab_label: string
    granted: boolean
  }>,
  loadTabPermissions: mockLoadTabPermissions,
  refreshTabPermissions: mockRefreshTabPermissions,
  isTabLoading: false,
  error: null as string | null,
}

const navigationStoreState = {
  currentRoleName: null as string | null,
}

vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: vi.fn(() => ({
    authState,
    isLoading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    checkPermission: vi.fn(),
  })),
}))

vi.mock('@/stores/navigationStore', () => ({
  useNavigationStore: vi.fn(
    (selector?: (state: typeof navigationStoreState) => unknown) =>
      selector ? selector(navigationStoreState) : navigationStoreState
  ),
}))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: vi.fn(() => permissionStoreState),
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function HookProbe({
  pageResource = 'inventory_apps',
  autoLoad = true,
}: {
  pageResource?: string
  autoLoad?: boolean
}) {
  const { isLoading } = useTabPermissions(pageResource, autoLoad)

  return createElement(
    'div',
    { 'data-testid': 'tab-permission-state' },
    isLoading ? 'loading' : 'idle'
  )
}

describe('useTabPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.isAuthenticated = false
    authState.user = null
    authState.profile = null
    permissionStoreState.tabPermissions = []
    permissionStoreState.isTabLoading = false
    permissionStoreState.error = null
    navigationStoreState.currentRoleName = null
  })

  it('keeps tabs in loading state while auth is ready but the profile is still resolving', () => {
    authState.isAuthenticated = true
    authState.user = { id: 'user-1', email: 'test@example.com' }

    render(createElement(HookProbe))

    expect(screen.getByTestId('tab-permission-state').textContent).toBe(
      'loading'
    )
    expect(mockLoadTabPermissions).not.toHaveBeenCalled()
  })

  it('reloads tab permissions when the resolved role changes for the same user', async () => {
    authState.isAuthenticated = true
    authState.user = { id: 'user-1', email: 'test@example.com' }
    authState.profile = { id: 'user-1', role_id: 'role-1' }

    const { rerender } = render(createElement(HookProbe))

    await waitFor(() => {
      expect(mockLoadTabPermissions).toHaveBeenCalledWith(
        'user-1',
        'inventory_apps',
        false
      )
    })

    authState.profile = { id: 'user-1', role_id: 'role-2' }

    rerender(createElement(HookProbe))

    await waitFor(() => {
      expect(mockLoadTabPermissions).toHaveBeenCalledTimes(2)
    })
  })
})

// Created and developed by Jai Singh
