// Created and developed by Jai Singh
/**
 * FLIP Animation Hook for Labor Board
 * Tracks card positions across React renders and animates movement with anime.js springs
 * Implements First-Last-Invert-Play pattern for extremely fluid card transitions
 * Created: February 8, 2026
 */
import { useRef, useLayoutEffect, useCallback } from 'react'
import { animate, createSpring } from 'animejs'

interface FlipRect {
  left: number
  top: number
  width: number
  height: number
}

interface UseAnimeFlipOptions {
  /** CSS selector or data attribute for cards to track */
  cardSelector?: string
  /** Spring configuration for FLIP movement */
  spring?: { mass: number; stiffness: number; damping: number }
  /** Whether FLIP is enabled */
  enabled?: boolean
}

const DEFAULT_SPRING = { mass: 0.6, stiffness: 200, damping: 18 }

export function useAnimeFlip(options: UseAnimeFlipOptions = {}) {
  const {
    cardSelector = '[data-card-id]',
    spring = DEFAULT_SPRING,
    enabled = true,
  } = options

  const containerRef = useRef<HTMLDivElement>(null)
  const prevRectsRef = useRef<Map<string, FlipRect>>(new Map())
  const isFirstRender = useRef(true)
  const animationCleanup = useRef<(() => void)[]>([])

  // Capture current positions of all cards (call BEFORE render triggers)
  const capturePositions = useCallback(() => {
    if (!containerRef.current || !enabled) return

    const cards = containerRef.current.querySelectorAll(cardSelector)
    const rects = new Map<string, FlipRect>()

    cards.forEach((card) => {
      const id = card.getAttribute('data-card-id')
      if (id) {
        const rect = card.getBoundingClientRect()
        rects.set(id, {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        })
      }
    })

    prevRectsRef.current = rects
  }, [cardSelector, enabled])

  // Animate cards from old positions to new positions (call AFTER render)
  useLayoutEffect(() => {
    if (!containerRef.current || !enabled) return

    const container = containerRef.current
    const cards = container.querySelectorAll(cardSelector)
    const prevRects = prevRectsRef.current

    // Clean up any running animations
    animationCleanup.current.forEach((cleanup) => cleanup())
    animationCleanup.current = []

    if (isFirstRender.current) {
      // First render: just record positions, no entrance animation
      // (entrance is handled by useColumnEntrance at the board level)
      isFirstRender.current = false

      // Record initial positions for future FLIP comparisons
      const initialRects = new Map<string, FlipRect>()
      cards.forEach((card) => {
        const id = card.getAttribute('data-card-id')
        if (id) {
          const rect = card.getBoundingClientRect()
          initialRects.set(id, {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          })
        }
      })
      prevRectsRef.current = initialRects
      return
    }

    // Subsequent renders: FLIP animation
    let entranceIndex = 0

    cards.forEach((card) => {
      const id = card.getAttribute('data-card-id')
      if (!id) return

      const newRect = card.getBoundingClientRect()
      const prevRect = prevRects.get(id)

      if (prevRect) {
        // Card existed before -- FLIP it
        const dx = prevRect.left - newRect.left
        const dy = prevRect.top - newRect.top

        // Only animate if the card actually moved
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          const el = card as HTMLElement

          try {
            // Animate from old position to new position (FLIP Play)
            const anim = animate(el, {
              translateX: [dx, 0],
              translateY: [dy, 0],
              ease: createSpring(spring),
            })

            animationCleanup.current.push(() => {
              if (anim && typeof anim.pause === 'function') anim.pause()
            })
          } catch {
            // If animation fails, reset transform so card is at correct position
            el.style.transform = ''
          }
        }
      } else {
        // New card -- subtle entrance animation (safe: starts from near-visible)
        const el = card as HTMLElement
        try {
          const anim = animate(el, {
            opacity: [0.7, 1],
            translateY: [6, 0],
            ease: 'outExpo',
            duration: 300,
            delay: entranceIndex * 20,
          })

          entranceIndex++
          animationCleanup.current.push(() => {
            if (anim && typeof anim.pause === 'function') anim.pause()
          })
        } catch {
          // If animation fails, ensure card is visible
          el.style.opacity = '1'
          el.style.transform = ''
        }
      }
    })

    // Update stored rects for next render
    const newRects = new Map<string, FlipRect>()
    cards.forEach((card) => {
      const id = card.getAttribute('data-card-id')
      if (id) {
        const rect = card.getBoundingClientRect()
        newRects.set(id, {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        })
      }
    })
    prevRectsRef.current = newRects

    // Cleanup on unmount to prevent memory leaks
    return () => {
      animationCleanup.current.forEach((cleanup) => cleanup())
      animationCleanup.current = []
    }
  })

  return {
    containerRef,
    capturePositions,
  }
}

// Created and developed by Jai Singh
