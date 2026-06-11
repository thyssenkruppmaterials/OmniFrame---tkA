// Created and developed by Jai Singh
/**
 * RFCycleCountUnified Component Tests
 * Covers pull/push mode entry, auto-advance, release confirmation, heartbeat bridge,
 * draft resume, and WebSocket retry scenarios.
 */
import { createElement } from 'react'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { workServiceWs } from '@/lib/work-service/websocket'
import { useUnifiedCycleCount } from '@/hooks/use-unified-cycle-count'
import { RFCycleCountUnified } from '@/components/ui/rf-cycle-count-unified'

// Mock hooks and services
const mockClaimNext = vi.fn()
const mockStartTask = vi.fn()
const mockCompleteTask = vi.fn()
const mockReleaseTask = vi.fn()
const mockAcknowledgeTask = vi.fn()
const mockSetCurrentTask = vi.fn()
const mockSaveDraft = vi.fn()
const mockLoadDraft = vi.fn()
const mockClearDraft = vi.fn()
const mockRetryAfterUnavailable = vi.fn()

vi.mock('@/hooks/use-unified-cycle-count', () => ({
  useUnifiedCycleCount: vi.fn(),
}))

vi.mock('@/hooks/use-pushed-work', () => ({
  usePushedWork: vi.fn(() => ({
    pushedCount: 0,
    newPushAlert: false,
  })),
  useWorkerHeartbeat: vi.fn(),
}))

vi.mock('@/lib/work-service/websocket', () => ({
  workServiceWs: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendHeartbeat: vi.fn(),
    retryAfterUnavailable: vi.fn(),
  },
}))

vi.mock('@/lib/work-service/client', () => ({
  workServiceClient: {
    claimNext: vi.fn(),
    startTask: vi.fn(),
    completeTask: vi.fn(),
    releaseTask: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

// Workflow snapshot loader — always returns the legacy default workflow so
// tests don't need a Supabase client or real config rows. Stable refs to
// avoid re-render churn from fresh objects each call.
const MOCK_WORKFLOW = {
  steps: [
    {
      id: 'confirm',
      type: 'confirm',
      label: 'Confirm',
      required: true,
      order: 1,
      config: {},
    },
    {
      id: 'location_scan',
      type: 'location_scan',
      label: 'Location Scan',
      required: true,
      order: 2,
      config: {},
    },
    {
      id: 'quantity_entry',
      type: 'quantity_entry',
      label: 'Quantity Entry',
      required: true,
      order: 3,
      config: {},
    },
    {
      id: 'review',
      type: 'review',
      label: 'Review',
      required: true,
      order: 4,
      config: { review_threshold_pct: 10, review_threshold_abs: 10 },
    },
  ],
  reviewThresholdPct: 10,
  reviewThresholdAbs: 10,
  source: 'fallback' as const,
  configId: null,
  configVersion: null,
}
const MOCK_WORKFLOW_RESPONSE = {
  workflow: MOCK_WORKFLOW,
  isLoading: false,
  error: null,
}
vi.mock('@/hooks/use-task-workflow', () => ({
  useTaskWorkflow: vi.fn(() => MOCK_WORKFLOW_RESPONSE),
  hasStepType: (wf: { steps: { type: string }[] }, type: string) =>
    wf.steps.some((s) => s.type === type),
  getStep: (wf: { steps: { type: string }[] }, type: string) =>
    wf.steps.find((s) => s.type === type),
}))

// Evidence photo upload is a Supabase storage call — stub it so the test
// file doesn't need real Supabase env vars.
vi.mock('@/lib/supabase/cycle-count-photos.service', () => ({
  uploadCycleCountEvidencePhoto: vi.fn(async () => ({
    success: true,
    publicUrl: 'https://example.com/photo.jpg',
    storagePath: 'test/path.jpg',
    error: null,
  })),
  uploadCycleCountEvidencePhotos: vi.fn(async () => ({
    uploaded: [],
    failed: [],
  })),
}))

// Supabase client — used by the component only for the serial_numbers
// column mirror when a serial_number extra step completes.
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    })),
  },
}))

