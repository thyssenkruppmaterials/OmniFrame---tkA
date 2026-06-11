// Created and developed by Jai Singh
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatTile } from '@/components/ui/stat-tile'

describe('StatTile', () => {
  it('renders label and locale-formatted integer value by default', () => {
    render(<StatTile label='Variance' value={25074} />)

    expect(screen.getByText('Variance')).toBeInTheDocument()
    // Default toLocaleString('en-US') -> "25,074" in jsdom
    const valueNode = screen.getByText('25,074')
    expect(valueNode).toBeInTheDocument()
    expect(valueNode).toHaveAttribute('title', '25074')
  })

  it('respects format="percent" by appending %', () => {
    render(<StatTile label='Accuracy' value={91} format='percent' />)
    expect(screen.getByText('91%')).toBeInTheDocument()
  })

  it('renders raw values unchanged when format="raw"', () => {
    render(<StatTile label='Status' value='—' format='raw' />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('applies the truncate + min-w-0 chain on the value', () => {
    render(<StatTile label='Total' value={1234567} />)
    const value = screen.getByText('1,234,567')
    expect(value).toHaveClass('min-w-0')
    expect(value).toHaveClass('truncate')
    expect(value).toHaveClass('tabular-nums')
  })

  it('exposes the container-query token + accent data attribute', () => {
    const { container } = render(
      <StatTile label='Test' value={1} accent='emerald' />
    )
    const tile = container.querySelector('[data-slot="stat-tile"]')
    expect(tile).not.toBeNull()
    expect(tile).toHaveAttribute('data-accent', 'emerald')
    expect(tile?.className).toContain('@container/stat-tile')
    expect(tile?.className).toContain('min-w-0')
  })

  it('honors valueTitle override for accessibility', () => {
    render(
      <StatTile
        label='Custom'
        value={42}
        valueTitle='42 widgets in current shift'
      />
    )
    expect(screen.getByText('42')).toHaveAttribute(
      'title',
      '42 widgets in current shift'
    )
  })

  it('renders an optional icon and hint when supplied', () => {
    render(
      <StatTile
        label='Pending'
        value={7}
        icon={<svg data-testid='tile-icon' />}
        hint='since 8 AM'
      />
    )
    expect(screen.getByTestId('tile-icon')).toBeInTheDocument()
    expect(screen.getByText('since 8 AM')).toBeInTheDocument()
  })
})

// Created and developed by Jai Singh
