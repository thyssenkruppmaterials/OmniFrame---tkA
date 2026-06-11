// Created and developed by Jai Singh
/**
 * OmniBelt — Position hook (P6)
 *
 * Bridges the pure anchor math in `lib/anchors.ts` to the React
 * lifecycle. The hook is the single place where:
 *
 *   - the current route class is read from TanStack Router and used to
 *     key into `store.positionByRoute`;
 *   - the viewport size is tracked via `ResizeObserver` (no polling);
 *   - drag is wired up against framer-motion's `useDragControls` with
 *     PINNED disabling drag entirely;
 *   - `onDragEnd` runs `snapToNearestAnchor` and writes the result back
 *     to the store per-route, keyed by route class.
 *
 * The returned shape is intentionally narrow so collision-avoidance
 * (the next hook in the chain) and the skin renderers consume only
 * what they need:
 *
 *   const pos = useOmnibeltPosition({ widgetW: 220, widgetH: 44 })
 *   <motion.div
 *     style={{
 *       position: 'fixed',
 *       transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`
 *     }}
 *     drag={pos.isDraggable}
 *     dragControls={pos.dragControls}
 *     dragMomentum={false}
 *     onDragEnd={(_, info) =>
 *       pos.onDragEnd({ x: info.point.x, y: info.point.y })
 *     }
 *   />
 *
 * Performance: callers pass `widgetW` / `widgetH` so we never need to
 * read the DOM inside this hook; the resolution math runs at <1 ms.
 * The store write on drag-end debounces via Zustand's natural
 * batching (one set per release) — no `setInterval`, no scroll listener.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@tanstack/react-router'
import {
  useDragControls,
  useReducedMotion,
  type DragControls,
} from 'framer-motion'
import {
  resolveAnchorPosition,
  snapToNearestAnchor,
  type AnchorName,
  type Offset,
} from '../lib/anchors'
import { routeClass, type RouteClass } from '../lib/routeClass'
import { useOmnibeltStore, type AnchorPosition } from '../store/omnibeltStore'

export type UseOmnibeltPositionArgs = {
  /** Resting widget width in px. Defaults to the Pill body (220 px). */
  widgetW?: number
  /** Resting widget height in px. Defaults to the Pill body (44 px). */
  widgetH?: number
  /**
   * Force a specific anchor regardless of what's persisted — used by
   * the Edge Nub which should always sit flush against the right edge
   * when active.
   */
  forceAnchor?: AnchorName
}

export type UseOmnibeltPositionResult = {
  /** Top-left of the widget rect in viewport coordinates (px). */
  x: number
  y: number
  /** Resolved anchor name (FREE / PINNED / TL.. / NUB_*). */
  anchor: AnchorName
  /** True unless the current position is PINNED. */
  isDraggable: boolean
  /** Framer-motion drag controls — pass to `<motion.div dragControls>`. */
  dragControls: DragControls
  /** True while the user is actively dragging (mirrors store.dragging). */
  isDragging: boolean
  /**
   * Honor `prefers-reduced-motion` — when true, callers should skip
   * the spring snap-back animation and apply the new position instantly.
   */
  reducedMotion: boolean
  /**
   * Resolved widget rect in viewport coordinates. Forwarded to the
   * collision-avoidance hook so it doesn't have to recompute geometry.
   */
  rect: { x: number; y: number; w: number; h: number }
  /** Currently active route class (key into `positionByRoute`). */
  routeClass: RouteClass
  /** Pure setter that snaps a drop point to the nearest anchor and
   *  writes the result to the per-route store entry. */
  onDragEnd: (point: { x: number; y: number }) => void
  /** Programmatic anchor setter — used by the right-click context menu. */
  setAnchor: (anchor: AnchorName, offset?: Offset) => void
  /** Toggle PINNED on the current route class. */
  setPinned: (pinned: boolean) => void
  /** Resolved AnchorPosition currently stored for this route. */
  storedPosition: AnchorPosition
  /** Lifecycle helpers for the skin renderer to flag drag start. */
  onDragStart: () => void
}

/** Public defaults the skin renderers fall back to. */
export const DEFAULT_WIDGET_SIZE = { widgetW: 220, widgetH: 44 } as const