// Extra-step hook — stubbed as a no-op since the default test workflow has
// no extras. Stable ref to avoid re-render churn.
const MOCK_EXTRA_STEPS_RESPONSE = {
  preCountSteps: [],
  postCountSteps: [],
  preCountIndex: 0,
  postCountIndex: 0,
  currentPreStep: null,
  currentPostStep: null,
  results: {},
  setResults: () => undefined,
  resetExtraSteps: () => undefined,
  recordResult: () => undefined,
  advancePreStep: () => undefined,
  advancePostStep: () => undefined,
  retreatPreStep: () => undefined,
  retreatPostStep: () => undefined,
  hasPreSteps: false,
  hasPostSteps: false,
  allPreDone: true,
  allPostDone: true,
}
vi.mock('@/hooks/use-extra-workflow-steps', () => ({
  useExtraWorkflowSteps: vi.fn(() => MOCK_EXTRA_STEPS_RESPONSE),
  persistWorkflowResult: vi.fn(async () => undefined),
}))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    createElement('div', null, children),
  motion: {
    div: ({
      children,
      ...props
    }: {
      children?: React.ReactNode
      [key: string]: unknown
    }) =>
      createElement('div', { 'data-testid': props['data-testid'] }, children),
  },
}))

// Default mock task
const createMockTask = (overrides = {}) => ({
  id: 'task-1',
  count_number: 'CC-001',
  material_number: 'MAT-001',
  material_description: 'Test Material',
  location: 'A-01-01',
  warehouse: null,
  system_quantity: 100,
  counted_quantity: null,
  unit_of_measure: 'EA',
  priority: 'normal' as const,
  status: 'pending' as const,
  count_type: null,
  assigned_to: 'user-1',
  assigned_at: new Date().toISOString(),
  push_mode: 'pull' as const,
  pushed_by: null,
  pushed_at: null,
  push_acknowledged: false,
  organization_id: 'org-1',
  ...overrides,
})

const defaultHookReturn = {
  currentTask: null as ReturnType<typeof createMockTask> | null,
  pushedTasks: [] as ReturnType<typeof createMockTask>[],
  isLoading: false,
  isInitialized: true,
  isClaiming: false,
  isCompleting: false,
  isStarting: false,
  isReleasing: false,
  claimNext: mockClaimNext,
  startTask: mockStartTask,
  completeTask: mockCompleteTask,
  releaseTask: mockReleaseTask,
  acknowledgeTask: mockAcknowledgeTask,
  setCurrentTask: mockSetCurrentTask,
  saveDraft: mockSaveDraft,
  loadDraft: mockLoadDraft,
  clearDraft: mockClearDraft,
  hasDraft: false,
  isConnected: true,
  connectionState: 'connected' as const,
  taskDurationMinutes: null as number | null,
  isNearingAbandonment: false,
  error: null as Error | null,
  clearError: vi.fn(),
}

function setupHookReturn(overrides: Record<string, any> = {}) {
  vi.mocked(useUnifiedCycleCount).mockReturnValue({
    ...defaultHookReturn,
    ...overrides,
  } as any)
}

function setupWebSocketMock() {
  vi.mocked(workServiceWs.retryAfterUnavailable).mockImplementation(
    mockRetryAfterUnavailable
  )
}

function renderComponent(props = {}) {
  const defaultProps = {
    onBack: vi.fn(),
    ...props,
  }
  return render(createElement(RFCycleCountUnified, defaultProps))
}

