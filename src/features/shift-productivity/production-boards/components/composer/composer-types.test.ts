// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  defaultsForKind,
  describeActiveWindow,
  deriveStatus,
  parseAttachments,
  parseKindData,
  type Attachment,
} from './composer-types'

describe('deriveStatus', () => {
  const NOW = new Date('2026-05-17T12:00:00Z')

  it('returns draft when isPublished is false regardless of dates', () => {
    expect(
      deriveStatus(
        { isPublished: false, publishAt: null, expiresAt: null },
        NOW
      ).state
    ).toBe('draft')
    expect(
      deriveStatus(
        {
          isPublished: false,
          publishAt: '2026-05-16T00:00:00Z',
          expiresAt: '2026-05-30T00:00:00Z',
        },
        NOW
      ).state
    ).toBe('draft')
  })

  it('returns scheduled when publishAt is in the future', () => {
    expect(
      deriveStatus(
        {
          isPublished: true,
          publishAt: '2026-05-18T00:00:00Z',
          expiresAt: null,
        },
        NOW
      ).state
    ).toBe('scheduled')
  })

  it('returns live when publishAt is past and expiresAt is null or future', () => {
    expect(
      deriveStatus(
        {
          isPublished: true,
          publishAt: '2026-05-16T00:00:00Z',
          expiresAt: null,
        },
        NOW
      ).state
    ).toBe('live')
    expect(
      deriveStatus(
        {
          isPublished: true,
          publishAt: null,
          expiresAt: '2026-05-20T00:00:00Z',
        },
        NOW
      ).state
    ).toBe('live')
  })

  it('returns expired when expiresAt is in the past', () => {
    expect(
      deriveStatus(
        {
          isPublished: true,
          publishAt: '2026-05-10T00:00:00Z',
          expiresAt: '2026-05-16T00:00:00Z',
        },
        NOW
      ).state
    ).toBe('expired')
  })
})

describe('describeActiveWindow', () => {
  const NOW = new Date('2026-05-17T12:00:00Z')

  it('describes a live post with no expiration', () => {
    expect(
      describeActiveWindow(
        { isPublished: true, publishAt: null, expiresAt: null },
        NOW
      )
    ).toContain('Live')
  })

  it('describes a live post with a future expiration', () => {
    const window = describeActiveWindow(
      {
        isPublished: true,
        publishAt: '2026-05-16T00:00:00Z',
        expiresAt: '2026-05-19T00:00:00Z',
      },
      NOW
    )
    expect(window).toMatch(/Live for/i)
    expect(window).toMatch(/d/) // days unit
  })

  it('describes scheduled posts with the publish moment', () => {
    expect(
      describeActiveWindow(
        {
          isPublished: true,
          publishAt: '2026-05-18T20:00:00Z',
          expiresAt: null,
        },
        NOW
      )
    ).toMatch(/Scheduled for/i)
  })

  it('describes expired posts with how long ago they expired', () => {
    expect(
      describeActiveWindow(
        {
          isPublished: true,
          publishAt: '2026-05-10T00:00:00Z',
          expiresAt: '2026-05-16T00:00:00Z',
        },
        NOW
      )
    ).toMatch(/Expired/)
  })

  it('returns the draft sentinel when isPublished is false', () => {
    expect(
      describeActiveWindow(
        { isPublished: false, publishAt: null, expiresAt: null },
        NOW
      )
    ).toBe('Not yet published')
  })
})

describe('defaultsForKind', () => {
  it('defaults safety alerts to warning + ack-required', () => {
    const v = defaultsForKind('safety_alert')
    expect(v.severity).toBe('warning')
    expect(v.acknowledgmentRequired).toBe(true)
  })

  it('defaults jobs to full-time employment + internal', () => {
    const v = defaultsForKind('job')
    expect(v.jobIsInternal).toBe(true)
    expect((v.kindData as { employment_type?: string }).employment_type).toBe(
      'full_time'
    )
  })

  it('defaults HR news to "other" category', () => {
    const v = defaultsForKind('hr_news')
    expect((v.kindData as { category?: string }).category).toBe('other')
  })

  it('defaults announcements to bare kindData', () => {
    const v = defaultsForKind('announcement')
    expect(v.acknowledgmentRequired).toBe(false)
    expect(Object.keys(v.kindData)).toHaveLength(0)
  })
})

describe('parseAttachments', () => {
  it('returns an empty array for non-array input', () => {
    expect(parseAttachments(null)).toEqual([])
    expect(parseAttachments(undefined)).toEqual([])
    expect(parseAttachments({ id: 'x' })).toEqual([])
  })

  it('drops entries missing required fields', () => {
    const out = parseAttachments([
      { id: 'a' }, // missing storage_path / mime_type / file_name
      {
        id: 'b',
        storage_path: 'org/post/b.jpg',
        mime_type: 'image/jpeg',
        file_name: 'b.jpg',
        size_bytes: 100,
        display_order: 0,
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('b')
  })

  it('sorts by display_order ascending', () => {
    const out = parseAttachments([
      {
        id: 'b',
        storage_path: 'p/b.jpg',
        mime_type: 'image/jpeg',
        file_name: 'b.jpg',
        size_bytes: 1,
        display_order: 2,
      },
      {
        id: 'a',
        storage_path: 'p/a.jpg',
        mime_type: 'image/jpeg',
        file_name: 'a.jpg',
        size_bytes: 1,
        display_order: 0,
      },
    ] satisfies Attachment[])
    expect(out.map((a) => a.id)).toEqual(['a', 'b'])
  })
})

describe('parseKindData', () => {
  it('keeps only allowed keys for safety_alert', () => {
    const out = parseKindData('safety_alert', {
      hazard_type: 'spill',
      affected_area_ids: ['area-1', 'area-2'],
      corrective_action: 'Cone off, mop up',
      mystery_extra: 'should-not-survive',
    }) as { hazard_type?: string; mystery_extra?: string }
    expect(out.hazard_type).toBe('spill')
    expect(out.mystery_extra).toBeUndefined()
  })

  it('coerces invalid enum values to undefined', () => {
    const out = parseKindData('hr_news', {
      category: 'not_a_category',
      author_name: 'Alex',
    }) as { category?: string; author_name?: string }
    expect(out.author_name).toBe('Alex')
    expect(out.category).toBeUndefined()
  })

  it('keeps numeric pay fields for jobs', () => {
    const out = parseKindData('job', {
      employment_type: 'part_time',
      pay_min: 18,
      pay_max: 22.5,
      pay_currency: 'USD',
      pay_period: 'hour',
    }) as { pay_min?: number; pay_period?: string }
    expect(out.pay_min).toBe(18)
    expect(out.pay_period).toBe('hour')
  })

  it('returns kind defaults for non-object input', () => {
    const out = parseKindData('hr_news', null) as { category?: string }
    expect(out.category).toBe('other')
  })
})

// Created and developed by Jai Singh
