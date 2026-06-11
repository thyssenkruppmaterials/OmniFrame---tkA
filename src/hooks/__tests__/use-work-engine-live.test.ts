// Created and developed by Jai Singh
/**
 * Phase 13.4 — Operation Control reducers deterministic under replay.
 *
 * The reducer is a pure function. Replaying the same event log MUST
 * produce identical state — that's how the canvas confidently reconciles a
 * paused frame with the live stream when the user toggles "Resume".
 */
import { describe, it, expect, vi } from 'vitest'

// Stub the supabase client transitive import — the reducer is pure.
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))
vi.mock('@/lib/auth/unified-auth-provider', () => ({
  useUnifiedAuth: () => ({ authState: { profile: null } }),
}))

const { __testing } = await import('../use-work-engine-live')
const { reducer, INITIAL, severityFor } = __testing

describe('useWorkEngineLive reducer', () => {
  it('merge_health computes severities from oldest_reservation_age', () => {
    expect(severityFor(0, 0, 60)).toBe('idle')
    expect(severityFor(2, 60, 60)).toBe('healthy')
    // 80% of 60min × 60s = 2880s
    expect(severityFor(5, 3000, 60)).toBe('stressed')
    expect(severityFor(1, 3700, 60)).toBe('breach')
  })

  it('produces identical state under replay', () => {
    const events: Array<Parameters<typeof reducer>[1]> = [
      {
        type: 'merge_health',
        rows: [
          {
            organization_id: 'o',
            task_type: 'cycle_count',
            priority: 'normal',
            status: 'pending',
            open_count: 5,
            oldest_pending_age_s: 30,
            oldest_reservation_age_s: 0,
          },
        ],
      },
      {
        type: 'task_pushed',
        payload: {
          task_id: 't1',
          task_type: 'cycle_count',
          priority: 'normal',
          user_id: 'u1',
        },
      },
    ]
    let s1 = INITIAL
    let s2 = INITIAL
    for (const e of events) {
      s1 = reducer(s1, e)
    }
    for (const e of events) {
      s2 = reducer(s2, e)
    }
    // Strip timing-sensitive lastTickAt for the equality check.
    expect({ ...s1, lastTickAt: null }).toEqual({ ...s2, lastTickAt: null })
  })

  it('ack_alert flips the alert without removing it', () => {
    const seeded = reducer(INITIAL, {
      type: 'work_event',
      payload: {
        id: 'e1',
        event_type: 'pin_failed',
        payload: {},
        at: '2026-05-02T12:00:00Z',
      },
    })
    expect(seeded.alerts[0].acked).toBe(false)
    const next = reducer(seeded, { type: 'ack_alert', id: 'e1' })
    expect(next.alerts[0].acked).toBe(true)
    expect(next.alerts).toHaveLength(1)
  })
})

// Created and developed by Jai Singh
