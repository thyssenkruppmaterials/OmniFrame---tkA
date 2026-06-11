// Created and developed by Jai Singh
/**
 * JobRow — progress bar, percent, cancel button.
 *
 * Pure presentational component — no store / WS dependencies.
 */
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ActiveJob } from '../store/omnibeltStore'
import { JobRow } from '../tray/JobRow'

function makeJob(overrides: Partial<ActiveJob> = {}): ActiveJob {
  return {
    id: 'j-1',
    type: 'sap_import',
    label: 'Importing LX03',
    progress: 0.42,
    startedAt: Date.now(),
    startedByCurrentUser: true,
    cancelable: false,
    ...overrides,
  }
}

describe('JobRow', () => {
  it('renders the label, type chip, percent and progress bar', () => {
    const job = makeJob({ id: 'j-1', progress: 0.42 })
    render(<JobRow job={job} />)
    expect(screen.getByText('Importing LX03')).toBeInTheDocument()
    expect(screen.getByText('SAP import')).toBeInTheDocument()
    expect(screen.getByTestId('omnibelt-job-percent-j-1')).toHaveTextContent(
      '42%'
    )
    const bar = screen.getByTestId('omnibelt-job-bar-j-1')
    expect(bar).toHaveStyle({ width: '42%' })
  })

  it('rounds progress to the nearest integer percent', () => {
    const job = makeJob({ id: 'j-2', progress: 0.876 })
    render(<JobRow job={job} />)
    expect(screen.getByTestId('omnibelt-job-percent-j-2')).toHaveTextContent(
      '88%'
    )
  })

  it('renders cancel button only when job.cancelable AND onCancel is provided', () => {
    const onCancel = vi.fn()
    const cancelable = makeJob({
      id: 'j-3',
      cancelable: true,
    })
    render(<JobRow job={cancelable} onCancel={onCancel} />)
    const btn = screen.getByTestId('omnibelt-job-cancel-j-3')
    fireEvent.click(btn)
    expect(onCancel).toHaveBeenCalledWith('j-3')
  })

  it('hides cancel button when job is not cancelable', () => {
    const job = makeJob({ id: 'j-4', cancelable: false })
    render(<JobRow job={job} onCancel={vi.fn()} />)
    expect(screen.queryByTestId('omnibelt-job-cancel-j-4')).toBeNull()
  })

  it('hides cancel button when onCancel is omitted (even if cancelable)', () => {
    const job = makeJob({ id: 'j-5', cancelable: true })
    render(<JobRow job={job} />)
    expect(screen.queryByTestId('omnibelt-job-cancel-j-5')).toBeNull()
  })

  it('exposes a progressbar with WAI-ARIA values', () => {
    const job = makeJob({ id: 'j-6', progress: 0.33 })
    render(<JobRow job={job} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '33')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })
})

// Created and developed by Jai Singh