const DEFAULT_POSITION: AnchorPosition = {
  anchor: 'BR',
  offset: { x: 0, y: 0 },
}

function getViewportSize(): { viewportW: number; viewportH: number } {
  if (typeof window === 'undefined') {
    return { viewportW: 1024, viewportH: 768 }
  }
  return {
    viewportW: window.innerWidth || 1024,
    viewportH: window.innerHeight || 768,
  }
}

export function useOmnibeltPosition(
  args: UseOmnibeltPositionArgs = {}
): UseOmnibeltPositionResult {
  const widgetW = args.widgetW ?? DEFAULT_WIDGET_SIZE.widgetW
  const widgetH = args.widgetH ?? DEFAULT_WIDGET_SIZE.widgetH

  const pathname = useLocation({ select: (loc) => loc.pathname })
  const currentRoute = useMemo<RouteClass>(
    () => routeClass(pathname),
    [pathname]
  )

  const stored =
    useOmnibeltStore((s) => s.positionByRoute[currentRoute]) ?? DEFAULT_POSITION
  const setPositionForRoute = useOmnibeltStore((s) => s.setPositionForRoute)
  const setPinnedAction = useOmnibeltStore((s) => s.setPinned)
  const setDragging = useOmnibeltStore((s) => s.setDragging)
  const isDragging = useOmnibeltStore((s) => s.dragging)

  const reducedMotion = useReducedMotion() ?? false
  const dragControls = useDragControls()

  const [viewport, setViewport] = useState(getViewportSize)
  // ResizeObserver on `document.documentElement` keeps the resolved
  // position correct without a `window.resize` polling listener.
  const observerRef = useRef<ResizeObserver | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    // Window resize fires more reliably than RO on the root for window-
    // scoped changes (e.g. mobile rotation). Pair with RO so embedded
    // hosts (Capacitor preview) also get updates.
    const onResize = () => setViewport(getViewportSize())
    window.addEventListener('resize', onResize)
    if (typeof ResizeObserver !== 'undefined' && document?.documentElement) {
      const ro = new ResizeObserver(() => setViewport(getViewportSize()))
      ro.observe(document.documentElement)
      observerRef.current = ro
    }
    return () => {
      window.removeEventListener('resize', onResize)
      observerRef.current?.disconnect()
      observerRef.current = null
    }
  }, [])

  const resolvedAnchor: AnchorName = args.forceAnchor ?? stored.anchor

  const { x, y } = useMemo(
    () =>
      resolveAnchorPosition({
        anchor: resolvedAnchor,
        offset: stored.offset,
        viewportW: viewport.viewportW,
        viewportH: viewport.viewportH,
        widgetW,
        widgetH,
      }),
    [resolvedAnchor, stored.offset, viewport, widgetW, widgetH]
  )

  const onDragEnd = useCallback(
    (point: { x: number; y: number }) => {
      setDragging(false)
      const snapped = snapToNearestAnchor({
        dropX: point.x,
        dropY: point.y,
        viewportW: viewport.viewportW,
        viewportH: viewport.viewportH,
        widgetW,
        widgetH,
      })
      setPositionForRoute(currentRoute, {
        anchor: snapped.anchor,
        offset: snapped.offset,
      })
    },
    [currentRoute, setPositionForRoute, setDragging, viewport, widgetW, widgetH]
  )

  const onDragStart = useCallback(() => setDragging(true), [setDragging])

  const setAnchor = useCallback(
    (anchor: AnchorName, offset: Offset = { x: 0, y: 0 }) => {
      setPositionForRoute(currentRoute, { anchor, offset })
    },
    [currentRoute, setPositionForRoute]
  )

  const setPinned = useCallback(
    (pinned: boolean) => setPinnedAction(currentRoute, pinned),
    [currentRoute, setPinnedAction]
  )

  return {
    x,
    y,
    anchor: resolvedAnchor,
    isDraggable: resolvedAnchor !== 'PINNED',
    dragControls,
    isDragging,
    reducedMotion,
    rect: { x, y, w: widgetW, h: widgetH },
    routeClass: currentRoute,
    onDragEnd,
    onDragStart,
    setAnchor,
    setPinned,
    storedPosition: stored,
  }
}

// Created and developed by Jai Singh
