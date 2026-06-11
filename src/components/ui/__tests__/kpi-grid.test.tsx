// Created and developed by Jai Singh
import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KpiGrid } from '@/components/ui/kpi-grid'

describe('KpiGrid', () => {
  it('renders an unconditional 3-column grid by default', () => {
    const { container } = render(
      <KpiGrid>
        <div data-testid='child-a' />
        <div data-testid='child-b' />
        <div data-testid='child-c' />
      </KpiGrid>
    )

    const grid = container.querySelector('[data-slot="kpi-grid"]')
    expect(grid).not.toBeNull()
    expect(grid).toHaveAttribute('data-columns', '3')
    // Container-query plumbing is still wired up (for the 4/5/6 cases),
    // even though the default 3-col layout no longer steps down.
    expect(grid?.className).toContain('@container/kpi-grid')
    expect(grid?.className).toContain('grid-cols-3')
    expect(grid?.className).toContain('min-w-0')
  })

  it('steps up to 4 columns when columns prop is 4', () => {
    const { container } = render(<KpiGrid columns={4} />)
    const grid = container.querySelector('[data-slot="kpi-grid"]')
    expect(grid).toHaveAttribute('data-columns', '4')
    expect(grid?.className).toContain('grid-cols-2')
    expect(grid?.className).toContain('@md/kpi-grid:grid-cols-4')
  })

  it('uses gap-2 when density is compact', () => {
    const { container } = render(<KpiGrid density='compact' />)
    const grid = container.querySelector('[data-slot="kpi-grid"]')
    expect(grid?.className).toContain('gap-2')
  })

  it('defaults to comfortable gap-3 spacing', () => {
    const { container } = render(<KpiGrid />)
    const grid = container.querySelector('[data-slot="kpi-grid"]')
    expect(grid?.className).toContain('gap-3')
  })
})

// Created and developed by Jai Singh
