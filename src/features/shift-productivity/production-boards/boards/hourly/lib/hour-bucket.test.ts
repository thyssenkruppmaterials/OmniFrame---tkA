// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  BOARD_CLOSING_HOUR,
  BOARD_HOURS,
  BOARD_OPENING_HOUR,
  bucketEventsByHour,
  collectDemonstratedSkills,
  computeBoardMetrics,
  computeHoursElapsed,
  effectiveTargetForBucket,
  formatHour,
  getAllHours,
  getCurrentBoardHour,
  getCurrentHour,
  getHourCellState,
  getLocalHour,
  isHourWithinShift,
  isWithinBoardHours,
  parseClockTime,
  rampForTargetAchievement,
  summariseBucket,
  targetKeyForEventType,
} from './hour-bucket'
import type { AssociateRow, HourBucket, HourTargets } from './types'

const NY = 'America/New_York'

describe('formatHour', () => {
  it('renders 12-hour wall labels for the four corners', () => {
    expect(formatHour(0)).toBe('12a')
    expect(formatHour(7)).toBe('7a')
    expect(formatHour(12)).toBe('12p')
    expect(formatHour(13)).toBe('1p')
    expect(formatHour(23)).toBe('11p')
  })
})

describe('getAllHours', () => {
  it('returns 24 hours starting at 0', () => {
    const hours = getAllHours()
    expect(hours).toHaveLength(24)
    expect(hours[0]).toBe(0)
    expect(hours[23]).toBe(23)
  })
})

describe('BOARD_HOURS / operating window', () => {
  it('exposes 13 columns spanning 6 AM through the 6 PM hour', () => {
    expect(BOARD_OPENING_HOUR).toBe(6)
    expect(BOARD_CLOSING_HOUR).toBe(19)
    expect(BOARD_HOURS).toHaveLength(13)
    expect(BOARD_HOURS[0]).toBe(6)
    expect(BOARD_HOURS[BOARD_HOURS.length - 1]).toBe(18)
  })

  it('isWithinBoardHours treats the close as exclusive', () => {
    expect(isWithinBoardHours(5)).toBe(false)
    expect(isWithinBoardHours(6)).toBe(true)
    expect(isWithinBoardHours(18)).toBe(true)
    expect(isWithinBoardHours(19)).toBe(false)
    expect(isWithinBoardHours(23)).toBe(false)
  })

  it('getCurrentBoardHour returns the hour during the window and null when closed', () => {
    // 2026-05-10T15:00:00Z → 11 AM EDT — inside window.
    expect(getCurrentBoardHour(NY, new Date('2026-05-10T15:00:00Z'))).toBe(11)
    // 2026-05-10T09:00:00Z → 5 AM EDT — pre-open.
    expect(getCurrentBoardHour(NY, new Date('2026-05-10T09:00:00Z'))).toBeNull()
    // 2026-05-10T23:30:00Z → 7:30 PM EDT — post-close.
    expect(getCurrentBoardHour(NY, new Date('2026-05-10T23:30:00Z'))).toBeNull()
  })
})

describe('getLocalHour / getCurrentHour', () => {
  it('extracts the local hour for a known UTC timestamp in NY', () => {
    // 2026-05-10T15:30:00Z is 11:30 AM EDT (UTC-4 in May).
    const h = getLocalHour('2026-05-10T15:30:00Z', NY)
    expect(h).toBe(11)
  })

  it('returns a number in [0, 23] from getCurrentHour', () => {
    const h = getCurrentHour(NY)
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(23)
  })
})

describe('targetKeyForEventType', () => {
  it('routes known prefixes to their per-hour targets', () => {
    expect(targetKeyForEventType('inbound_scan')).toBe('inbound_scans')
    expect(targetKeyForEventType('putaway')).toBe('put_aways')
    expect(targetKeyForEventType('putaway_confirm')).toBe('put_aways')
    expect(targetKeyForEventType('picking')).toBe('picking')
    expect(targetKeyForEventType('cycle_count')).toBe('cycle_counts')
    expect(targetKeyForEventType('something_else')).toBe('default')
  })

  // Kit workflow stages — migration 310. `kit_picking` reuses the
  // existing picking-per-hour target; the other three stages don't have
  // dedicated settings yet so they fall back to `default`.
  it('routes kit workflow stages correctly', () => {
    expect(targetKeyForEventType('kit_picking')).toBe('picking')
    expect(targetKeyForEventType('kit_building')).toBe('default')
    expect(targetKeyForEventType('kit_inspection')).toBe('default')
    expect(targetKeyForEventType('kit_dock_staging')).toBe('default')
  })
})

