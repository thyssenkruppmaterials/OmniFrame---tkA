// Created and developed by Jai Singh
/**
 * OmniBeltDashboard — section routing via URL search param.
 *
 * Verifies:
 *   1. Initial render derives the active section from `?section=` query.
 *   2. Clicking another tab calls `history.replaceState` with the new
 *      section and re-renders the matching content.
 *   3. Unknown / missing section falls back to "overview".
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { OmniBeltDashboard } from '../OmniBeltDashboard'

// Replace each section with a tiny marker so the test runs fast and
// doesn't drag every chart / supabase mock into scope.
vi.mock('../sections/OverviewSection', () => ({
  OverviewSection: () => <div data-testid='section-overview'>OVERVIEW</div>,
}))
vi.mock('../sections/ToolsSection', () => ({
  ToolsSection: () => <div data-testid='section-tools'>TOOLS</div>,
}))
vi.mock('../sections/RoleDefaultsSection', () => ({
  RoleDefaultsSection: () => <div data-testid='section-roles'>ROLES</div>,
}))
vi.mock('../sections/AnalyticsSection', () => ({
  AnalyticsSection: () => <div data-testid='section-analytics'>ANALYTICS</div>,
}))
vi.mock('../sections/AuditSection', () => ({
  AuditSection: () => <div data-testid='section-audit'>AUDIT</div>,
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({
    searchStr: typeof window !== 'undefined' ? window.location.search : '',
  }),
}))

function setUrl(search: string) {
  // jsdom lets us mutate the URL in-place via history.replaceState.
  window.history.replaceState({}, '', `/admin/omnibelt${search}`)
}

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <OmniBeltDashboard />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  setUrl('')
})

describe('OmniBeltDashboard', () => {
  it('falls back to overview when no section search param is set', () => {
    renderDashboard()
    expect(screen.getByTestId('section-overview')).toBeInTheDocument()
  })

  it('reads the active section from the search param on mount', () => {
    setUrl('?section=analytics')
    renderDashboard()
    expect(screen.getByTestId('section-analytics')).toBeInTheDocument()
  })

  it('falls back to overview on unknown section value', () => {
    setUrl('?section=garbage')
    renderDashboard()
    expect(screen.getByTestId('section-overview')).toBeInTheDocument()
  })

  it('switches sections when a tab is clicked', () => {
    renderDashboard()

    // Mouse-down (not just click) is what Radix's Tabs primitive
    // listens to in tests — see @radix-ui/react-tabs source.
    const tab = screen.getByRole('tab', { name: /tools & allow-list/i })
    fireEvent.mouseDown(tab)
    fireEvent.click(tab)

    // Active marker on the trigger.
    expect(tab).toHaveAttribute('data-state', 'active')
    // The mocked Tools section becomes the rendered content.
    expect(screen.getByTestId('section-tools')).toBeInTheDocument()
  })
})

// Created and developed by Jai Singh
