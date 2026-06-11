// Created and developed by Jai Singh
/**
 * StripStatusSurface — render-when-job-present contract (P7).
 *
 * Renders only when `activeJobs` has at least one entry; uses the
 * most-recent job (last element) so simultaneous jobs don't flicker
 * the strip every render.
 */
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'
import { useOmnibeltStore } from '../../../store/omnibeltStore'
import { StripStatusSurface } from '../StripStatusSurface'

vi.mock('../../../store/omnibeltStore', () => ({
  useOmnibeltStore: vi.fn(),
}))

type Job = { id: string; progress: number; label: string }

function setup(activeJobs: Job[]) {
  const bag = { activeJobs }
  ;(useOmnibeltStore as unknown as Mock).mockImplementation(
    (selector: (s: typeof bag) => unknown) => selector(bag)
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('StripStatusSurface', () => {
  it('renders nothing when there are no active jobs', () => {
    setup([])
    const { container } = render(<StripStatusSurface />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the most-recent active job label + percent', () => {
    setup([
      { id: 'job-old', progress: 0.1, label: 'Old job' },
      { id: 'job-current', progress: 0.67, label: 'Importing LX03' },
    ])
    render(<StripStatusSurface />)
    const status = screen.getByTestId('omnibelt-skystrip-status')
    expect(status).toBeInTheDocument()
    expect(status).toHaveTextContent('Importing LX03 — 67%')
    expect(status).not.toHaveTextContent('Old job')
  })

  it('clamps progress to 0..100% bounds', () => {
    setup([{ id: 'over', progress: 1.5, label: 'Overshoot' }])
    render(<StripStatusSurface />)
    expect(screen.getByTestId('omnibelt-skystrip-status')).toHaveTextContent(
      'Overshoot — 100%'
    )
  })

  it('clamps negative progress to 0%', () => {
    setup([{ id: 'under', progress: -0.3, label: 'Negative' }])
    render(<StripStatusSurface />)
    expect(screen.getByTestId('omnibelt-skystrip-status')).toHaveTextContent(
      'Negative — 0%'
    )
  })

  it('rounds fractional percents to the nearest whole number', () => {
    setup([{ id: 'fract', progress: 0.4567, label: 'Frac' }])
    render(<StripStatusSurface />)
    expect(screen.getByTestId('omnibelt-skystrip-status')).toHaveTextContent(
      'Frac — 46%'
    )
  })
})

// Created and developed by Jai Singh