describe('bucketEventsByHour', () => {
  it('groups a Map<userId, events[]> by user and hour', () => {
    const eventsMap = new Map<
      string,
      Array<{ type: string; timestamp: string }>
    >([
      [
        'u-1',
        [
          { type: 'picking', timestamp: '2026-05-10T15:00:00Z' },
          { type: 'picking', timestamp: '2026-05-10T15:30:00Z' },
          { type: 'inbound_scan', timestamp: '2026-05-10T16:00:00Z' },
        ],
      ],
      ['u-2', [{ type: 'put_aways', timestamp: '2026-05-10T17:00:00Z' }]],
    ])

    const bucketed = bucketEventsByHour(eventsMap, NY)
    expect(bucketed.size).toBe(2)
    const u1 = bucketed.get('u-1')!
    expect(u1.size).toBe(2)
    expect(u1.get(11)).toEqual({ picking: 2 })
    expect(u1.get(12)).toEqual({ inbound_scan: 1 })
    const u2 = bucketed.get('u-2')!
    expect(u2.get(13)).toEqual({ put_aways: 1 })
  })

  it('accepts a flat array form', () => {
    const events = [
      { userId: 'u-1', type: 'picking', timestamp: '2026-05-10T15:30:00Z' },
      { userId: 'u-1', type: 'picking', timestamp: '2026-05-10T15:45:00Z' },
    ]
    const bucketed = bucketEventsByHour(events, NY)
    expect(bucketed.get('u-1')?.get(11)).toEqual({ picking: 2 })
  })

  it('drops events that fall outside the 6 AM – 7 PM operating window', () => {
    // 2026-05-10T09:45:00Z → 5:45 AM EDT (pre-open)
    // 2026-05-10T23:30:00Z → 7:30 PM EDT (post-close)
    // 2026-05-10T15:30:00Z → 11:30 AM EDT (in-window)
    const events = [
      { userId: 'u-1', type: 'picking', timestamp: '2026-05-10T09:45:00Z' },
      { userId: 'u-1', type: 'picking', timestamp: '2026-05-10T15:30:00Z' },
      { userId: 'u-1', type: 'picking', timestamp: '2026-05-10T23:30:00Z' },
    ]
    const bucketed = bucketEventsByHour(events, NY)
    const u1 = bucketed.get('u-1')!
    expect(u1.size).toBe(1)
    expect(u1.get(11)).toEqual({ picking: 1 })
    expect(u1.get(5)).toBeUndefined()
    expect(u1.get(19)).toBeUndefined()
    // Per-user total should reflect only the in-window event.
    let userTotal = 0
    for (const byType of u1.values()) {
      for (const k in byType) userTotal += byType[k] ?? 0
    }
    expect(userTotal).toBe(1)
  })
})

describe('getHourCellState', () => {
  it('returns off-shift when the hour is outside the shift', () => {
    expect(getHourCellState({ count: 12, target: 10, hasShift: false })).toBe(
      'off-shift'
    )
  })

  it('returns no-activity for empty cells with shift', () => {
    expect(getHourCellState({ count: 0, target: 10, hasShift: true })).toBe(
      'no-activity'
    )
  })

  it('returns below for activity under 50% of target', () => {
    expect(getHourCellState({ count: 2, target: 10, hasShift: true })).toBe(
      'below'
    )
  })

  it('returns on for activity between 50% and 100% of target', () => {
    expect(getHourCellState({ count: 5, target: 10, hasShift: true })).toBe(
      'on'
    )
    expect(getHourCellState({ count: 10, target: 10, hasShift: true })).toBe(
      'on'
    )
  })

  it('returns above when count exceeds target', () => {
    expect(getHourCellState({ count: 15, target: 10, hasShift: true })).toBe(
      'above'
    )
  })

  it('falls back to on when target is non-positive but activity exists', () => {
    expect(getHourCellState({ count: 3, target: 0, hasShift: true })).toBe('on')
  })
})

