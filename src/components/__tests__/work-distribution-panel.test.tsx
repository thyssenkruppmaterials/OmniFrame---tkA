// Created and developed by Jai Singh
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkDistributionPanel } from '@/components/work-distribution-panel'

const mockPushToUser = vi.fn()

vi.mock('@/hooks/use-active-workers', () => ({
  useActiveWorkers: () => ({
    workers: [
      {
        user_id: 'worker-1',
        full_name: 'Jai Singh',
        email: 'jai@example.com',
        status: 'busy',
        current_task_id: 'task-1',
        current_task_type: 'cycle_count',
        current_zone: 'E4-51-99-1',
        current_location: 'E4-51-99-1',
        last_heartbeat: new Date().toISOString(),
      },
    ],
    onlineCount: 1,
    busyCount: 1,
    idleCount: 0,
    offlineCount: 0,
    breakCount: 0,
    refreshWorkers: vi.fn(),
    isLoading: false,
    error: null,
    isWsConnected: false,
  }),
}))

vi.mock('@/hooks/use-work-queue', () => ({
  useWorkQueue: () => ({
    queue: [],
    stats: undefined,
    isLoading: false,
    isStatsLoading: false,
    error: null,
    statsError: null,
    claimNext: vi.fn(),
    pushToUser: mockPushToUser,
    refreshQueue: vi.fn(),
    startTask: vi.fn(),
    completeTask: vi.fn(),
    releaseTask: vi.fn(),
    acknowledgePush: vi.fn(),
    isClaimPending: false,
    isPushPending: false,
    isStartPending: false,
    isCompletePending: false,
    isReleasePending: false,
    isAcknowledgePending: false,
  }),
}))

vi.mock('@/lib/work-service/client', () => ({
  workServiceClient: {
    releaseTask: vi.fn(),
  },
}))

describe('WorkDistributionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a collision warning when selected worker is already busy in the same aisle', () => {
    render(
      <WorkDistributionPanel
        selectedCounts={[
          {
            id: 'count-1',
            count_number: 'CC-001',
            location: 'E4-51-01-4',
            priority: 'normal',
            resolved_aisle: 'E4-51',
          } as any,
        ]}
        onPushComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('Jai Singh'))

    expect(screen.getByText('Aisle collision risk')).not.toBeNull()
    expect(screen.getByText(/already active in aisle E4-51/i)).not.toBeNull()
    expect(
      screen.getByRole('button', { name: /override and push anyway/i })
    ).not.toBeNull()
  })
})

// Created and developed by Jai Singh
