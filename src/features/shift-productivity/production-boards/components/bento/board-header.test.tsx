// Created and developed by Jai Singh
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BoardHeader } from './board-header'

describe('<BoardHeader />', () => {
  it('renders the title, subtitle, and kind eyebrow', () => {
    render(
      <BoardHeader
        boardKind='announcement'
        title='Announcements'
        subtitle='Floor-wide posts'
      />
    )
    expect(screen.getByRole('heading', { name: /announcements/i })).toBeTruthy()
    expect(screen.queryByText(/floor-wide posts/i)).toBeTruthy()
  })

  it('renders the count chip when `count` is provided', () => {
    render(<BoardHeader boardKind='hr_news' title='HR News' count={5} />)
    expect(screen.queryByText(/5 live/i)).toBeTruthy()
  })

  it('does NOT render the compose button without `onCompose`', () => {
    render(<BoardHeader boardKind='job' title='Jobs' />)
    expect(screen.queryByRole('button', { name: /new/i })).toBeNull()
  })

  it('renders the compose button when `onCompose` + `composeLabel` are provided', () => {
    const onCompose = vi.fn()
    render(
      <BoardHeader
        boardKind='job'
        title='Jobs'
        onCompose={onCompose}
        composeLabel='New job'
      />
    )
    const btn = screen.getByRole('button', { name: /new job/i })
    fireEvent.click(btn)
    expect(onCompose).toHaveBeenCalledTimes(1)
  })

  it('renders the "Display on TV" button when `onEnterTv` is provided', () => {
    const onEnterTv = vi.fn()
    render(
      <BoardHeader
        boardKind='safety_alert'
        title='Safety'
        onEnterTv={onEnterTv}
      />
    )
    const btn = screen.getByRole('button', { name: /display on tv/i })
    fireEvent.click(btn)
    expect(onEnterTv).toHaveBeenCalledTimes(1)
  })

  it('renders filters in the dedicated slot', () => {
    render(
      <BoardHeader
        boardKind='announcement'
        title='Announcements'
        filters={<span data-testid='filters'>chips here</span>}
      />
    )
    expect(screen.getByTestId('filters')).toBeTruthy()
  })
})

// Created and developed by Jai Singh