describe('effectiveTargetForBucket', () => {
  const targets = {
    inbound_scans: 30,
    put_aways: 15,
    picking: 20,
    cycle_counts: 5,
    default: 20,
  }

  it('returns default for empty buckets', () => {
    expect(effectiveTargetForBucket({}, targets)).toBe(20)
  })

  it('returns the single-type target when only one type is present', () => {
    expect(effectiveTargetForBucket({ picking: 7 }, targets)).toBe(20)
    expect(effectiveTargetForBucket({ inbound_scan: 9 }, targets)).toBe(30)
  })

  it('returns a weighted average for mixed buckets', () => {
    // 4 picks @ 20 + 6 putaways @ 15 = 80 + 90 = 170 / 10 = 17 (rounded).
    expect(effectiveTargetForBucket({ picking: 4, putaway: 6 }, targets)).toBe(
      17
    )
  })
})

describe('isHourWithinShift', () => {
  it('treats unassigned shifts as always on-shift', () => {
    expect(isHourWithinShift(7, null, null)).toBe(true)
  })

  it('detects same-day shift overlap', () => {
    // 7:00-15:30 shift
    const start = 7 * 60
    const end = 15 * 60 + 30
    expect(isHourWithinShift(7, start, end)).toBe(true)
    expect(isHourWithinShift(15, start, end)).toBe(true)
    expect(isHourWithinShift(16, start, end)).toBe(false)
    expect(isHourWithinShift(6, start, end)).toBe(false)
  })

  it('handles overnight shifts that wrap past midnight', () => {
    // 22:00 to 06:00 next morning
    const start = 22 * 60
    const end = 6 * 60
    expect(isHourWithinShift(23, start, end)).toBe(true)
    expect(isHourWithinShift(0, start, end)).toBe(true)
    expect(isHourWithinShift(5, start, end)).toBe(true)
    expect(isHourWithinShift(7, start, end)).toBe(false)
    expect(isHourWithinShift(20, start, end)).toBe(false)
  })

  it('handles a 5 AM – 9 AM shift trimmed to the operating window', () => {
    // Shift extends partly before the building opens. Only hours 6, 7, 8
    // are in the window AND inside the shift; 9 is the exclusive end of
    // the shift (boundary excluded); 5 is excluded by the board-hours
    // filter entirely so it never renders.
    const start = 5 * 60
    const end = 9 * 60
    const onShiftWithinBoard = BOARD_HOURS.filter((h) =>
      isHourWithinShift(h, start, end)
    )
    expect(onShiftWithinBoard).toEqual([6, 7, 8])
    // 5 AM is on-shift but outside the board window — both checks must
    // be true for a cell to render as on-shift.
    expect(isHourWithinShift(5, start, end)).toBe(true)
    expect(isWithinBoardHours(5)).toBe(false)
    // 9 AM is in the window but the shift is exclusive at the end.
    expect(isHourWithinShift(9, start, end)).toBe(false)
  })
})

describe('parseClockTime', () => {
  it('parses HH:MM and HH:MM:SS', () => {
    expect(parseClockTime('07:30')).toBe(450)
    expect(parseClockTime('07:30:15')).toBe(450)
    expect(parseClockTime('00:00')).toBe(0)
    expect(parseClockTime('23:59')).toBe(23 * 60 + 59)
  })

  it('rejects invalid input', () => {
    expect(parseClockTime('')).toBeNull()
    expect(parseClockTime(null)).toBeNull()
    expect(parseClockTime('25:00')).toBeNull()
    expect(parseClockTime('garbage')).toBeNull()
  })
})

describe('collectDemonstratedSkills', () => {
  it('returns an empty set for missing user buckets', () => {
    expect(collectDemonstratedSkills(undefined).size).toBe(0)
  })

  it('aggregates canonical skill ids across all hours and event types', () => {
    const buckets = new Map<number, HourBucket>([
      [9, summariseBucket(9, { picking: 4, putaway: 2 })],
      [10, summariseBucket(10, { picking: 1 })],
      [11, summariseBucket(11, { final_pack: 3 })],
    ])
    const skills = collectDemonstratedSkills(buckets)
    expect(skills.has('picker')).toBe(true)
    expect(skills.has('putaway')).toBe(true)
    expect(skills.has('packer')).toBe(true)
    expect(skills.has('shipper')).toBe(false)
    expect(skills.size).toBe(3)
  })

  it('ignores unmapped event types and zero-count entries', () => {
    const buckets = new Map<number, HourBucket>([
      [9, summariseBucket(9, { customer_response: 5, picking: 0 })],
    ])
    expect(collectDemonstratedSkills(buckets).size).toBe(0)
  })
})

