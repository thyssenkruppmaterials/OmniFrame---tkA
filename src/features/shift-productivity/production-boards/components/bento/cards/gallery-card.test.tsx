// Created and developed by Jai Singh
/**
 * Smoke tests for the GalleryCard variant: dispatches to ClassicCard
 * when fewer than 2 images, and renders the slide N/M indicator when
 * 2+ images are present.
 *
 * We don't drive the auto-advance timer here — that would require fake
 * timers + flush of framer-motion's animations, which is brittle.
 * Instead we verify the initial slide indicator and the dot pager
 * count, which is the affordance most users rely on.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PostRow, PostAttachment } from '../../../hooks/use-board-posts'
import { GalleryCard } from './gallery-card'

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

function makeImage(id: string, order = 0, caption?: string): PostAttachment {
  return {
    id,
    storage_path: `org/post/${id}.jpg`,
    mime_type: 'image/jpeg',
    file_name: `${id}.jpg`,
    caption,
    width: 1024,
    height: 768,
    size_bytes: 1234,
    display_order: order,
  }
}

function makePost(attachments: PostAttachment[]): PostRow {
  return {
    id: 'p-1',
    organizationId: 'org-1',
    scope: 'announcement',
    workingAreaId: null,
    workingAreaName: null,
    branchId: null,
    branchName: null,
    title: 'Gallery title',
    body: 'Gallery body',
    severity: 'info',
    colorHex: null,
    imageUrl: null,
    publishedAt: '2026-05-17T00:00:00Z',
    expiresAt: null,
    isPinned: false,
    isPublished: true,
    priority: 'normal',
    attachments,
    kindData: {},
    repromptIntervalMinutes: null,
    acknowledgedRequired: false,
    postedBy: null,
    postedByName: 'Test User',
    ackCount: 0,
    acknowledgedByCurrentUser: false,
    createdAt: '2026-05-17T00:00:00Z',
    updatedAt: '2026-05-17T00:00:00Z',
  }
}

describe('<GalleryCard>', () => {
  it('falls back to classic-card layout with 0 images', () => {
    const post = makePost([])
    const { container } = render(
      <GalleryCard
        postKind='post'
        post={post}
        isTv={false}
        showEditAffordances={false}
        config={{}}
      />
    )
    expect(
      container.querySelector('[data-card-variant="classic"]')
    ).not.toBeNull()
    expect(container.querySelector('[data-card-variant="gallery"]')).toBeNull()
  })

  it('falls back to classic-card layout with 1 image', () => {
    const post = makePost([makeImage('a')])
    const { container } = render(
      <GalleryCard
        postKind='post'
        post={post}
        isTv={false}
        showEditAffordances={false}
        config={{}}
      />
    )
    expect(
      container.querySelector('[data-card-variant="classic"]')
    ).not.toBeNull()
  })

  it('renders the gallery layout with 2+ images', () => {
    const post = makePost([
      makeImage('a', 0, 'First'),
      makeImage('b', 1, 'Second'),
    ])
    const { container } = render(
      <GalleryCard
        postKind='post'
        post={post}
        isTv={false}
        showEditAffordances={false}
        config={{}}
      />
    )
    expect(
      container.querySelector('[data-card-variant="gallery"]')
    ).not.toBeNull()
    // Slide indicator "1 / 2".
    expect(screen.getByText(/1 \/ 2/)).toBeTruthy()
    // Dot pager has one button per image.
    const dots = container.querySelectorAll(
      'button[aria-label^="Jump to image"]'
    )
    expect(dots.length).toBe(2)
  })

  it('shows the first slide caption initially', () => {
    const post = makePost([
      makeImage('a', 0, 'First caption'),
      makeImage('b', 1, 'Second caption'),
    ])
    render(
      <GalleryCard
        postKind='post'
        post={post}
        isTv={false}
        showEditAffordances={false}
        config={{}}
      />
    )
    expect(screen.getByText('First caption')).toBeTruthy()
  })

  it('respects display_order when sorting attachments', () => {
    const post = makePost([
      makeImage('b', 1, 'Second'),
      makeImage('a', 0, 'First'),
    ])
    render(
      <GalleryCard
        postKind='post'
        post={post}
        isTv={false}
        showEditAffordances={false}
        config={{}}
      />
    )
    // First slide should be the order-0 attachment ('a' → 'First').
    expect(screen.getByText('First')).toBeTruthy()
  })

  it('hides chevrons in TV mode', () => {
    const post = makePost([makeImage('a', 0), makeImage('b', 1)])
    const { container } = render(
      <GalleryCard
        postKind='post'
        post={post}
        isTv
        showEditAffordances={false}
        config={{}}
      />
    )
    expect(
      container.querySelector('button[aria-label="Previous image"]')
    ).toBeNull()
    expect(
      container.querySelector('button[aria-label="Next image"]')
    ).toBeNull()
  })
})

// Created and developed by Jai Singh
