// Created and developed by Jai Singh
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BoardFilterChips } from './board-filter-chips'

describe('<BoardFilterChips />', () => {
  const options = [
    { id: 'all', label: 'All' },
    { id: 'a', label: 'Area A' },
    { id: 'b', label: 'Area B', count: 12 },
  ]

  it('renders every option', () => {
    render(
      <BoardFilterChips
        boardKind='announcement'
        options={options}
        active='all'
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /^all$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /area a/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /area b/i })).toBeTruthy()
  })

  it('marks the active chip with aria-pressed', () => {
    render(
      <BoardFilterChips
        boardKind='announcement'
        options={options}
        active='a'
        onChange={vi.fn()}
      />
    )
    const a = screen.getByRole('button', { name: /area a/i })
    const all = screen.getByRole('button', { name: /^all$/i })
    expect(a.getAttribute('aria-pressed')).toBe('true')
    expect(all.getAttribute('aria-pressed')).toBe('false')
  })

  it('renders the count when the option carries one', () => {
    render(
      <BoardFilterChips
        boardKind='hr_news'
        options={options}
        active='all'
        onChange={vi.fn()}
      />
    )
    const areaB = screen.getByRole('button', { name: /area b/i })
    expect(areaB.textContent).toMatch(/12/)
  })

  it('invokes onChange with the clicked option id', () => {
    const onChange = vi.fn()
    render(
      <BoardFilterChips
        boardKind='safety_alert'
        options={options}
        active='all'
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /area a/i }))
    expect(onChange).toHaveBeenCalledWith('a')
  })
})

// Created and developed by Jai Singh
