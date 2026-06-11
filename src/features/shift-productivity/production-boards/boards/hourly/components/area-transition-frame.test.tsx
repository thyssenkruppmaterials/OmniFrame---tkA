// Created and developed by Jai Singh
/**
 * Smoke test for <AreaTransitionFrame>.
 *
 * We don't try to test the actual framer-motion timeline (jsdom + animations
 * is brittle). Instead we mock framer-motion to a passthrough and assert
 * the structural contract: the chapter overlay only mounts when both
 * `isTv` AND `isRotating` are true AND the active area value just changed.
 */
import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AreaTransitionFrame } from './area-transition-frame'

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    createElement('div', null, children),
  MotionConfig: ({ children }: { children: React.ReactNode }) =>
    createElement('div', null, children),
  motion: {
    div: ({
      children,
      ...rest
    }: {
      children?: React.ReactNode
      [key: string]: unknown
    }) => {
      // Strip motion-only props that would otherwise warn as unknown DOM attrs.
      const {
        variants: _v,
        initial: _i,
        animate: _a,
        exit: _e,
        transition: _t,
        ...domProps
      } = rest as Record<string, unknown>
      return createElement('div', domProps, children)
    },
  },
}))

afterEach(() => {
  vi.clearAllMocks()
})

const baseProps = {
  activeAreaValue: 'OUTBOUND',
  areaCode: 'OUTBOUND',
  areaName: 'Outbound',
  associateCount: 12,
}

describe('<AreaTransitionFrame>', () => {
  it('renders children verbatim', () => {
    render(
      <AreaTransitionFrame {...baseProps} isTv={false} isRotating={false}>
        <div data-testid='inner'>body</div>
      </AreaTransitionFrame>
    )
    expect(screen.getByTestId('inner')).toBeDefined()
  })

  it('does NOT mount the chapter overlay outside TV+rotating mode', () => {
    const { rerender } = render(
      <AreaTransitionFrame {...baseProps} isTv={false} isRotating={false}>
        <div data-testid='inner'>a</div>
      </AreaTransitionFrame>
    )
    rerender(
      <AreaTransitionFrame
        {...baseProps}
        activeAreaValue='INBOUND'
        areaCode='INBOUND'
        areaName='Inbound'
        isTv={false}
        isRotating={false}
      >
        <div data-testid='inner'>b</div>
      </AreaTransitionFrame>
    )

    expect(
      document.querySelector('[data-component="area-chapter-overlay"]')
    ).toBeNull()
  })

  it('does NOT mount the chapter overlay in TV mode when not rotating', () => {
    const { rerender } = render(
      <AreaTransitionFrame {...baseProps} isTv={true} isRotating={false}>
        <div data-testid='inner'>a</div>
      </AreaTransitionFrame>
    )
    rerender(
      <AreaTransitionFrame
        {...baseProps}
        activeAreaValue='INBOUND'
        areaCode='INBOUND'
        areaName='Inbound'
        isTv={true}
        isRotating={false}
      >
        <div data-testid='inner'>b</div>
      </AreaTransitionFrame>
    )

    expect(
      document.querySelector('[data-component="area-chapter-overlay"]')
    ).toBeNull()
  })

  it('mounts the chapter overlay when isTv && isRotating && area changes', () => {
    const { rerender } = render(
      <AreaTransitionFrame {...baseProps} isTv={true} isRotating={true}>
        <div data-testid='inner'>a</div>
      </AreaTransitionFrame>
    )

    // Initial render — no swap yet, so no overlay.
    expect(
      document.querySelector('[data-component="area-chapter-overlay"]')
    ).toBeNull()

    rerender(
      <AreaTransitionFrame
        {...baseProps}
        activeAreaValue='INBOUND'
        areaCode='INBOUND'
        areaName='Inbound'
        isTv={true}
        isRotating={true}
      >
        <div data-testid='inner'>b</div>
      </AreaTransitionFrame>
    )

    expect(
      document.querySelector('[data-component="area-chapter-overlay"]')
    ).not.toBeNull()
    expect(screen.getByText('Inbound')).toBeDefined()
    expect(screen.getByText('Now Showing')).toBeDefined()
    expect(screen.getByText(/12 associates/)).toBeDefined()
  })

  it('marks the wrapper with data-cinematic=true only in cinematic mode', () => {
    const { rerender, container } = render(
      <AreaTransitionFrame {...baseProps} isTv={false} isRotating={false}>
        <div>x</div>
      </AreaTransitionFrame>
    )
    expect(
      container
        .querySelector('[data-component="area-transition-frame"]')
        ?.getAttribute('data-cinematic')
    ).toBe('false')

    rerender(
      <AreaTransitionFrame {...baseProps} isTv={true} isRotating={true}>
        <div>x</div>
      </AreaTransitionFrame>
    )
    expect(
      container
        .querySelector('[data-component="area-transition-frame"]')
        ?.getAttribute('data-cinematic')
    ).toBe('true')
  })
})

// Created and developed by Jai Singh