describe('rampForTargetAchievement', () => {
  it('buckets percentages into the cell-state ramp', () => {
    expect(rampForTargetAchievement(150)).toBe('above')
    expect(rampForTargetAchievement(100)).toBe('above')
    expect(rampForTargetAchievement(75)).toBe('on')
    expect(rampForTargetAchievement(50)).toBe('on')
    expect(rampForTargetAchievement(40)).toBe('below')
    expect(rampForTargetAchievement(25)).toBe('below')
    expect(rampForTargetAchievement(10)).toBe('muted')
    expect(rampForTargetAchievement(0)).toBe('muted')
  })
})

describe('computeHoursElapsed', () => {
  it('returns the full 13-hour operating window for historical days', () => {
    expect(computeHoursElapsed({ isToday: false, timezone: NY })).toBe(
      BOARD_HOURS.length
    )
    expect(BOARD_HOURS.length).toBe(13)
  })

  it('returns hours past 6 AM in tz for today during the window', () => {
    // 2026-05-10T15:30:00Z → 11:30 EDT → 11:30 − 06:00 = 5.5 hours.
    const now = new Date('2026-05-10T15:30:00Z')
    const elapsed = computeHoursElapsed({
      isToday: true,
      timezone: NY,
      now,
    })
    expect(elapsed).toBeCloseTo(5.5, 1)
  })

  it('returns 0 before the building opens', () => {
    // 2026-05-10T09:00:00Z → 05:00 EDT (1h before open).
    const now = new Date('2026-05-10T09:00:00Z')
    const elapsed = computeHoursElapsed({
      isToday: true,
      timezone: NY,
      now,
    })
    expect(elapsed).toBe(0)
  })

  it('floors at 5 minutes shortly after open so avg/hr stays finite', () => {
    // 2026-05-10T10:00:00Z → 06:00 EDT exactly → 0 minutes since open;
    // floor to 5/60 (the historic divide-by-zero guard).
    const now = new Date('2026-05-10T10:00:00Z')
    const elapsed = computeHoursElapsed({
      isToday: true,
      timezone: NY,
      now,
    })
    expect(elapsed).toBeCloseTo(5 / 60, 4)
  })

  it('clamps at 13 hours after the building closes', () => {
    // 2026-05-10T23:30:00Z → 19:30 EDT (30 min after close); should
    // report a full operating-day denominator.
    const now = new Date('2026-05-10T23:30:00Z')
    const elapsed = computeHoursElapsed({
      isToday: true,
      timezone: NY,
      now,
    })
    expect(elapsed).toBe(BOARD_HOURS.length)
  })
})

