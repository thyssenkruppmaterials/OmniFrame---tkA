// Created and developed by Jai Singh
/**
 * useUsageStats — verify each query hits the right Supabase table /
 * filter via `supabaseRead` (NEVER `supabase`).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
// Bypass React Query — we only want to test the service-layer wiring.
// Each hook calls into omnibeltAdminService internally; we exercise the
// service directly so the test is independent of @testing-library.
import { omnibeltAdminService } from '../services/omnibelt-admin.service'

// `vi.hoisted` lifts these mock fns above the `vi.mock` factory so the
// factory body can reference them safely (vi.mock calls are hoisted to
// the top of the module by Vitest's transform).
const { readFromMock, writeFromMock } = vi.hoisted(() => ({
  readFromMock: vi.fn(),
  writeFromMock: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: writeFromMock },
  supabaseRead: { from: readFromMock },
}))

vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: () => ({
    authState: {
      isAuthenticated: true,
      profile: { organization_id: 'org-test' },
    },
  }),
}))

function makeChain<T>(result: { data: T; error: null | { message: string } }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => result),
    execute: vi.fn(async () => result),
    then: (
      onFulfilled: (v: {
        data: T
        error: null | { message: string }
      }) => unknown
    ) => Promise.resolve(result).then(onFulfilled),
  }
  return chain
}

beforeEach(() => {
  readFromMock.mockReset()
  writeFromMock.mockReset()
})

describe('omnibeltAdminService.getEventsLast24h', () => {
  it('reads from omnibelt_tool_events_24h_mv via supabaseRead', async () => {
    const sample = [
      {
        organization_id: 'org-test',
        tool_id: 'build_info',
        event_type: 'tool_launch',
        bucket_hour: '2026-05-24T12:00:00Z',
        event_count: 5,
        user_count: 2,
      },
    ]
    readFromMock.mockReturnValue(makeChain({ data: sample, error: null }))

    const result = await omnibeltAdminService.getEventsLast24h()

    expect(readFromMock).toHaveBeenCalledWith('omnibelt_tool_events_24h_mv')
    expect(writeFromMock).not.toHaveBeenCalled()
    expect(result).toEqual(sample)
  })
})

describe('omnibeltAdminService.getActiveUsersLast5m', () => {
  it('reads from omnibelt_tool_events with belt_visible filter, returns unique user count', async () => {
    const sample = [{ user_id: 'u-1' }, { user_id: 'u-2' }, { user_id: 'u-1' }]
    const chain = makeChain({ data: sample, error: null })
    readFromMock.mockReturnValue(chain)

    const result = await omnibeltAdminService.getActiveUsersLast5m()

    expect(readFromMock).toHaveBeenCalledWith('omnibelt_tool_events')
    expect(chain.eq).toHaveBeenCalledWith('event_type', 'belt_visible')
    expect(chain.gte).toHaveBeenCalled()
    expect(writeFromMock).not.toHaveBeenCalled()
    expect(result).toBe(2)
  })

  it('returns 0 when no rows', async () => {
    readFromMock.mockReturnValue(makeChain({ data: [], error: null }))
    expect(await omnibeltAdminService.getActiveUsersLast5m()).toBe(0)
  })
})

describe('omnibeltAdminService.getRecentEvents', () => {
  it('reads via supabaseRead with provided limit', async () => {
    const chain = makeChain({ data: [], error: null })
    readFromMock.mockReturnValue(chain)

    await omnibeltAdminService.getRecentEvents(25)

    expect(readFromMock).toHaveBeenCalledWith('omnibelt_tool_events')
    expect(chain.limit).toHaveBeenCalledWith(25)
    expect(chain.order).toHaveBeenCalledWith('occurred_at', {
      ascending: false,
    })
  })
})

describe('omnibeltAdminService.getKillSwitch', () => {
  it('reads via supabaseRead from settings table', async () => {
    readFromMock.mockReturnValue(
      makeChain({
        data: {
          value: { enabled: false },
          updated_at: '2026-05-24T12:00:00Z',
          user_id: null,
        },
        error: null,
      })
    )

    const result = await omnibeltAdminService.getKillSwitch()
    expect(readFromMock).toHaveBeenCalledWith('settings')
    expect(result.enabled).toBe(false)
    expect(result.source).toBe('org')
  })

  it('fail-open returns enabled=true with source=none on empty row', async () => {
    readFromMock.mockReturnValue(makeChain({ data: null, error: null }))
    const result = await omnibeltAdminService.getKillSwitch()
    expect(result.enabled).toBe(true)
    expect(result.source).toBe('none')
  })
})

// Created and developed by Jai Singh
