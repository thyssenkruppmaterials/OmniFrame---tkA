// Created and developed by Jai Singh
import * as React from 'react'

/**
 * Observe the width of a DOM element.
 *
 * Prefer CSS container queries (`@container`) for layout decisions —
 * see `<StatTile>` / `<KpiGrid>` for the canonical pattern. Reach for
 * this hook only when the decision can't be expressed in CSS, e.g.:
 *
 * - Recharts `width` prop (chart cannot read its container in CSS).
 * - Virtualized list column counts (react-virtual etc.).
 * - JS-driven truncation rulers.
 *
 * Returns `null` until the first ResizeObserver entry fires (avoids a
 * one-frame flash with `width=0`).
 *
 * @example
 * const ref = React.useRef<HTMLDivElement>(null)
 * const width = useContainerWidth(ref)
 * return <div ref={ref}>{width != null && <Chart width={width} />}</div>
 */
export function useContainerWidth(
  ref: React.RefObject<HTMLElement | null>
): number | null {
  const [width, setWidth] = React.useState<number | null>(null)

  React.useEffect(() => {
    const node = ref.current
    if (!node) return

    if (typeof ResizeObserver === 'undefined') {
      setWidth(node.getBoundingClientRect().width)
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const nextWidth = entry.contentRect?.width ?? entry.target.clientWidth
      setWidth((prev) => (prev === nextWidth ? prev : nextWidth))
    })

    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])

  return width
}

// Created and developed by Jai Singh
