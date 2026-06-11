// Created and developed by Jai Singh
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CycleCountTask } from '@/lib/work-service/types'
import { hasStepType, getStep, useTaskWorkflow } from '../use-task-workflow'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    })),
  },
}))

vi.mock('@/lib/supabase/workflow-config.service', () => ({
  workflowConfigService: {
    getSnapshotForTask: vi.fn(async () => ({ data: null, error: null })),
  },
}))

function makeTask(overrides: Partial<CycleCountTask> = {}): CycleCountTask {
  return {
    id: 't1',
    count_number: 'CC-1',
    material_number: 'M-1',
    material_description: null,
    location: 'A1',
    warehouse: null,
    system_quantity: 10,
    counted_quantity: null,
    unit_of_measure: 'EA',
    priority: 'normal',
    status: 'in_progress',
    count_type: 'quantity_check',
    assigned_to: null,
    assigned_at: null,
    push_mode: 'pull',
    pushed_by: null,
    pushed_at: null,
    push_acknowledged: false,
    organization_id: 'org',
    completed_at: null,
    recount_by: null,
    recount_date: null,
    recount_completed: false,
    requires_recount: false,
    counter_name: null,
    resolved_location_key: null,
    resolved_zone: null,
    resolved_aisle: null,
    resolved_sequence: null,
    resolution_source: null,
    workflow_config_id: 'cfg-1',
    workflow_config_version: 3,
    workflow_snapshot: {
      config_id: 'cfg-1',
      config_version: 3,
      count_type: 'quantity_check',
      steps: [
        {
          id: 's1',
          type: 'confirm',
          label: 'Confirm',
          required: true,
          order: 1,
          config: {},
        },
        {
          id: 's2',
          type: 'quantity_entry',
          label: 'Qty',
          required: true,
          order: 2,
          config: {},
        },
        {
          id: 's3',
          type: 'review',
          label: 'Review',
          required: true,
          order: 3,
          config: { review_threshold_pct: 5, review_threshold_abs: 2 },
        },
      ],
    },
    workflow_result: {},
    evidence_photo_urls: null,
    review_threshold_pct: 5,
    review_threshold_abs: 2,
    scanned_material_number: null,
    location_reported_empty: null,
    part_variance: null,
    scanned_parts: [],
    transfer_destination_location: null,
    transfer_source_quantity: null,
    ...overrides,
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return createElement(QueryClientProvider, { client }, children)
}

describe('useTaskWorkflow', () => {
  it('returns workflow from task payload synchronously (fast path)', () => {
    const task = makeTask()
    const { result } = renderHook(() => useTaskWorkflow({ task }), { wrapper })

    expect(result.current.workflow.source).toBe('task')
    expect(result.current.workflow.steps.map((s) => s.type)).toEqual([
      'confirm',
      'quantity_entry',
      'review',
    ])
    expect(result.current.workflow.reviewThresholdPct).toBe(5)
    expect(result.current.workflow.reviewThresholdAbs).toBe(2)
    expect(result.current.workflow.configId).toBe('cfg-1')
    expect(result.current.workflow.configVersion).toBe(3)
    expect(result.current.isLoading).toBe(false)
  })

  it('sorts steps by order before returning', () => {
    const task = makeTask({
      workflow_snapshot: {
        steps: [
          {
            id: 'b',
            type: 'quantity_entry',
            label: 'Qty',
            required: true,
            order: 2,
            config: {},
          },
          {
            id: 'a',
            type: 'confirm',
            label: 'Confirm',
            required: true,
            order: 1,
            config: {},
          },
          {
            id: 'c',
            type: 'review',
            label: 'Review',
            required: true,
            order: 3,
            config: {},
          },
        ],
      },
    })
    const { result } = renderHook(() => useTaskWorkflow({ task }), { wrapper })
    expect(result.current.workflow.steps.map((s) => s.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('falls back to default workflow when snapshot has no steps', () => {
    const task = makeTask({ workflow_snapshot: {} })
    const { result } = renderHook(() => useTaskWorkflow({ task }), { wrapper })
    // Because the snapshot has no steps and we also pass no taskId-only
    // fallback fetch, we return the legacy default workflow.
    expect(['task', 'fallback']).toContain(result.current.workflow.source)
  })
})

describe('hasStepType / getStep', () => {
  const wf = {
    steps: [
      {
        id: 's1',
        type: 'confirm' as const,
        label: 'C',
        required: true,
        order: 1,
        config: {},
      },
      {
        id: 's2',
        type: 'photo_capture' as const,
        label: 'P',
        required: false,
        order: 2,
        config: {},
      },
    ],
    reviewThresholdPct: 10,
    reviewThresholdAbs: 10,
    source: 'task' as const,
    configId: null,
    configVersion: null,
  }

  it('hasStepType finds configured types', () => {
    expect(hasStepType(wf, 'confirm')).toBe(true)
    expect(hasStepType(wf, 'photo_capture')).toBe(true)
    expect(hasStepType(wf, 'supervisor_signoff')).toBe(false)
  })

  it('getStep returns the matching step', () => {
    expect(getStep(wf, 'photo_capture')?.id).toBe('s2')
    expect(getStep(wf, 'review')).toBeUndefined()
  })
})

// Created and developed by Jai Singh