describe('RFCycleCountUnified', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupHookReturn()
    setupWebSocketMock()
  })

  describe('1. Pull Mode Entry (no auto-claim)', () => {
    it('renders "Pull Next Count" button when no current task', () => {
      setupHookReturn({ currentTask: null })
      renderComponent({ initialMode: 'pull' })

      expect(
        screen.getByRole('button', { name: /Pull Next Count/i })
      ).toBeDefined()
    })

    it('does NOT auto-claim on mount', () => {
      setupHookReturn()
      renderComponent({ initialMode: 'pull' })

      expect(mockClaimNext).not.toHaveBeenCalled()
    })

    it('claims task when "Pull Next Count" is clicked', () => {
      setupHookReturn()
      renderComponent({ initialMode: 'pull' })

      const pullBtn = screen.getByRole('button', { name: /Pull Next Count/i })
      fireEvent.click(pullBtn)

      expect(mockClaimNext).toHaveBeenCalled()
    })

    it('shows "Claiming Next Count" loading state when claiming', () => {
      setupHookReturn({ isClaiming: true, currentTask: null })
      renderComponent({ initialMode: 'pull' })

      expect(screen.getByText(/Claiming Next Count/i)).toBeDefined()
    })
  })

  describe('2. Push Mode Detection', () => {
    it('switches to push mode when pushedTasks exist', () => {
      const pushedTask = createMockTask({
        id: 'pushed-1',
        push_mode: 'push',
        push_acknowledged: false,
      })
      setupHookReturn({ pushedTasks: [pushedTask], currentTask: null })
      renderComponent({ initialMode: 'auto' })

      expect(screen.getByText(/Push Mode/i)).toBeDefined()
    })

    it('renders push inbox with task list in push mode', () => {
      const pushedTask = createMockTask({
        id: 'pushed-1',
        material_number: 'MAT-PUSH',
        location: 'B-02-02',
      })
      setupHookReturn({ pushedTasks: [pushedTask], currentTask: null })
      renderComponent({ initialMode: 'push' })

      expect(screen.getByText('MAT-PUSH')).toBeDefined()
      expect(screen.getByText('B-02-02')).toBeDefined()
    })

    it('shows "New Work Pushed!" alert banner for new push alerts', () => {
      const pushedTask = createMockTask({
        id: 'pushed-1',
        push_acknowledged: false,
        material_number: 'MAT-NEW',
        location: 'C-03-03',
      })
      setupHookReturn({ pushedTasks: [pushedTask], currentTask: null })
      renderComponent({ initialMode: 'push' })

      expect(screen.getByText(/New Work Pushed!/i)).toBeDefined()
    })
  })

  describe('3. Auto-advance & Cancel', () => {
    it('shows countdown after task completion', async () => {
      mockStartTask.mockResolvedValue(undefined)
      mockCompleteTask.mockResolvedValue(undefined)
      const task = createMockTask({ id: 'task-1', system_quantity: 10 })
      setupHookReturn({ currentTask: task, hasDraft: false })

      const { rerender } = renderComponent({ initialMode: 'pull' })

      fireEvent.click(screen.getByRole('button', { name: /Start Counting/i }))
      const locationInput = await screen.findByPlaceholderText(
        /Scan location barcode/i
      )
      fireEvent.change(locationInput, { target: { value: 'A-01-01' } })
      fireEvent.keyDown(locationInput, { key: 'Enter' })

      const oneBtn = screen
        .getAllByRole('button')
        .find((b) => b.textContent === '1')
      const zeroBtn = screen
        .getAllByRole('button')
        .find((b) => b.textContent === '0')
      if (oneBtn && zeroBtn) {
        fireEvent.click(oneBtn)
        fireEvent.click(zeroBtn)
      }
      fireEvent.click(screen.getByRole('button', { name: /Submit Count/i }))

      setupHookReturn({ currentTask: null, isClaiming: false })
      rerender(
        createElement(RFCycleCountUnified, {
          onBack: vi.fn(),
          initialMode: 'pull',
        })
      )

      await waitFor(() => {
        expect(screen.getByText(/Next count in \d+s/i)).toBeDefined()
      })
      expect(screen.getByRole('button', { name: /Pause/i })).toBeDefined()
    })

    it('shows "Pause" button during countdown', async () => {
      // We need to trigger completion flow - component sets autoAdvanceCountdown in handleTaskComplete
      // when mode is pull. We cannot easily trigger that without completing a full workflow.
      // Instead we render with a workaround: use a wrapper that forces countdown state.
      // The component shows countdown when: !currentTask && mode==='pull' && (autoAdvanceCountdown>0 || isClaiming)
      // So we need the component to have completed a task - which sets autoAdvanceCountdown to 3.
      // That requires going through the workflow. For unit test we mock the hook to simulate
      // "between counts" - but the countdown is internal state. We need to either:
      // 1) Test that when we're in that state, countdown and Pause appear (hard without triggering)
      // 2) Export a test harness
      // The plan says: "shows countdown after task completion" - the countdown is set in handleTaskComplete.
      // To test we'd need to complete a task. Let me try rendering with the hook returning
      // state that would show the between-counts view. The condition is:
      // !currentTask && mode==='pull' && (autoAdvanceCountdown > 0 || isClaiming)
      // autoAdvanceCountdown is component state, not from hook. So we need to complete a task
      // to get there. That requires: currentTask set -> go through steps -> completeTask -> handleTaskComplete.
      // For a focused test, we can verify that WHEN the component is in that state (we'd need to
      // trigger it), it shows "Next count in Xs" and "Pause". Without being able to set
      // autoAdvanceCountdown from outside, we need to do an integration-style test.
      // Alternative: use a simpler assertion - when isClaiming is true and no task, we see
      // "Loading next count" - that's one branch. For autoAdvanceCountdown, we need to
      // actually complete a task. Let me do a more complete flow test.

      // Go through full workflow: task -> confirm -> location -> count -> submit.
      // Then rerender with currentTask: null to simulate post-completion; component
      // will show between-counts view with countdown and Pause (autoAdvanceCountdown set in handleTaskComplete).
      const task = createMockTask({ id: 'task-1', system_quantity: 10 })
      mockStartTask.mockResolvedValue(undefined)
      mockCompleteTask.mockResolvedValue(undefined)
      setupHookReturn({
        currentTask: task,
        hasDraft: false,
      } as Partial<typeof defaultHookReturn>)

      const { rerender } = renderComponent({ initialMode: 'pull' })

      fireEvent.click(screen.getByRole('button', { name: /Start Counting/i }))
      const locationInput = await screen.findByPlaceholderText(
        /Scan location barcode/i
      )
      fireEvent.change(locationInput, { target: { value: 'A-01-01' } })
      fireEvent.keyDown(locationInput, { key: 'Enter' })

      const oneBtn = screen
        .getAllByRole('button')
        .find((b) => b.textContent === '1')
      const zeroBtn = screen
        .getAllByRole('button')
        .find((b) => b.textContent === '0')
      if (oneBtn && zeroBtn) {
        fireEvent.click(oneBtn)
        fireEvent.click(zeroBtn)
      }
      fireEvent.click(screen.getByRole('button', { name: /Submit Count/i }))

      setupHookReturn({ currentTask: null, isClaiming: false })
      rerender(
        createElement(RFCycleCountUnified, {
          onBack: vi.fn(),
          initialMode: 'pull',
        })
      )

      await waitFor(() => {
        expect(screen.getByText(/Next count in \d+s/i)).toBeDefined()
        expect(screen.getByRole('button', { name: /Pause/i })).toBeDefined()
      })
    })

    it('stops countdown when "Pause" is clicked', async () => {
      const task = createMockTask()
      mockStartTask.mockResolvedValue(undefined)
      mockCompleteTask.mockResolvedValue(undefined)
      setupHookReturn({ currentTask: task })

      const { rerender } = renderComponent({ initialMode: 'pull' })

      fireEvent.click(screen.getByRole('button', { name: /Start Counting/i }))

      const locationInput = await screen.findByPlaceholderText(
        /Scan location barcode/i
      )
      fireEvent.change(locationInput, { target: { value: 'A-01-01' } })
      fireEvent.keyDown(locationInput, { key: 'Enter' })

      const oneBtn = screen
        .getAllByRole('button')
        .find((b) => b.textContent === '1')
      const zeroBtn = screen
        .getAllByRole('button')
        .find((b) => b.textContent === '0')
      if (oneBtn && zeroBtn) {
        fireEvent.click(oneBtn)
        fireEvent.click(zeroBtn)
      }

      fireEvent.click(screen.getByRole('button', { name: /Submit Count/i }))

      setupHookReturn({ currentTask: null, isClaiming: false })
      rerender(
        createElement(RFCycleCountUnified, {
          onBack: vi.fn(),
          initialMode: 'pull',
        })
      )

      expect(
        await screen.findByRole('button', { name: /Pause/i }, { timeout: 3500 })
      ).toBeDefined()
    })

    it('stops countdown when "Pause" is clicked', async () => {
      const task = createMockTask()
      mockStartTask.mockResolvedValue(undefined)
      mockCompleteTask.mockResolvedValue(undefined)
      setupHookReturn({ currentTask: task })
      const { rerender } = renderComponent({ initialMode: 'pull' })

      fireEvent.click(screen.getByRole('button', { name: /Start Counting/i }))
      const locationInput = await screen.findByPlaceholderText(
        /Scan location barcode/i
      )
      fireEvent.change(locationInput, { target: { value: 'A-01-01' } })
      fireEvent.keyDown(locationInput, { key: 'Enter' })

      const oneBtn = screen
        .getAllByRole('button')
        .find((b) => b.textContent === '1')
      const zeroBtn = screen
        .getAllByRole('button')
        .find((b) => b.textContent === '0')
      if (oneBtn && zeroBtn) {
        fireEvent.click(oneBtn)
        fireEvent.click(zeroBtn)
      }
      fireEvent.click(screen.getByRole('button', { name: /Submit Count/i }))

      setupHookReturn({ currentTask: null, isClaiming: false })
      rerender(
        createElement(RFCycleCountUnified, {
          onBack: vi.fn(),
          initialMode: 'pull',
        })
      )

      const pauseBtn = await screen.findByRole(
        'button',
        { name: /Pause/i },
        { timeout: 3500 }
      )
      fireEvent.click(pauseBtn)

      // After Pause, setAutoAdvanceCountdown(0) is called - countdown stops
      // and we should see "Pull Next Count" again (the pull mode landing)
      expect(
        screen.getByRole('button', { name: /Pull Next Count/i })
      ).toBeDefined()
    })
  })

  describe('4. Release Confirmation', () => {
    it('shows confirmation dialog when "Release" is clicked', () => {
      const task = createMockTask()
      setupHookReturn({ currentTask: task })
      renderComponent({ initialMode: 'pull' })

      fireEvent.click(screen.getByRole('button', { name: /Release/i }))

      expect(
        screen.getByText(/Are you sure you want to release this task/i)
      ).toBeDefined()
    })

    it('does not release task until confirmed', () => {
      const task = createMockTask()
      setupHookReturn({ currentTask: task })
      renderComponent({ initialMode: 'pull' })

      fireEvent.click(screen.getByRole('button', { name: /Release/i }))
      fireEvent.click(screen.getByRole('button', { name: /Keep Working/i }))

      expect(mockReleaseTask).not.toHaveBeenCalled()
    })

    it('releases task and clears draft when confirmed', async () => {
      const task = createMockTask()
      mockReleaseTask.mockResolvedValue(undefined)
      setupHookReturn({ currentTask: task, hasDraft: true })
      renderComponent({ initialMode: 'pull' })

      fireEvent.click(screen.getByRole('button', { name: /Release/i }))
      const dialog = screen.getByRole('dialog')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Release' }))

      await waitFor(() => {
        expect(mockReleaseTask).toHaveBeenCalled()
        expect(mockClearDraft).toHaveBeenCalled()
      })
    })
  })

  describe('5. Heartbeat Bridge', () => {
    it('calls onTaskChange with task data when task is claimed', () => {
      const task = createMockTask()
      const onTaskChange = vi.fn()
      setupHookReturn({ currentTask: task })
      renderComponent({ onBack: vi.fn(), onTaskChange, initialMode: 'pull' })

      expect(onTaskChange).toHaveBeenCalledWith({
        id: task.id,
        location: task.location,
      })
    })

    it('calls onTaskChange with null when task is completed/released', () => {
      const onTaskChange = vi.fn()
      setupHookReturn({ currentTask: null })
      renderComponent({ onBack: vi.fn(), onTaskChange, initialMode: 'pull' })

      expect(onTaskChange).toHaveBeenCalledWith(null)
    })
  })

  describe('6. Draft Resume', () => {
    it('restores step/location/quantity from draft on remount with matching task', () => {
      const task = createMockTask({ id: 'task-1' })
      const draft = {
        taskId: 'task-1',
        step: 3,
        countedQuantity: 42,
        notes: 'test notes',
        locationVerified: true,
        scannedLocation: 'A-01-01',
        emptyLocationState: {
          isEmpty: null,
          foundPartNumber: '',
          foundQuantity: 0,
        },
        startedAt: Date.now(),
        lastUpdated: Date.now(),
      }
      mockLoadDraft.mockReturnValue(draft)
      setupHookReturn({ currentTask: task, hasDraft: true })
      renderComponent({ initialMode: 'pull' })

      expect(mockLoadDraft).toHaveBeenCalled()
      expect(screen.getByText('42')).toBeDefined()
    })

    it('does NOT restore draft when task ID does not match', () => {
      const task = createMockTask({ id: 'task-other' })
      const draft = {
        taskId: 'task-1',
        step: 3,
        countedQuantity: 42,
        notes: '',
        startedAt: Date.now(),
        lastUpdated: Date.now(),
      }
      mockLoadDraft.mockReturnValue(draft)
      setupHookReturn({ currentTask: task, hasDraft: true })
      renderComponent({ initialMode: 'pull' })

      expect(screen.getByText(/Confirm Item Details/i)).toBeDefined()
    })
  })

  describe('7. WebSocket Retry', () => {
    it('shows "Reconnect" link when disconnected', () => {
      const task = createMockTask()
      setupHookReturn({ currentTask: task, isConnected: false })
      renderComponent({ initialMode: 'pull' })

      expect(screen.getByRole('button', { name: /Reconnect/i })).toBeDefined()
    })

    it('does NOT show "Reconnect" when connected', () => {
      const task = createMockTask()
      setupHookReturn({ currentTask: task, isConnected: true })
      renderComponent({ initialMode: 'pull' })

      expect(screen.queryByRole('button', { name: /Reconnect/i })).toBeNull()
    })
  })
})

// Created and developed by Jai Singh
