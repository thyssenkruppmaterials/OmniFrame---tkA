// Created and developed by Jai Singh
import { createElement } from 'react'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TabMenu } from '@/components/ui/tab-menu'

const mockUseTabPermissions = vi.fn((..._args: unknown[]) => ({
  allowedTabs: [],
  hasTabAccess: vi.fn(() => true),
  isLoading: false,
  error: null,
  loadTabPermissions: vi.fn(),
  refreshTabPermissions: vi.fn(),
}))

vi.mock('@/hooks/useTabPermissions', () => ({
  useTabPermissions: (...args: unknown[]) => mockUseTabPermissions(...args),
}))

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

describe('TabMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  it('auto-loads permissions when a page resource is provided', () => {
    render(
      createElement(TabMenu, {
        tabs: [{ id: 'overview', label: 'Overview' }],
        activeTab: 'overview',
        pageResource: 'inventory_apps',
      })
    )

    expect(mockUseTabPermissions).toHaveBeenCalledWith('inventory_apps', true)
  })
})

// Created and developed by Jai Singh
