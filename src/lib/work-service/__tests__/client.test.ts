// Created and developed by Jai Singh
import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Tests for the work-service client's error handling, specifically:
 * - 200 responses with `success: false` should throw
 * - Non-2xx responses should throw with server error message
 * - 204 empty responses should return undefined
 */

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
        error: null,
      }),
    },
  },
}))

beforeEach(() => {
  mockFetch.mockReset()
})

describe('work-service client fetchWithAuth', () => {
  it('throws on HTTP 4xx/5xx', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: () => Promise.resolve({ error: 'Invalid count ID' }),
    })

    const { workServiceClient } = await import('@/lib/work-service/client')

    await expect(workServiceClient.getQueue()).rejects.toThrow(
      'Invalid count ID'
    )
  })

  it('throws on 200 with success=false', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: false,
          message: 'Cycle count not found or not in progress',
        }),
    })

    const { workServiceClient } = await import('@/lib/work-service/client')

    await expect(workServiceClient.getQueue()).rejects.toThrow(
      'Cycle count not found or not in progress'
    )
  })

  it('returns data on 200 with success=true', async () => {
    const mockTasks = [{ id: '1', count_number: 'CC-001' }]
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockTasks),
    })

    const { workServiceClient } = await import('@/lib/work-service/client')

    const result = await workServiceClient.getQueue()
    expect(result).toEqual(mockTasks)
  })

  it('returns undefined for 204 No Content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
    })

    const { workServiceClient } = await import('@/lib/work-service/client')

    const result = await workServiceClient.getQueue()
    expect(result).toBeUndefined()
  })

  // 2026-05-07 noise fix: the Rust /api/v1/work/claim route uses
  // `{ success: false, task: null }` as the canonical "queue idle" signal.
  // `claimNext()` opts in to `allowFalseSuccess` so this resolves with the
  // body verbatim instead of throwing — empty work queue is a normal
  // product state, NOT an error. See `Debug/Fix-RF-CycleCount-Empty-Queue-Noise.md`.
  it('claimNext returns the body when server signals empty queue (success=false, task=null)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: false,
          message: 'No tasks available',
          task: null,
        }),
    })

    const { workServiceClient } = await import('@/lib/work-service/client')

    const response = await workServiceClient.claimNext()
    expect(response.success).toBe(false)
    expect(response.task).toBeNull()
    expect(response.message).toBe('No tasks available')
  })

  it('claimNext still throws on HTTP 5xx', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.resolve({ error: 'work service down' }),
    })

    const { workServiceClient } = await import('@/lib/work-service/client')

    await expect(workServiceClient.claimNext()).rejects.toThrow(
      'work service down'
    )
  })
})

// Created and developed by Jai Singh
