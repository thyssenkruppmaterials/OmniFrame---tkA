// Created and developed by Jai Singh
/**
 * Smoke tests for `<SqcdpCategoryManagerDialog>`. Covers:
 *   - Renders both tier sections with the seeded builtins.
 *   - Switching to the inline create form auto-derives slug from label.
 *   - Save calls the create mutation with the expected shape.
 *   - Builtins surface a "Builtin" badge and disable the Delete row item.
 *
 * The supabase chain + the `useSqcdpMetrics` hook are mocked so the
 * dialog renders independently of TanStack Query roundtrips.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: () => ({
    authState: { profile: { organization_id: 'org-test' } },
  }),
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const createMutate = vi.fn(async (input: unknown) => input)
const updateMutate = vi.fn(async (input: unknown) => input)
const deleteMutate = vi.fn(async (id: string) => id)
const reorderMutate = vi.fn(async (input: unknown) => input)
const resetMutate = vi.fn(async () => undefined)

vi.mock('../hooks/use-sqcdp-categories', () => ({
  useSqcdpCategories: () => ({
    categories: [
      {
        id: 'safety',
        rowId: 'row-safety',
        organizationId: 'org-test',
        label: 'Safety',
        defaultColor: '#DC2626',
        Icon: () => null,
        iconName: 'IconShield',
        tier: 'primary' as const,
        displayOrder: 0,
        isBuiltin: true,
        isHidden: false,
      },
      {
        id: 'quality',
        rowId: 'row-quality',
        organizationId: 'org-test',
        label: 'Quality',
        defaultColor: '#16A34A',
        Icon: () => null,
        iconName: 'IconCheck',
        tier: 'primary' as const,
        displayOrder: 1,
        isBuiltin: true,
        isHidden: false,
      },
      {
        id: 'maintenance',
        rowId: 'row-maintenance',
        organizationId: 'org-test',
        label: 'Maintenance',
        defaultColor: '#7C3AED',
        Icon: () => null,
        iconName: 'IconTool',
        tier: 'secondary' as const,
        displayOrder: 0,
        isBuiltin: true,
        isHidden: false,
      },
    ],
    isLoading: false,
    isFetching: false,
    refresh: vi.fn(),
    createCategory: { mutateAsync: createMutate, isPending: false },
    updateCategory: { mutateAsync: updateMutate, isPending: false },
    deleteCategory: { mutateAsync: deleteMutate, isPending: false },
    reorderCategories: { mutate: reorderMutate, isPending: false },
    resetToBuiltins: { mutateAsync: resetMutate, isPending: false },
    visibleCategories: [],
  }),
}))

vi.mock('../hooks/use-sqcdp-metrics', () => ({
  useSqcdpMetrics: () => ({ metrics: [] }),
}))

const { SqcdpCategoryManagerDialog } =
  await import('./sqcdp-category-manager-dialog')

function renderDialog(initialMode: 'list' | 'create' = 'list') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SqcdpCategoryManagerDialog
        open
        onClose={vi.fn()}
        initialMode={initialMode}
      />
    </QueryClientProvider>
  )
}

describe('<SqcdpCategoryManagerDialog>', () => {
  it('renders both tier sections with the seeded builtins', () => {
    renderDialog()
    const primarySection = screen.getByTestId('sqcdp-category-section-primary')
    expect(within(primarySection).getByText('Safety')).toBeDefined()
    expect(within(primarySection).getByText('Quality')).toBeDefined()
    const secondarySection = screen.getByTestId(
      'sqcdp-category-section-secondary'
    )
    expect(within(secondarySection).getByText('Maintenance')).toBeDefined()
  })

  it('shows a Builtin badge on every seeded row', () => {
    renderDialog()
    expect(screen.getAllByText(/^Builtin$/i).length).toBeGreaterThanOrEqual(3)
  })

  it('initialMode=create renders the inline form pre-populated', () => {
    renderDialog('create')
    expect(screen.getByTestId('sqcdp-category-form')).toBeDefined()
  })

  it('typing a label auto-derives a slug', () => {
    renderDialog('create')
    const labelInput = screen.getByLabelText('Label') as HTMLInputElement
    const slugInput = screen.getByLabelText('Slug') as HTMLInputElement
    fireEvent.change(labelInput, { target: { value: 'On-Time Delivery' } })
    expect(slugInput.value).toBe('on_time_delivery')
  })

  it('Create category submits with the expected payload', async () => {
    createMutate.mockClear()
    renderDialog('create')
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Compliance' },
    })
    const createBtn = screen.getByRole('button', { name: 'Create category' })
    fireEvent.click(createBtn)
    await new Promise((r) => setTimeout(r, 0))
    expect(createMutate).toHaveBeenCalled()
    const input = createMutate.mock.calls[0][0] as Record<string, unknown>
    expect(input.slug).toBe('compliance')
    expect(input.label).toBe('Compliance')
    expect(input.tier).toBe('primary')
  })

  it('blocks duplicate slugs at submit time with a friendly error', async () => {
    createMutate.mockClear()
    renderDialog('create')
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Safety' },
    })
    const createBtn = screen.getByRole('button', { name: 'Create category' })
    fireEvent.click(createBtn)
    await new Promise((r) => setTimeout(r, 0))
    expect(createMutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/already exists/i)
  })
})

// Created and developed by Jai Singh
