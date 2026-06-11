// Created and developed by Jai Singh
/**
 * OmniBelt — Collision avoidance hook (P6)
 *
 * Connects the pure math in `lib/collision.ts` to live DOM rects.
 * Spec §8.4 calls out two competing chrome registries:
 *
 *   1. The NotificationsPanel bell (`data-testid='notifications-bell'`,
 *      added in this phase to the auth-layout action bar).
 *   2. The Sonner toaster (`[data-sonner-toaster]`, native attribute).
 *
 * Future floating chrome can register additional selectors via the
 * `extraSelectors` argument without touching this hook.
 *
 * Lifecycle:
 *   - Recomputes on every `widget` change (drag-end / anchor change /
 *     viewport resize via `useOmnibeltPosition`).
 *   - Listens to `window.resize` so a chrome bar that moves on resize
 *     re-triggers the probe.
 *   - Cleans up listeners on unmount.
 *
 * Returns the *adjusted* rect (same as input when no overlap) plus a
 * short `reason` string consumers can surface in dev tooling.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { avoidCollisions, type Rect } from '../lib/collision'

/** Default selectors for the two known competing chrome surfaces. */
export const DEFAULT_COMPETING_SELECTORS: readonly string[] = [
  '[data-testid="notifications-bell"]',
  '[data-sonner-toaster]',
] as const

export type UseOmnibeltCollisionAvoidanceArgs = {
  widget: Rect
  /** Additional CSS selectors for floating chrome to avoid. */
  extraSelectors?: readonly string[]
  /** Pixel threshold below which an overlap is ignored. Default 4. */
  overlapThresholdPx?: number
  /** Pixel offset applied when avoiding a collision. Default 56. */
  offsetStepPx?: number
}

export type UseOmnibeltCollisionAvoidanceResult = {
  adjustedRect: Rect
  reason: string
  /** Raw competing rects last probed from the DOM (debug surface). */
  competing: Rect[]
}

function readCompetingRects(selectors: readonly string[]): Rect[] {
  if (typeof document === 'undefined') return []
  const out: Rect[] = []
  for (const sel of selectors) {
    let nodes: NodeListOf<Element>
    try {
      nodes = document.querySelectorAll(sel)
    } catch {
      // Bad selector → skip rather than crash.
      continue
    }
    nodes.forEach((node) => {
      const el = node as HTMLElement
      const r = el.getBoundingClientRect()
      // Skip zero-size elements (collapsed popovers, lazy-mounted DOM
      // nodes) so they don't pull the launcher away unnecessarily.
      if (r.width <= 0 || r.height <= 0) return
      out.push({ x: r.left, y: r.top, w: r.width, h: r.height })
    })
  }
  return out
}

export function useOmnibeltCollisionAvoidance(
  args: UseOmnibeltCollisionAvoidanceArgs
): UseOmnibeltCollisionAvoidanceResult {
  const { widget, extraSelectors, overlapThresholdPx, offsetStepPx } = args

  const selectors = useMemo(
    () => [...DEFAULT_COMPETING_SELECTORS, ...(extraSelectors ?? [])],
    [extraSelectors]
  )

  // `competing` is recomputed when `widget` changes (caller depends on
  // hook output) or on window resize. We hold it in state so the
  // returned object is stable between resize ticks.
  const [competing, setCompeting] = useState<Rect[]>(() =>
    readCompetingRects(selectors)
  )

  // Re-probe on resize and whenever the widget rect or selector list
  // changes. The `widget` dependency is what triggers a re-probe after
  // a drag-end (the rect changes → effect runs → DOM probe + collision
  // recomputed → consumer renders the avoided position).
  const widgetSig = `${widget.x},${widget.y},${widget.w},${widget.h}`
  const selectorsSig = selectors.join('|')
  const widgetSigRef = useRef(widgetSig)
  widgetSigRef.current = widgetSig
  useEffect(() => {
    setCompeting(readCompetingRects(selectors))
    if (typeof window === 'undefined') return
    const onResize = () => {
      setCompeting(readCompetingRects(selectors))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectorsSig, widgetSig])

  const { adjustedRect, reason } = useMemo(
    () =>
      avoidCollisions({
        widget,
        competing,
        overlapThresholdPx,
        offsetStepPx,
      }),
    [widget, competing, overlapThresholdPx, offsetStepPx]
  )

  return { adjustedRect, reason, competing }
}

// Created and developed by Jai Singh
