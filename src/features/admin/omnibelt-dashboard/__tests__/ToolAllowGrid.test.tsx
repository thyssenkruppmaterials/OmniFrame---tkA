// Created and developed by Jai Singh
/**
 * ToolAllowGrid — checkbox toggling + save flow.
 *
 * Mounts the grid, toggles a checkbox, and verifies the mutation
 * is invoked with the correct allow-list array.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TOOL_REGISTRY } from '@/features/omnibelt/tools/registry'
import { ToolAllowGrid } from '../components/ToolAllowGrid'

// Mock the prefs aggregate hook used inside the grid.
vi.mock('../hooks/useUsageStats', () => ({
  usePrefsAggregate: () => ({
    data: { pinned: {}, skinDistribution: {}, mach3Distribution: {} },
  }),
}))

const mutateMock = vi.fn()
vi.mock('../hooks/useUpdateAllowList', () => ({
  useUpdateAllowList: () => ({
    mutate: (...args: unknown[]) => mutateMock(...args),
    isPending: false,
    error: null,
  }),
}))

function renderWith(allowList: string[] | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToolAllowGrid allowList={allowList} />
    </QueryClientProvider>
  )
}

describe('ToolAllowGrid', () => {
  it('renders all registry tools', () => {
    renderWith(null)
    for (const tool of TOOL_REGISTRY) {
      expect(screen.getByText(tool.label)).toBeInTheDocument()
    }
  })

  it('initializes every checkbox checked when allowList is null', () => {
    renderWith(null)
    const checkboxes = screen.getAllByRole('checkbox')
    for (const cb of checkboxes) {
      expect(cb).toHaveAttribute('data-state', 'checked')
    }
  })

  it('initializes only listed tools when allowList is non-null', () => {
    if (TOOL_REGISTRY.length < 2) return
    const allowedId = TOOL_REGISTRY[0].id
    const disallowedTool = TOOL_REGISTRY[1]
    renderWith([allowedId])

    // Find checkboxes by their aria-label which mirrors the tool label.
    const allowedCb = screen.getByLabelText(
      new RegExp(`Allow ${TOOL_REGISTRY[0].label}`, 'i')
    )
    const disallowedCb = screen.getByLabelText(
      new RegExp(`Allow ${disallowedTool.label}`, 'i')
    )
    expect(allowedCb).toHaveAttribute('data-state', 'checked')
    expect(disallowedCb).toHaveAttribute('data-state', 'unchecked')
  })

  it('save button stays disabled until a checkbox toggles', () => {
    renderWith(null)
    const save = screen.getByRole('button', { name: /save allow-list/i })
    expect(save).toBeDisabled()

    // Toggle the first registry tool's checkbox via aria-label
    const cb = screen.getByLabelText(
      new RegExp(`Allow ${TOOL_REGISTRY[0].label}`, 'i')
    )
    fireEvent.click(cb)

    expect(save).toBeEnabled()
  })

  it('save invokes mutate with the remaining tool ids', () => {
    renderWith(null)
    const cb = screen.getByLabelText(
      new RegExp(`Allow ${TOOL_REGISTRY[0].label}`, 'i')
    )
    fireEvent.click(cb)

    fireEvent.click(screen.getByRole('button', { name: /save allow-list/i }))

    expect(mutateMock).toHaveBeenCalledTimes(1)
    const argIds = mutateMock.mock.calls[0]?.[0] as string[]
    expect(Array.isArray(argIds)).toBe(true)
    expect(argIds).not.toContain(TOOL_REGISTRY[0].id)
    if (TOOL_REGISTRY.length > 1) {
      expect(argIds).toContain(TOOL_REGISTRY[1].id)
    }
  })
})

// Created and developed by Jai Singh
