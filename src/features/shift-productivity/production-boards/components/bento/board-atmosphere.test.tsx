// Created and developed by Jai Singh
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BoardAtmosphere } from './board-atmosphere'

describe('<BoardAtmosphere />', () => {
  it('renders a fixed background layer keyed to the board kind', () => {
    const { container } = render(<BoardAtmosphere boardKind='announcement' />)
    const root = container.querySelector('[data-board-atmosphere]')
    expect(root).not.toBeNull()
    expect(root?.getAttribute('data-board-atmosphere')).toBe('announcement')
    expect(root?.getAttribute('aria-hidden')).toBe('true')
  })

  it('paints all four atmospheric layers (mesh + two blooms + grain svg)', () => {
    const { container } = render(<BoardAtmosphere boardKind='hr_news' />)
    const root = container.querySelector('[data-board-atmosphere]')!
    expect(root.querySelectorAll('div').length).toBeGreaterThanOrEqual(3) // mesh + two blooms + scrim layers
    expect(root.querySelector('svg')).not.toBeNull() // grain filter SVG
  })

  it('bumps TV opacity when `isTv` is set', () => {
    const { container: a } = render(
      <BoardAtmosphere boardKind='job' isTv={false} />
    )
    const { container: b } = render(
      <BoardAtmosphere boardKind='job' isTv={true} />
    )
    const mesh = (root: ParentNode) =>
      root.querySelector('[data-board-atmosphere] > div + div')
    expect(mesh(a)).not.toBeNull()
    expect(mesh(b)).not.toBeNull()
  })

  it('omits the animation class when `animated={false}`', () => {
    const { container } = render(
      <BoardAtmosphere boardKind='safety_alert' animated={false} />
    )
    const mesh = container.querySelector(
      '[data-board-atmosphere] > div + div'
    ) as HTMLElement
    expect(mesh).not.toBeNull()
    expect(mesh.className).not.toMatch(/animate-\[board-mesh/)
  })
})

// Created and developed by Jai Singh
