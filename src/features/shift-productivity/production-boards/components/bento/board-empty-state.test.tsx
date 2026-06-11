// Created and developed by Jai Singh
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BoardEmptyState } from './board-empty-state'

describe('<BoardEmptyState />', () => {
  it('renders the kind-specific headline for each kind', () => {
    const { rerender } = render(<BoardEmptyState boardKind='announcement' />)
    expect(
      screen.queryByRole('region', { name: /announcements/i })
    ).toBeTruthy()
    expect(screen.queryByText(/Nothing on the wire yet/i)).toBeTruthy()

    rerender(<BoardEmptyState boardKind='hr_news' />)
    expect(screen.queryByText(/Quiet on the HR channel/i)).toBeTruthy()

    rerender(<BoardEmptyState boardKind='job' />)
    expect(screen.queryByText(/No openings posted/i)).toBeTruthy()

    rerender(<BoardEmptyState boardKind='safety_alert' />)
    expect(screen.queryByText(/All clear/i)).toBeTruthy()
  })

  it('renders the kind eyebrow with the kind label', () => {
    render(<BoardEmptyState boardKind='job' />)
    expect(screen.queryByText('Jobs')).toBeTruthy()
  })

  it('does NOT render the CTA when `onCompose` is undefined', () => {
    render(<BoardEmptyState boardKind='announcement' />)
    expect(screen.queryByRole('button', { name: /compose/i })).toBeNull()
  })

  it('renders the CTA when `onCompose` is provided and wires the click', () => {
    const onCompose = vi.fn()
    render(<BoardEmptyState boardKind='announcement' onCompose={onCompose} />)
    const cta = screen.getByRole('button', {
      name: /compose first announcement/i,
    })
    fireEvent.click(cta)
    expect(onCompose).toHaveBeenCalledTimes(1)
  })

  it('bumps padding in TV density mode', () => {
    const { container } = render(
      <BoardEmptyState boardKind='hr_news' density='tv' />
    )
    const root = container.querySelector('[data-board-empty-state]')
    expect(root?.className).toMatch(/min-h-\[70vh\]/)
  })
})

// Created and developed by Jai Singh
