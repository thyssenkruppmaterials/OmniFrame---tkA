// Created and developed by Jai Singh
/**
 * Smoke tests for <CardRenderer> dispatch — every variant renders
 * something with the right `data-card-variant` attribute.
 */
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PostRow } from '../../hooks/use-board-posts'
import { CardRenderer } from './card-renderer'
import type { BoardCard, CardVariant } from './card-variant'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://test.local/${path}` },
        }),
      }),
    },
  },
}))

function makeCard(variant: CardVariant): BoardCard {
  const post: PostRow = {
    id: `p-${variant}`,
    organizationId: 'org-1',
    scope: 'announcement',
    workingAreaId: null,
    workingAreaName: null,
    branchId: null,
    branchName: null,
    title: `Title ${variant}`,
    body: `Body ${variant}`,
    severity: 'info',
    colorHex: null,
    imageUrl: null,
    publishedAt: '2026-05-17T00:00:00Z',
    expiresAt: null,
    isPinned: false,
    isPublished: true,
    priority: 'normal',
    attachments: [],
    kindData: {},
    repromptIntervalMinutes: null,
    acknowledgedRequired: false,
    postedBy: null,
    postedByName: null,
    ackCount: 0,
    acknowledgedByCurrentUser: false,
    createdAt: '2026-05-17T00:00:00Z',
    updatedAt: '2026-05-17T00:00:00Z',
  }
  return {
    layoutId: null,
    postKind: 'post',
    post,
    gridX: 0,
    gridY: 0,
    gridW: 3,
    gridH: 2,
    cardVariant: variant,
    variantConfig: {},
    isDefaultLayout: true,
  }
}

describe('<CardRenderer>', () => {
  const variants: CardVariant[] = [
    'classic',
    'banner',
    'gallery',
    'spotlight',
    'quote',
  ]
  it.each(variants)('renders the %s variant', (variant) => {
    const card = makeCard(variant)
    const { container } = render(
      <CardRenderer card={card} isTv={false} showEditAffordances={false} />
    )
    // gallery with 0 attachments falls back to classic.
    const expected = variant === 'gallery' ? 'classic' : variant
    expect(
      container.querySelector(`[data-card-variant="${expected}"]`)
    ).not.toBeNull()
  })

  it('renders the post title in every variant', () => {
    for (const variant of variants) {
      const card = makeCard(variant)
      const { container, unmount } = render(
        <CardRenderer card={card} isTv={false} showEditAffordances={false} />
      )
      expect(container.textContent).toContain(`Title ${variant}`)
      unmount()
    }
  })
})

// Created and developed by Jai Singh