describe('computeBoardMetrics', () => {
  const targets: HourTargets = {
    inbound_scans: 30,
    put_aways: 15,
    picking: 20,
    cycle_counts: 5,
    default: 20,
  }

  function mkAssociate(userId: string, fullName: string): AssociateRow {
    return {
      userId,
      fullName,
      shiftStartMinutes: null,
      shiftEndMinutes: null,
      primarySkill: 'warehouse',
      demonstratedSkills: new Set(),
      areaColor: 'emerald',
    }
  }

  function mkBuckets(
    rows: Array<[string, Array<[number, Record<string, number>]>]>
  ): Map<string, Map<number, HourBucket>> {
    const out = new Map<string, Map<number, HourBucket>>()
    for (const [userId, hours] of rows) {
      const inner = new Map<number, HourBucket>()
      for (const [hour, byType] of hours)
        inner.set(hour, summariseBucket(hour, byType))
      out.set(userId, inner)
    }
    return out
  }

  // Lock to a known instant — 2026-05-10T15:00Z = 11:00 EDT (NY) →
  // hoursElapsed today = 11:00 − 06:00 (open) = 5.0 inside the
  // operating window.
  const now = new Date('2026-05-10T15:00:00Z')

  it('above target — three associates pacing well above target/hour', () => {
    const associates = [
      mkAssociate('a', 'A'),
      mkAssociate('b', 'B'),
      mkAssociate('c', 'C'),
    ]
    // 660 picks across 3 associates over 5h = 132/hr (6.6x the 20 target).
    const buckets = mkBuckets([
      [
        'a',
        [
          [8, { picking: 100 }],
          [9, { picking: 120 }],
        ],
      ],
      [
        'b',
        [
          [10, { picking: 150 }],
          [11, { picking: 100 }],
        ],
      ],
      [
        'c',
        [
          [7, { picking: 90 }],
          [8, { picking: 100 }],
        ],
      ],
    ])
    const m = computeBoardMetrics({
      associates,
      hourBuckets: buckets,
      hourTargets: targets,
      isToday: true,
      timezone: NY,
      now,
    })
    expect(m.activeAssociates).toBe(3)
    expect(m.totalAssigned).toBe(3)
    expect(m.totalCompletions).toBe(660)
    expect(m.hoursElapsed).toBeCloseTo(5, 4)
    // 660 / 5 = 132/hr; 132/20 * 100 = 660%.
    expect(m.avgPerHour).toBe(132)
    expect(m.targetAchievementPercent).toBe(660)
    expect(m.isPreOpen).toBe(false)
    expect(m.ramp).toBe('above')
  })

  it('on target — pace lands inside the on-target band', () => {
    const associates = [mkAssociate('a', 'A'), mkAssociate('b', 'B')]
    // 75 / 5h = 15 = 75% of the 20 target → ramp 'on'.
    const buckets = mkBuckets([
      ['a', [[9, { picking: 35 }]]],
      ['b', [[10, { picking: 40 }]]],
    ])
    const m = computeBoardMetrics({
      associates,
      hourBuckets: buckets,
      hourTargets: targets,
      isToday: true,
      timezone: NY,
      now,
    })
    expect(m.activeAssociates).toBe(2)
    expect(m.totalCompletions).toBe(75)
    expect(m.avgPerHour).toBe(15)
    expect(m.targetAchievementPercent).toBe(75)
    expect(m.ramp).toBe('on')
  })

  it('no activity — zero events across the roster', () => {
    const associates = [mkAssociate('a', 'A'), mkAssociate('b', 'B')]
    const buckets = mkBuckets([])
    const m = computeBoardMetrics({
      associates,
      hourBuckets: buckets,
      hourTargets: targets,
      isToday: true,
      timezone: NY,
      now,
    })
    expect(m.activeAssociates).toBe(0)
    expect(m.totalAssigned).toBe(2)
    expect(m.totalCompletions).toBe(0)
    expect(m.avgPerHour).toBe(0)
    expect(m.targetAchievementPercent).toBe(0)
    expect(m.isPreOpen).toBe(false)
    expect(m.ramp).toBe('muted')
  })

  it('caps target achievement at 999% for blowout days', () => {
    const associates = [mkAssociate('a', 'A')]
    // 100k events / 5h = 20k/hr / 20 target → 100,000% → cap at 999.
    const buckets = mkBuckets([['a', [[9, { picking: 100_000 }]]]])
    const m = computeBoardMetrics({
      associates,
      hourBuckets: buckets,
      hourTargets: targets,
      isToday: true,
      timezone: NY,
      now,
    })
    expect(m.targetAchievementPercent).toBe(999)
    expect(m.ramp).toBe('above')
  })

  it('historical day uses the 13-hour operating-window denominator', () => {
    const associates = [mkAssociate('a', 'A')]
    // 234 / 13 = 18; 18/20 * 100 = 90% → ramp 'on'.
    const buckets = mkBuckets([['a', [[7, { picking: 234 }]]]])
    const m = computeBoardMetrics({
      associates,
      hourBuckets: buckets,
      hourTargets: targets,
      isToday: false,
      timezone: NY,
      now,
    })
    expect(m.hoursElapsed).toBe(13)
    expect(m.avgPerHour).toBe(18)
    expect(m.targetAchievementPercent).toBe(90)
    expect(m.isPreOpen).toBe(false)
    expect(m.ramp).toBe('on')
  })

  it('pre-open today reports hoursElapsed = 0, isPreOpen = true, ramp muted', () => {
    // 2026-05-10T09:00:00Z → 05:00 EDT — 1h before the building opens.
    const preOpenNow = new Date('2026-05-10T09:00:00Z')
    const associates = [mkAssociate('a', 'A')]
    // Even if events somehow exist (in practice `bucketEventsByHour`
    // filters them), the strip should not divide by zero.
    const buckets = mkBuckets([['a', [[7, { picking: 25 }]]]])
    const m = computeBoardMetrics({
      associates,
      hourBuckets: buckets,
      hourTargets: targets,
      isToday: true,
      timezone: NY,
      now: preOpenNow,
    })
    expect(m.hoursElapsed).toBe(0)
    expect(m.isPreOpen).toBe(true)
    expect(m.avgPerHour).toBe(0)
    expect(m.targetAchievementPercent).toBe(0)
    expect(m.ramp).toBe('muted')
  })
})

// Created and developed by Jai Singh
