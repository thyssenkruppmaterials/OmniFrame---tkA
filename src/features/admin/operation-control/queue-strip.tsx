// Created and developed by Jai Singh
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { operationControlClient } from '@/lib/work-service/operation-control.client'
import type { QueueCellView } from '@/hooks/use-work-engine-live'
import { Card, CardContent } from '@/components/ui/card'

interface Props {
  queues: QueueCellView[]
}

const PRIORITY_TEXT: Record<QueueCellView['priority'], string> = {
  critical: 'text-destructive motion-safe:animate-pulse',
  hot: 'text-amber-600 dark:text-amber-400',
  normal: 'text-sky-600 dark:text-sky-400',
  low: 'text-emerald-600 dark:text-emerald-400',
}

export function QueueStrip({ queues }: Props) {
  if (queues.length === 0) {
    return (
      <div className='text-muted-foreground py-4 text-center text-sm'>
        No active queues.
      </div>
    )
  }

  return (
    <div className='flex gap-2 overflow-x-auto pb-2'>
      {queues.map((q) => (
        <QueueCard key={`${q.task_type}:${q.priority}`} cell={q} />
      ))}
    </div>
  )
}

function QueueCard({ cell }: { cell: QueueCellView }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isOver, setIsOver] = useState(false)

  // Repaint on each sparkline/priority change. `currentColor` lets the
  // canvas inherit the priority text color set on the container.
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const w = c.width
    const h = c.height
    ctx.clearRect(0, 0, w, h)
    if (cell.sparkline.length === 0) return
    const max = Math.max(1, ...cell.sparkline)
    ctx.strokeStyle = getComputedStyle(c).color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    cell.sparkline.forEach((v, i) => {
      const x = (i / Math.max(1, cell.sparkline.length - 1)) * w
      const y = h - (v / max) * h
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }, [cell.sparkline, cell.priority])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsOver(false)
    const userId = e.dataTransfer.getData('application/x-omni-operator')
    if (!userId) return
    const n = e.shiftKey ? 5 : e.metaKey || e.ctrlKey ? 99 : 1
    operationControlClient
      .pushTopN({
        task_type: cell.task_type,
        priority: cell.priority,
        user_id: userId,
        n,
      })
      .catch(() => {
        // error surfaces in alert rail
      })
  }

  return (
    <Card
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-omni-operator')) {
          e.preventDefault()
          setIsOver(true)
        }
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={onDrop}
      className={cn(
        'w-44 shrink-0 gap-1 py-3 transition-shadow',
        isOver && 'ring-primary ring-2'
      )}
    >
      <CardContent
        className={cn('space-y-1 px-3', PRIORITY_TEXT[cell.priority])}
      >
        <div className='text-muted-foreground text-[10px] font-medium tracking-wide uppercase'>
          {cell.task_type} · {cell.priority}
        </div>
        <div className='text-3xl font-semibold tabular-nums'>
          {cell.pending}
        </div>
        <div className='text-muted-foreground text-[10px] tabular-nums'>
          +{cell.claimed} claimed · +{cell.in_progress} in progress
        </div>
        <canvas
          ref={canvasRef}
          width={160}
          height={28}
          className='mt-2 h-7 w-full'
        />
      </CardContent>
    </Card>
  )
}

// Created and developed by Jai Singh
