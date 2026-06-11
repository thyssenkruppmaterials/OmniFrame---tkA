// Created and developed by Jai Singh
/**
 * RoleBeltEditor — verifies adding/removing tools + save flow.
 *
 * Doesn't exercise the drag-drop reorder (DnD-kit's PointerSensor
 * requires a real pointer event sequence that's painful in jsdom).
 * Covers:
 *   1. The save button stays disabled in the pristine state.
 *   2. Toggling a tool's pinned checkbox dirties the form.
 *   3. Clicking save invokes the mutation with the expected payload.
 *   4. Cancel resets the draft back to the initial state.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TOOL_REGISTRY } from '@/features/omnibelt/tools/registry'
import { RoleBeltEditor } from '../components/RoleBeltEditor'

const mutateMock = vi.fn()
vi.mock('../hooks/useUpdateRoleConfig', () => ({
  useUpdateRoleConfig: () => ({
    mutate: (...args: unknown[]) => mutateMock(...args),
    isPending: false,
    error: null,
  }),
}))

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <RoleBeltEditor
        role={{ id: 'role-admin', name: 'admin', display_name: 'Admin' }}
        config={null}
        allowList={null}
      />
    </QueryClientProvider>
  )
}

describe('RoleBeltEditor', () => {
  it('renders header with role name', () => {
    renderEditor()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('renders the full registry tool count in the badge', () => {
    renderEditor()
    expect(
      screen.getByText(new RegExp(`${TOOL_REGISTRY.length} tools`))
    ).toBeInTheDocument()
  })

  it('save is disabled until the draft diverges from initial', () => {
    renderEditor()
    const save = screen.getByRole('button', { name: /save belt/i })
    expect(save).toBeDisabled()
  })

  it('toggling a pinned checkbox dirties the form and save fires mutation', () => {
    renderEditor()
    const checkboxes = screen.getAllByRole('checkbox')
    // First tool's pinned checkbox
    expect(checkboxes.length).toBeGreaterThan(0)

    fireEvent.click(checkboxes[0])

    const save = screen.getByRole('button', { name: /save belt/i })
    expect(save).toBeEnabled()

    fireEvent.click(save)
    expect(mutateMock).toHaveBeenCalledTimes(1)
    const payload = mutateMock.mock.calls[0]?.[0] as {
      role_id: string
      default_skin: string
      default_pinned_ids: string[]
      default_tool_ids: string[]
    }
    expect(payload.role_id).toBe('role-admin')
    expect(payload.default_skin).toBe('pill')
    expect(Array.isArray(payload.default_tool_ids)).toBe(true)
    expect(Array.isArray(payload.default_pinned_ids)).toBe(true)
  })

  it('Cancel resets the draft and disables save', () => {
    renderEditor()
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])
    const save = screen.getByRole('button', { name: /save belt/i })
    expect(save).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(save).toBeDisabled()
  })
})

// Created and developed by Jai Singh
