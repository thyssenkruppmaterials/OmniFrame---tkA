// Created and developed by Jai Singh
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LivePulse } from './live-pulse'

describe('<LivePulse />', () => {
  it('renders a dot pair with the kind colour class', () => {
    const { container } = render(<LivePulse boardKind='announcement' />)
    const root = container.querySelector('[data-live-pulse]')
    expect(root?.getAttribute('data-live-pulse')).toBe('announcement')
    expect(root?.className).toMatch(/inline-flex/)
    // 2 spans inside — the pinging halo + the static inner dot.
    expect(root?.querySelectorAll('span').length).toBe(2)
  })

  it('uses the rose accent for safety alerts', () => {
    const { container } = render(<LivePulse boardKind='safety_alert' />)
    const innerDot = container.querySelectorAll('[data-live-pulse] > span')[1]
    expect(innerDot?.className).toMatch(/bg-rose-500/)
  })

  it('uses the emerald accent for hr_news', () => {
    const { container } = render(<LivePulse boardKind='hr_news' />)
    const innerDot = container.querySelectorAll('[data-live-pulse] > span')[1]
    expect(innerDot?.className).toMatch(/bg-emerald-500/)
  })

  it('uses the amber accent for jobs', () => {
    const { container } = render(<LivePulse boardKind='job' />)
    const innerDot = container.querySelectorAll('[data-live-pulse] > span')[1]
    expect(innerDot?.className).toMatch(/bg-amber-500/)
  })

  it('attaches an aria-label when `label` is provided', () => {
    render(<LivePulse boardKind='announcement' label='Live' />)
    expect(screen.queryByRole('img', { name: /live/i })).toBeTruthy()
  })

  it('changes width when `size` prop varies', () => {
    const { container: a } = render(<LivePulse boardKind='job' size='sm' />)
    const { container: b } = render(<LivePulse boardKind='job' size='lg' />)
    const rootA = a.querySelector('[data-live-pulse]')!
    const rootB = b.querySelector('[data-live-pulse]')!
    expect(rootA.className).toMatch(/h-1\.5/)
    expect(rootB.className).toMatch(/h-2\.5/)
  })
})

// Created and developed by Jai Singh
