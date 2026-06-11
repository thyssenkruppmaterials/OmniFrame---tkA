// Created and developed by Jai Singh
/**
 * Smoke test that exercises the regression fixed in v7: clicking the
 * `<BoardEditToggle>` must propagate to a *sibling* `useBoardEditMode`
 * consumer in the same render tree. Before v7, the toggle's
 * `replaceState` write didn't fire `popstate`, so sibling readers
 * stayed stuck at `editMode = false` even though the URL had flipped.
 *
 * The test mounts the toggle alongside a tiny `<EditModeProbe>` that
 * also calls `useBoardEditMode()` — exactly the topology of every
 * board's per-card pencil readers — and asserts the probe re-renders
 * after each click.
 */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBoardEditMode } from '../hooks/use-board-edit-mode'
import { BoardEditToggle } from './board-edit-toggle'

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

function EditModeProbe() {
  const [editMode] = useBoardEditMode()
  return (
    <div data-testid='probe-edit-mode'>{editMode ? 'editing' : 'idle'}</div>
  )
}

function wrap(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function resetUrl(): void {
  window.history.replaceState({}, '', '/')
}

function probeText(): string {
  return screen.getByTestId('probe-edit-mode').textContent ?? ''
}

beforeEach(() => {
  resetUrl()
  useUnifiedAuthMock.mockReturnValue({
    authState: { user: { id: 'u-1' }, profile: null },
  })
  checkPermissionMock.mockResolvedValue({ granted: true })
})

afterEach(() => {
  resetUrl()
  vi.clearAllMocks()
})

describe('<BoardEditToggle> + sibling useBoardEditMode consumer', () => {
  it('clicking the toggle propagates to a sibling reader (regression)', async () => {
    render(
      wrap(
        <>
          <BoardEditToggle />
          <EditModeProbe />
        </>
      )
    )

    expect(probeText()).toBe('idle')

    // The toggle is gated behind `useCanEditBoards()`, which is async.
    const toggle = await screen.findByRole('button', { name: /edit/i })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(toggle)

    await waitFor(() => {
      expect(probeText()).toBe('editing')
    })
    expect(window.location.search).toBe('?edit=1')

    // Toggling off should also propagate.
    const editingButton = await screen.findByRole('button', {
      name: /editing/i,
    })
    fireEvent.click(editingButton)

    await waitFor(() => {
      expect(probeText()).toBe('idle')
    })
    expect(window.location.search).toBe('')
  })

  it('renders nothing when the user lacks production_boards:edit', async () => {
    checkPermissionMock.mockReset()
    checkPermissionMock.mockResolvedValue({ granted: false })

    const { container } = render(
      wrap(
        <>
          <BoardEditToggle />
          <EditModeProbe />
        </>
      )
    )

    // Wait for the permission query to settle, then assert the toggle
    // is absent. The probe still renders, but stays at `idle`.
    await waitFor(() => {
      expect(checkPermissionMock).toHaveBeenCalledWith(
        'u-1',
        'production_boards',
        'edit'
      )
    })
    expect(container.querySelector('button[aria-pressed]')).toBeNull()
    expect(probeText()).toBe('idle')
  })
})

// Created and developed by Jai Singh
