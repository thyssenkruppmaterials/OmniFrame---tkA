// Created and developed by Jai Singh
'use client'

import { useCallback, useMemo, useRef } from 'react'
import { useWarehouseMapStore } from '@/stores/warehouse-map-store'
import type { MapLayoutResponse } from './types'

const MINI_W = 192
const MINI_H = 144
const PAD = 8

interface MiniMapProps {
  layout: MapLayoutResponse | null
}

export function MiniMap({ layout }: MiniMapProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const viewport = useWarehouseMapStore((s) => s.viewport)
  const setViewport = useWarehouseMapStore((s) => s.setViewport)

  const bounds = useMemo(() => {
    if (!layout) return { minX: 0, minY: 0, maxX: 1000, maxY: 800 }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const zone of layout.zones) {
      for (const pt of zone.polygon) {
        if (pt.x < minX) minX = pt.x
        if (pt.y < minY) minY = pt.y
        if (pt.x > maxX) maxX = pt.x
        if (pt.y > maxY) maxY = pt.y
      }
    }

    for (const rack of layout.racks) {
      const rx = rack.position_x
      const ry = rack.position_y
      if (rx < minX) minX = rx
      if (ry < minY) minY = ry
      if (rx + rack.width > maxX) maxX = rx + rack.width
      if (ry + rack.height > maxY) maxY = ry + rack.height
    }

    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1000, maxY: 800 }
    const px = (maxX - minX) * 0.05 || 20
    const py = (maxY - minY) * 0.05 || 20
    return {
      minX: minX - px,
      minY: minY - py,
      maxX: maxX + px,
      maxY: maxY + py,
    }
  }, [layout])

  const worldW = bounds.maxX - bounds.minX || 1
  const worldH = bounds.maxY - bounds.minY || 1
  const drawW = MINI_W - PAD * 2
  const drawH = MINI_H - PAD * 2
  const scaleF = Math.min(drawW / worldW, drawH / worldH)

  const toMini = useCallback(
    (wx: number, wy: number) => ({
      x: PAD + (wx - bounds.minX) * scaleF,
      y: PAD + (wy - bounds.minY) * scaleF,
    }),
    [bounds, scaleF]
  )

  const viewRect = useMemo(() => {
    const vw = window.innerWidth / viewport.scale
    const vh = window.innerHeight / viewport.scale
    const tl = toMini(viewport.x - vw / 2, viewport.y - vh / 2)
    const w = vw * scaleF
    const h = vh * scaleF
    return {
      x: Math.max(0, tl.x),
      y: Math.max(0, tl.y),
      w: Math.min(MINI_W, w),
      h: Math.min(MINI_H, h),
    }
  }, [viewport, scaleF, toMini])

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const worldX = bounds.minX + (mx - PAD) / scaleF
      const worldY = bounds.minY + (my - PAD) / scaleF
      setViewport({ x: worldX, y: worldY, scale: viewport.scale })
    },
    [bounds, scaleF, setViewport, viewport.scale]
  )

  if (!layout) return null

  return (
    <div className='bg-background/90 absolute right-4 bottom-4 z-10 rounded-lg border shadow-lg backdrop-blur-sm'>
      <svg
        ref={svgRef}
        width={MINI_W}
        height={MINI_H}
        className='cursor-pointer'
        role='img'
        aria-label='Miniature warehouse map overview'
        onClick={handleClick}
      >
        <rect
          x={PAD}
          y={PAD}
          width={worldW * scaleF}
          height={worldH * scaleF}
          className='fill-muted/40 stroke-border'
          strokeWidth={1}
          rx={2}
        />

        {layout.zones.map((zone) => {
          const pts = zone.polygon
          if (pts.length < 2) return null
          const xs = pts.map((p) => toMini(p.x, p.y).x)
          const ys = pts.map((p) => toMini(p.x, p.y).y)
          const zx = Math.min(...xs)
          const zy = Math.min(...ys)
          const zw = Math.max(...xs) - zx
          const zh = Math.max(...ys) - zy
          return (
            <rect
              key={zone.id}
              x={zx}
              y={zy}
              width={zw}
              height={zh}
              fill={zone.color}
              opacity={0.35}
              rx={1}
            />
          )
        })}

        {layout.racks.map((rack) => {
          const { x, y } = toMini(rack.position_x, rack.position_y)
          return (
            <rect
              key={rack.id}
              x={x}
              y={y}
              width={Math.max(2, rack.width * scaleF)}
              height={Math.max(2, rack.height * scaleF)}
              className='fill-foreground/50'
              rx={0.5}
            />
          )
        })}

        <rect
          x={viewRect.x}
          y={viewRect.y}
          width={viewRect.w}
          height={viewRect.h}
          fill='rgba(59,130,246,0.18)'
          stroke='rgb(59,130,246)'
          strokeWidth={1.5}
          rx={1}
        />
      </svg>
    </div>
  )
}

// Created and developed by Jai Singh
