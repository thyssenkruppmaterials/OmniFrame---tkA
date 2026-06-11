// Created and developed by Jai Singh
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowStepConfig } from '@/lib/supabase/workflow-config.service'
import { useExtraWorkflowSteps } from '../use-extra-workflow-steps'
import type { TaskWorkflow } from '../use-task-workflow'

// Mock the Supabase client before the hook imports it, so the test file
// doesn't require real env vars.
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: { workflow_result: {} },
            error: null,
          })),
        })),
      })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    })),
  },
}))

function step(
  id: string,
  type: WorkflowStepConfig['type'],
  order: number,
  required = false
): WorkflowStepConfig {
  return { id, type, label: id, required, order, config: {} }
}

function workflow(steps: WorkflowStepConfig[]): TaskWorkflow {
  return {
    steps,
    reviewThresholdPct: 10,
    reviewThresholdAbs: 10,
    source: 'fallback',
    configId: null,
    configVersion: null,
  }
}

describe('useExtraWorkflowSteps', () => {
  it('buckets steps into pre-count and post-count slots by type', () => {
    const wf = workflow([
      step('confirm', 'confirm', 1, true),
      step('loc', 'location_scan', 2, true),
      step('barcode', 'barcode_label_scan', 3, true),
      step('qty', 'quantity_entry', 4, true),
      step('serial', 'serial_number', 5, false),
      step('condition', 'condition_assessment', 6, true),
      step('notes', 'notes', 7, false),
      step('photo', 'photo_capture', 8, false),
    ])
    const { result } = renderHook(() => useExtraWorkflowSteps(wf))
    expect(result.current.preCountSteps.map((s) => s.stepConfig.id)).toEqual([
      'barcode',
    ])
    expect(result.current.postCountSteps.map((s) => s.stepConfig.id)).toEqual([
      'serial',
      'condition',
      'notes',
      'photo',
    ])
    expect(result.current.hasPreSteps).toBe(true)
    expect(result.current.hasPostSteps).toBe(true)
    expect(result.current.allPreDone).toBe(false)
    expect(result.current.allPostDone).toBe(false)
  })

  it('reports no extras when workflow only has the core step types', () => {
    const wf = workflow([
      step('confirm', 'confirm', 1, true),
      step('loc', 'location_scan', 2, true),
      step('qty', 'quantity_entry', 3, true),
      step('review', 'review', 4, true),
    ])
    const { result } = renderHook(() => useExtraWorkflowSteps(wf))
    expect(result.current.hasPreSteps).toBe(false)
    expect(result.current.hasPostSteps).toBe(false)
    expect(result.current.allPreDone).toBe(true)
    expect(result.current.allPostDone).toBe(true)
  })

  it('orders extras within each slot by step.order', () => {
    const wf = workflow([
      step('serial', 'serial_number', 7),
      step('notes', 'notes', 5),
      step('condition', 'condition_assessment', 6),
    ])
    const { result } = renderHook(() => useExtraWorkflowSteps(wf))
    expect(result.current.postCountSteps.map((s) => s.stepConfig.id)).toEqual([
      'notes',
      'condition',
      'serial',
    ])
  })

  it('advances and retreats within each slot', () => {
    const wf = workflow([
      step('serial', 'serial_number', 1),
      step('condition', 'condition_assessment', 2),
    ])
    const { result } = renderHook(() => useExtraWorkflowSteps(wf))

    expect(result.current.currentPostStep?.stepConfig.id).toBe('serial')
    act(() => result.current.advancePostStep())
    expect(result.current.currentPostStep?.stepConfig.id).toBe('condition')
    act(() => result.current.advancePostStep())
    expect(result.current.currentPostStep).toBeNull()
    expect(result.current.allPostDone).toBe(true)

    act(() => result.current.retreatPostStep())
    expect(result.current.currentPostStep?.stepConfig.id).toBe('condition')
  })

  it('hydrates from initialResults by skipping already-completed extras', async () => {
    const wf = workflow([
      step('barcode', 'barcode_label_scan', 1),
      step('serial', 'serial_number', 2),
      step('condition', 'condition_assessment', 3),
    ])
    const { result } = renderHook(() =>
      useExtraWorkflowSteps(wf, {
        barcode: { scannedBarcode: 'ABC-123' },
        serial: { serialNumbers: ['S1', 'S2'] },
      })
    )
    // Pre-count barcode is done → currentPreStep is null (advanced past).
    // Post-count serial is done → advanced past → condition is current.
    await waitFor(() => {
      expect(result.current.currentPreStep).toBeNull()
      expect(result.current.currentPostStep?.stepConfig.id).toBe('condition')
      expect(result.current.results).toEqual({
        barcode: { scannedBarcode: 'ABC-123' },
        serial: { serialNumbers: ['S1', 'S2'] },
      })
    })
  })

  it('resetExtraSteps returns indices and results to zero', () => {
    const wf = workflow([
      step('serial', 'serial_number', 1),
      step('condition', 'condition_assessment', 2),
    ])
    const { result } = renderHook(() => useExtraWorkflowSteps(wf))

    act(() => result.current.advancePostStep())
    act(() => result.current.advancePostStep())
    expect(result.current.allPostDone).toBe(true)

    act(() => result.current.resetExtraSteps())
    expect(result.current.postCountIndex).toBe(0)
    expect(result.current.allPostDone).toBe(false)
    expect(result.current.currentPostStep?.stepConfig.id).toBe('serial')
  })
})

// Created and developed by Jai Singh
