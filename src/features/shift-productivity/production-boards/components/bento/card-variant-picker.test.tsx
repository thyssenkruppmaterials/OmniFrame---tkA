// Created and developed by Jai Singh
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CARD_VARIANTS,
  type CardVariant,
  type VariantConfig,
} from './card-variant'
import { BoardCardVariantPicker } from './card-variant-picker'

function wrap(children: ReactNode) {
  return <div>{children}</div>
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('<BoardCardVariantPicker>', () => {
  it('renders one radio per variant', () => {
    render(
      wrap(
        <BoardCardVariantPicker
          value='classic'
          onChange={vi.fn()}
          config={{}}
          onConfigChange={vi.fn()}
        />
      )
    )
    expect(screen.getAllByRole('radio')).toHaveLength(CARD_VARIANTS.length)
  })

  it('marks the active variant with aria-checked=true', () => {
    render(
      wrap(
        <BoardCardVariantPicker
          value='banner'
          onChange={vi.fn()}
          config={{}}
          onConfigChange={vi.fn()}
        />
      )
    )
    const banner = screen
      .getAllByRole('radio')
      .find((el) => el.getAttribute('data-variant') === 'banner')
    expect(banner?.getAttribute('aria-checked')).toBe('true')
  })

  it('invokes onChange with the picked variant', () => {
    const onChange = vi.fn<(v: CardVariant) => void>()
    render(
      wrap(
        <BoardCardVariantPicker
          value='classic'
          onChange={onChange}
          config={{}}
          onConfigChange={vi.fn()}
        />
      )
    )
    const galleryTile = screen
      .getAllByRole('radio')
      .find((el) => el.getAttribute('data-variant') === 'gallery')!
    fireEvent.click(galleryTile)
    expect(onChange).toHaveBeenCalledWith('gallery')
  })

  it('shows the gallery interval slider only when value is gallery', () => {
    const { rerender } = render(
      wrap(
        <BoardCardVariantPicker
          value='classic'
          onChange={vi.fn()}
          config={{}}
          onConfigChange={vi.fn()}
        />
      )
    )
    expect(screen.queryByLabelText(/slide interval/i)).toBeNull()
    rerender(
      wrap(
        <BoardCardVariantPicker
          value='gallery'
          onChange={vi.fn()}
          config={{}}
          onConfigChange={vi.fn()}
        />
      )
    )
    expect(screen.getByLabelText(/slide interval/i)).toBeTruthy()
  })

  it('clamps gallery interval changes to the 3..30 range', () => {
    const onConfigChange = vi.fn<(c: VariantConfig) => void>()
    render(
      wrap(
        <BoardCardVariantPicker
          value='gallery'
          onChange={vi.fn()}
          config={{}}
          onConfigChange={onConfigChange}
        />
      )
    )
    const slider = screen.getByLabelText(/slide interval/i) as HTMLInputElement
    fireEvent.change(slider, { target: { value: '12' } })
    expect(onConfigChange).toHaveBeenCalledWith({
      rotate_interval_seconds: 12,
    })
  })

  it('shows banner cover-focus radio only when value is banner', () => {
    const { rerender } = render(
      wrap(
        <BoardCardVariantPicker
          value='classic'
          onChange={vi.fn()}
          config={{}}
          onConfigChange={vi.fn()}
        />
      )
    )
    expect(screen.queryByText(/cover focus/i)).toBeNull()
    rerender(
      wrap(
        <BoardCardVariantPicker
          value='banner'
          onChange={vi.fn()}
          config={{}}
          onConfigChange={vi.fn()}
        />
      )
    )
    expect(screen.getByText(/cover focus/i)).toBeTruthy()
  })

  it('hides the entire picker when hidden=true', () => {
    const { container } = render(
      wrap(
        <BoardCardVariantPicker
          value='classic'
          onChange={vi.fn()}
          config={{}}
          onConfigChange={vi.fn()}
          hidden
        />
      )
    )
    expect(container.firstChild?.childNodes.length ?? 0).toBe(0)
  })
})

// Created and developed by Jai Singh
