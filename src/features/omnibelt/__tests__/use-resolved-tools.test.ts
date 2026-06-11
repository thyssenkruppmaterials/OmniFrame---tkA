// Created and developed by Jai Singh
/**
 * useResolvedTools — filter pipeline contract.
 *
 * Validates the four-stage filter and the pin-resolution fallback
 * documented in `tools/use-resolved-tools.ts`. The hook integrates
 * the bootstrap query, the per-user Zustand store and the global
 * permission store; we mock each at the module boundary so each
 * stage can be exercised in isolation.
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
import { usePermissionStore } from '@/stores/permissionStore'
import { useOmnibeltBootstrap } from '../hooks/useOmnibeltBootstrap'
import { useOmnibeltStore } from '../store/omnibeltStore'
import { TOOL_REGISTRY } from '../tools/registry'
import { useResolvedTools } from '../tools/use-resolved-tools'

// ---- Mocks declared BEFORE the SUT import ---------------------------------

vi.mock('../hooks/useOmnibeltBootstrap', () => ({
  useOmnibeltBootstrap: vi.fn(),
}))

vi.mock('../store/omnibeltStore', () => ({
  useOmnibeltStore: vi.fn(),
}))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: vi.fn(),
}))

const ALL_IDS = TOOL_REGISTRY.map((t) => t.id)

type StoreSlice = {
  pinnedToolIds: string[]
  hiddenToolIds: string[]
  toolOrder: string[]
}

type BootstrapSlice = {
  allow_list?: string[]
  role_config?: {
    default_tool_ids?: string[]
    default_pinned_ids?: string[]
  }
}

function setup({
  bootstrap = {},
  store = { pinnedToolIds: [], hiddenToolIds: [], toolOrder: [] },
  hasPermission = (_action: string, _resource: string) => true,
  lastLoadTime = 1,
}: {
  bootstrap?: BootstrapSlice
  store?: StoreSlice
  hasPermission?: (action: string, resource: string) => boolean
  lastLoadTime?: number
} = {}) {
  ;(useOmnibeltBootstrap as unknown as Mock).mockReturnValue({
    data: {
      allow_list: bootstrap.allow_list,
      role_config: bootstrap.role_config ?? null,
    },
  })
  ;(useOmnibeltStore as unknown as Mock).mockImplementation(
    (selector: (s: StoreSlice) => unknown) => selector(store)
  )
  ;(usePermissionStore as unknown as Mock).mockImplementation(
    (
      selector: (s: {
        hasPermission: typeof hasPermission
        lastLoadTime: number
      }) => unknown
    ) => selector({ hasPermission, lastLoadTime })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('useResolvedTools — unrestricted default', () => {
  it('returns every registry entry when bootstrap is empty and nothing is hidden', () => {
    setup()
    const { result } = renderHook(() => useResolvedTools())
    expect(result.current.all.map((t) => t.id)).toEqual(ALL_IDS)
    expect(result.current.filtered_count).toBe(0)
  })
})

describe('useResolvedTools — filter pipeline', () => {
  it('drops tools not in the org allow_list', () => {
    setup({ bootstrap: { allow_list: ['quick_note'] } })
    const { result } = renderHook(() => useResolvedTools())
    expect(result.current.all.map((t) => t.id)).toEqual(['quick_note'])
    expect(result.current.filtered_count).toBe(ALL_IDS.length - 1)
  })

  it('drops tools not in the role default_tool_ids', () => {
    setup({
      bootstrap: {
        role_config: { default_tool_ids: ['build_info'] },
      },
    })
    const { result } = renderHook(() => useResolvedTools())
    expect(result.current.all.map((t) => t.id)).toEqual(['build_info'])
  })

  it('drops tools the user has explicitly hidden', () => {
    setup({
      store: {
        pinnedToolIds: [],
        hiddenToolIds: ['build_info'],
        toolOrder: [],
      },
    })
    const { result } = renderHook(() => useResolvedTools())
    expect(result.current.all.map((t) => t.id)).not.toContain('build_info')
  })

  it('drops tools whose RBAC permission gate denies', () => {
    // P4 — the v1 roster ships with three permission-gated tools
    // (`quick_pick`, `sap_status`, `inventory_lookup`). A denying
    // `hasPermission` mock should drop exactly those three; the
    // remaining five ungated tools must stay visible so the launcher
    // is never empty for a freshly-onboarded user.
    const PERMISSIONED_IDS = TOOL_REGISTRY.filter((t) => t.permission).map(
      (t) => t.id
    )
    const UNGATED_IDS = TOOL_REGISTRY.filter((t) => !t.permission).map(
      (t) => t.id
    )
    expect(PERMISSIONED_IDS).toEqual([
      'quick_pick',
      'sap_status',
      'inventory_lookup',
    ])
    expect(UNGATED_IDS).toEqual([
      'background_jobs',
      'agent_chat',
      'quick_note',
      'build_info',
      'settings_shortcut',
      'help_docs',
    ])

    setup({ hasPermission: () => false })
    const { result } = renderHook(() => useResolvedTools())
    const survivingIds = result.current.all.map((t) => t.id)
    expect(survivingIds).toEqual(UNGATED_IDS)
    for (const blockedId of PERMISSIONED_IDS) {
      expect(survivingIds).not.toContain(blockedId)
    }
    expect(result.current.filtered_count).toBe(PERMISSIONED_IDS.length)
  })

  it('keeps permission-gated tools when hasPermission grants access', () => {
    // Symmetric case — explicit grants for the three v1 gated tools
    // means every registry entry survives the filter.
    setup({
      hasPermission: (action, resource) => {
        return (
          (action === 'view' && resource === 'outbound_apps') ||
          (action === 'manage' && resource === 'sap_testing') ||
          (action === 'view' && resource === 'inventory_apps')
        )
      },
    })
    const { result } = renderHook(() => useResolvedTools())
    expect(result.current.all.map((t) => t.id)).toEqual(ALL_IDS)
    expect(result.current.filtered_count).toBe(0)
  })
})

describe('useResolvedTools — pin resolution', () => {
  it('user pins override role defaults', () => {
    setup({
      bootstrap: {
        role_config: { default_pinned_ids: ['build_info'] },
      },
      store: {
        pinnedToolIds: ['quick_note'],
        hiddenToolIds: [],
        toolOrder: [],
      },
    })
    const { result } = renderHook(() => useResolvedTools())
    expect(result.current.pinned.map((t) => t.id)).toEqual(['quick_note'])
  })

  it('falls back to role default pins when the user has none', () => {
    setup({
      bootstrap: {
        role_config: { default_pinned_ids: ['build_info'] },
      },
    })
    const { result } = renderHook(() => useResolvedTools())
    expect(result.current.pinned.map((t) => t.id)).toEqual(['build_info'])
  })

  it('honours tool_order for the surviving `all` set', () => {
    setup({
      store: {
        pinnedToolIds: [],
        hiddenToolIds: [],
        toolOrder: ['quick_note', 'build_info'],
      },
    })
    const { result } = renderHook(() => useResolvedTools())
    const ids = result.current.all.map((t) => t.id)
    // The two ordered tools come first; remaining tools retain
    // their registry order (stable sort tail).
    expect(ids.slice(0, 2)).toEqual(['quick_note', 'build_info'])
    const tailExpected = ALL_IDS.filter(
      (id) => id !== 'quick_note' && id !== 'build_info'
    )
    expect(ids.slice(2)).toEqual(tailExpected)
  })
})

// Created and developed by Jai Singh
