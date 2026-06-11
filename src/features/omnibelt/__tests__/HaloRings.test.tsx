// Created and developed by Jai Singh
/**
 * HaloRings — renders one circle per active job, encodes progress
 * via stroke-dasharray on a normalized 100-unit pathLength.
 */
import { render, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ActiveJob } from '../store/omnibeltStore'
import { HaloRings } from '../tray/HaloRings'

function makeJob(overrides: Partial<ActiveJob> = {}): ActiveJob {
  return {
    id: overrides.id ?? 'job-1',
    type: overrides.type ?? 'sap_import',
    label: overrides.label ?? 'Importing LX03',
    progress: overrides.progress ?? 0.5,
    startedAt: overrides.startedAt ?? Date.now(),
    startedByCurrentUser: overrides.startedByCurrentUser ?? true,
    cancelable: overrides.cancelable ?? false,
    ...(overrides.cancelUrl ? { cancelUrl: overrides.cancelUrl } : {}),
  }
}

describe('HaloRings', () => {
  it('renders nothing when activeJobs is empty', () => {
    const { container } = render(
      <HaloRings activeJobs={[]} width={120} height={48} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders one <circle> per active job', () => {
    const jobs = [
      makeJob({ id: 'a', progress: 0.25 }),
      makeJob({ id: 'b', type: 'sap_export', progress: 0.6 }),
      makeJob({ id: 'c', type: 'agent_job', progress: 0.9 }),
    ]
    const { getAllByTestId } = render(
      <HaloRings activeJobs={jobs} width={120} height={48} />
    )
    expect(getAllByTestId(/^omnibelt-halo-ring-/).length).toBe(3)
  })

  it('encodes progress via strokeDasharray on a 100-unit pathLength', () => {
    const jobs = [makeJob({ id: 'a', progress: 0.42 })]
    const { getByTestId } = render(
      <HaloRings activeJobs={jobs} width={120} height={48} />
    )
    const circle = getByTestId('omnibelt-halo-ring-a')
    expect(circle.getAttribute('pathLength')).toBe('100')
    expect(circle.getAttribute('stroke-dasharray')).toBe('42 100')
  })

  it('clamps progress < 0 and > 1', () => {
    const jobs = [
      makeJob({ id: 'low', progress: -0.5 }),
      makeJob({ id: 'high', progress: 1.7 }),
    ]
    const { getByTestId } = render(
      <HaloRings activeJobs={jobs} width={120} height={48} />
    )
    expect(
      getByTestId('omnibelt-halo-ring-low').getAttribute('stroke-dasharray')
    ).toBe('0 100')
    expect(
      getByTestId('omnibelt-halo-ring-high').getAttribute('stroke-dasharray')
    ).toBe('100 100')
  })

  it('applies the per-type CSS color variable to the stroke', () => {
    const jobs = [
      makeJob({ id: 'a', type: 'sap_import' }),
      makeJob({ id: 'b', type: 'agent_job' }),
    ]
    const { getByTestId } = render(
      <HaloRings activeJobs={jobs} width={120} height={48} />
    )
    expect(getByTestId('omnibelt-halo-ring-a').getAttribute('stroke')).toBe(
      'var(--omnibelt-job-sap_import)'
    )
    expect(getByTestId('omnibelt-halo-ring-b').getAttribute('stroke')).toBe(
      'var(--omnibelt-job-agent_job)'
    )
  })

  it('attaches a <title> child for screen-reader hints', () => {
    const jobs = [makeJob({ id: 'a', label: 'Confirming TO', progress: 0.42 })]
    const { getByTestId } = render(
      <HaloRings activeJobs={jobs} width={120} height={48} />
    )
    const titles = getByTestId('omnibelt-halo-ring-a').querySelectorAll('title')
    expect(titles.length).toBe(1)
    expect(titles[0]?.textContent).toBe('Confirming TO — 42%')
  })

  it('skips rings whose computed radius is non-positive', () => {
    // Tiny host with three jobs and big stroke — only the outer
    // ring fits; the inner two would render with r ≤ 0.
    const jobs = [
      makeJob({ id: 'outer' }),
      makeJob({ id: 'mid' }),
      makeJob({ id: 'inner' }),
    ]
    const { queryByTestId } = render(
      <HaloRings
        activeJobs={jobs}
        width={20}
        height={20}
        strokeWidth={5}
        ringGap={2}
      />
    )
    expect(queryByTestId('omnibelt-halo-ring-outer')).not.toBeNull()
    // mid + inner collapse out
    expect(queryByTestId('omnibelt-halo-ring-mid')).toBeNull()
    expect(queryByTestId('omnibelt-halo-ring-inner')).toBeNull()
  })

  it('decorative when onClick is omitted (pointer-events: none)', () => {
    const jobs = [makeJob({ id: 'a' })]
    const { getByTestId } = render(
      <HaloRings activeJobs={jobs} width={120} height={48} />
    )
    const svg = getByTestId('omnibelt-halo')
    expect(svg.getAttribute('data-interactive')).toBe('false')
    expect(svg.getAttribute('role')).toBe('presentation')
    expect((svg as HTMLElement).style.pointerEvents).toBe('none')
  })

  it('interactive when onClick is provided — fires on click', () => {
    const jobs = [makeJob({ id: 'a' })]
    const onClick = vi.fn()
    const { getByTestId } = render(
      <HaloRings activeJobs={jobs} width={120} height={48} onClick={onClick} />
    )
    const svg = getByTestId('omnibelt-halo')
    expect(svg.getAttribute('data-interactive')).toBe('true')
    expect(svg.getAttribute('role')).toBe('button')
    expect((svg as HTMLElement).style.pointerEvents).toBe('auto')
    fireEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

// Created and developed by Jai Singh
