// Created and developed by Jai Singh
import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: vi.fn(() => ({
    authState: {
      isAuthenticated: true,
      user: { id: 'user-1', email: 'test@example.com' },
      profile: {
        id: 'user-1',
        full_name: 'Test User',
        first_name: 'Test',
        last_name: 'User',
        role: 'admin',
        role_id: 'role-uuid',
        organization_id: 'org-uuid',
      },
      error: null,
      isLoading: false,
    },
    isLoading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    checkPermission: vi.fn(),
  })),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => vi.fn()),
}))

vi.mock('@/context/theme-context', () => ({
  useTheme: vi.fn(() => ({
    theme: 'light',
    setTheme: vi.fn(),
  })),
}))

vi.mock('@/lib/supabase/hot-part-alert.service', () => ({
  hotPartAlertService: {
    checkForAlerts: vi.fn().mockResolvedValue({ alerts: [] }),
  },
  MATCH_TYPE_LABELS: {},
}))

vi.mock('@/lib/supabase/inbound-scans', () => ({
  InboundScanService: { createScan: vi.fn() },
}))

vi.mock('@/lib/utils/device-fingerprint', () => ({
  getDeviceRegistration: vi.fn().mockResolvedValue(null),
  parseDeviceInfo: vi
    .fn()
    .mockResolvedValue({ deviceType: 'Browser', isNativeApp: false }),
  updateDeviceName: vi.fn(),
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/work-service/websocket', () => ({
  workServiceWs: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendHeartbeat: vi.fn(),
  },
}))

vi.mock('@/hooks/use-pushed-work', () => ({
  usePushedWork: vi.fn(() => ({
    pushedCount: 0,
    newPushAlert: false,
  })),
  useWorkerHeartbeat: vi.fn(),
}))

vi.mock(
  '@/features/shift-productivity/team-performance/hooks/use-team-performance',
  () => ({
    useTeamPerformance: vi.fn(() => ({
      performanceData: null,
      isLoadingPerformance: false,
      refresh: vi.fn(),
    })),
  })
)

vi.mock(
  '@/features/shift-productivity/team-performance/components/activity-gantt',
  () => ({
    ActivityGantt: () =>
      createElement('div', { 'data-testid': 'activity-gantt' }),
    ActivityLegend: () =>
      createElement('div', { 'data-testid': 'activity-legend' }),
  })
)

vi.mock('@/components/ui/device-registration-dialog', () => ({
  DeviceRegistrationDialog: () => null,
  useDeviceRegistration: vi.fn(() => ({
    needsRegistration: false,
    setNeedsRegistration: vi.fn(),
  })),
}))

vi.mock('@/components/ui/rf-cycle-count-unified', () => ({
  RFCycleCountUnified: () => createElement('div', null, 'CycleCount'),
}))

vi.mock('@/components/error-boundaries/CycleCountErrorBoundary', () => ({
  CycleCountErrorBoundary: ({ children }: { children: React.ReactNode }) =>
    createElement('div', null, children),
}))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    createElement('div', null, children),
  motion: {
    div: ({ children, ...props }: any) =>
      createElement('div', { 'data-testid': props['data-testid'] }, children),
  },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn(), getUser: vi.fn() },
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(), single: vi.fn() })),
    })),
  },
}))

describe('RF Interface Shell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the RF menu when authenticated', async () => {
    const { default: RFInterface } =
      await import('@/features/rf-interface/rf-interface')

    render(createElement(RFInterface))

    expect(screen.getByText(/Welcome/i)).toBeDefined()
    expect(screen.getByText('Inbound Scanner')).toBeDefined()
    expect(screen.getByText('Put Away')).toBeDefined()
    expect(screen.getAllByText('Picking').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Cycle Count').length).toBeGreaterThan(0)
  }, 15000)
})

// Created and developed by Jai Singh
