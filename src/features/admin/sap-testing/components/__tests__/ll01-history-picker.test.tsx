// Created and developed by Jai Singh
/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LL01HistoryPicker } from '../ll01-history-picker'
import type { LL01RunIndexEntry } from '../warehouse-activity-monitor-types'

// Local-style timestamps (no trailing Z) so day grouping is deterministic
// regardless of the test runner's timezone. r2 + r3 share one day; r1 is on
// a different day.
const runs: LL01RunIndexEntry[] = [
  { snapshot_run_id: 'r3', ran_at: '2026-05-31T16:00:00', ok: true },
  { snapshot_run_id: 'r2', ran_at: '2026-05-31T09:00:00', ok: true },
  { snapshot_run_id: 'r1', ran_at: '2026-05-20T09:00:00', ok: false },
]

describe('LL01HistoryPicker', () => {
  it('disables the trigger when there are no saved runs', () => {
    render(
      <LL01HistoryPicker
        runs={[]}
        selectedRunId={null}
        onSelectRun={() => {}}
      />
    )
    const btn = screen.getByTitle(/no saved runs yet/i) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('labels the trigger with a run time once a run is selected', () => {
    render(
      <LL01HistoryPicker
        runs={runs}
        selectedRunId='r3'
        onSelectRun={() => {}}
      />
    )
    // No longer the default "History" label.
    expect(screen.queryByRole('button', { name: /^history$/i })).toBeNull()
    expect(screen.getByTitle(/view a saved run/i)).toBeTruthy()
  })

  it('clears to the live run when "Current run" is clicked', () => {
    const onSelectRun = vi.fn()
    render(
      <LL01HistoryPicker
        runs={runs}
        selectedRunId='r3'
        onSelectRun={onSelectRun}
      />
    )
    fireEvent.click(screen.getByTitle(/view a saved run/i))
    fireEvent.click(screen.getByRole('button', { name: /current run/i }))
    expect(onSelectRun).toHaveBeenCalledWith(null)
  })

  it('shows a per-time list for a day with multiple runs', () => {
    render(
      <LL01HistoryPicker
        runs={runs}
        selectedRunId='r3'
        onSelectRun={() => {}}
      />
    )
    fireEvent.click(screen.getByTitle(/view a saved run/i))
    // r2 + r3 fall on the same (selected) day → the time list surfaces.
    expect(screen.getByText(/2 runs/i)).toBeTruthy()
  })
})

// Created and developed by Jai Singh
