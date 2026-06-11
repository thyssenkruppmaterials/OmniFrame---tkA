// Created and developed by Jai Singh
/**
 * Anime.js Effect Hooks for Labor Board
 * Provides reusable animation effects: pulse, entrance stagger, number animation
 * Created: February 8, 2026
 */
import { useRef, useEffect } from 'react'
import { animate, createSpring, stagger, utils } from 'animejs'

// ===== Pulse Effect (for drop zone highlighting) =====

interface UsePulseOptions {
  /** Whether the pulse is active */
  active: boolean
  /** Color to pulse to */
  color?: string
  /** Duration of pulse in ms */
  duration?: number
}

export function useAnimePulse({
  active,
  color = 'var(--primary)',
  duration = 300,
}: UsePulseOptions) {
  const ref = useRef<HTMLDivElement>(null)
  const animRef = useRef<ReturnType<typeof animate> | null>(null)

  useEffect(() => {
    if (!ref.current) return

    if (active) {
      animRef.current = animate(ref.current, {
        boxShadow: [
          '0 0 0 0px rgba(var(--primary-rgb, 59, 130, 246), 0)',
          '0 0 0 4px rgba(var(--primary-rgb, 59, 130, 246), 0.15)',
        ],
        ease: 'outSine',
        duration,
      })
    } else {
      animRef.current = animate(ref.current, {
        boxShadow: '0 0 0 0px rgba(var(--primary-rgb, 59, 130, 246), 0)',
        ease: 'inSine',
        duration: duration * 0.7,
      })
    }

    return () => {
      if (animRef.current && typeof animRef.current.pause === 'function') {
        animRef.current.pause()
      }
    }
  }, [active, color, duration])

  return ref
}

// ===== Staggered Entrance Effect =====

interface UseEntranceOptions {
  /** Whether to trigger the entrance */
  trigger: boolean
  /** CSS selector for children to stagger */
  childSelector?: string
  /** Stagger delay between children (ms) */
  staggerDelay?: number
}

export function useAnimeEntrance({
  trigger,
  childSelector = '> *',
  staggerDelay = 40,
}: UseEntranceOptions) {
  const ref = useRef<HTMLDivElement>(null)
  const hasPlayed = useRef(false)

  useEffect(() => {
    if (!ref.current || !trigger || hasPlayed.current) return

    const children = ref.current.querySelectorAll(childSelector)
    if (children.length === 0) return

    hasPlayed.current = true

    utils.set(children, { opacity: 0, translateY: 16 })

    animate(children, {
      opacity: [0, 1],
      translateY: [16, 0],
      ease: createSpring({ mass: 0.5, stiffness: 280, damping: 18 }),
      delay: stagger(staggerDelay, { from: 'first' }),
    })
  }, [trigger, childSelector, staggerDelay])

  // Reset when trigger goes false
  useEffect(() => {
    if (!trigger) {
      hasPlayed.current = false
    }
  }, [trigger])

  return ref
}

// ===== Column Stagger Entrance (for board load) =====

export function useColumnEntrance(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const hasPlayed = useRef(false)

  useEffect(() => {
    if (!ref.current || !enabled || hasPlayed.current) return

    const columns = ref.current.querySelectorAll('[data-column]')
    if (columns.length === 0) return

    hasPlayed.current = true

    utils.set(columns, { opacity: 0, translateY: 30 })

    animate(columns, {
      opacity: [0, 1],
      translateY: [30, 0],
      ease: createSpring({ mass: 0.7, stiffness: 180, damping: 16 }),
      delay: stagger(60, { from: 'first' }),
    })
  }, [enabled])

  return ref
}

// ===== Drag Overlay Spring Effect =====

export function useDragOverlaySpring(isActive: boolean) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return

    if (isActive) {
      animate(ref.current, {
        scale: [1, 1.06],
        rotate: [0, 0.8],
        boxShadow: [
          '0 1px 3px rgba(0,0,0,0.1)',
          '0 20px 40px rgba(0,0,0,0.15), 0 8px 16px rgba(0,0,0,0.1)',
        ],
        ease: createSpring({ mass: 0.8, stiffness: 260, damping: 16 }),
      })
    }
  }, [isActive])

  return ref
}

// ===== Banner Slide-in Effect =====

export function useBannerEntrance(show: boolean) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || !show) return

    utils.set(ref.current, { opacity: 0, translateY: -10 })

    animate(ref.current, {
      opacity: [0, 1],
      translateY: [-10, 0],
      ease: createSpring({ mass: 0.5, stiffness: 300, damping: 22 }),
    })
  }, [show])

  return ref
}

// Created and developed by Jai Singh
