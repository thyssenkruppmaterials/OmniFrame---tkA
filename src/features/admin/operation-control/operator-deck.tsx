// Created and developed by Jai Singh
import { cn } from '@/lib/utils'
import type { OperatorStateView } from '@/hooks/use-work-engine-live'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

interface Props {
  operators: OperatorStateView[]
}

type Status = OperatorStateView['status']

const STATUS_VARIANT: Record<
  Status,
  { variant: 'default' | 'secondary' | 'outline'; className?: string }
> = {
  online: {
    variant: 'outline',
    className:
      'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10',
  },
  idle: {
    variant: 'outline',
    className: 'border-sky-500/40 text-sky-700 dark:text-sky-400 bg-sky-500/10',
  },
  break: {
    variant: 'outline',
    className:
      'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10',
  },
  offline: { variant: 'secondary' },
}

function initialsOf(name: string | null, fallback: string): string {
  const source = name?.trim() || fallback
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

export function OperatorDeck({ operators }: Props) {
  if (operators.length === 0) {
    return (
      <div className='text-muted-foreground py-6 text-center text-sm'>
        No operators online.
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      {operators.map((op) => {
        const pct = Math.min(
          100,
          (op.in_progress / Math.max(1, op.capacity)) * 100
        )
        const statusStyle = STATUS_VARIANT[op.status]
        const displayName = op.full_name ?? op.user_id.slice(0, 8)
        return (
          <Card
            key={op.user_id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-omni-operator', op.user_id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            className={cn(
              'cursor-grab gap-2 py-3 active:cursor-grabbing',
              op.pinned_zone && 'border-dashed'
            )}
          >
            <CardContent className='space-y-2 px-3'>
              <div className='flex items-center gap-2'>
                <Avatar className='size-7'>
                  <AvatarFallback className='text-[10px] font-semibold'>
                    {initialsOf(op.full_name, op.user_id)}
                  </AvatarFallback>
                </Avatar>
                <span className='flex-1 truncate text-sm font-medium'>
                  {displayName}
                </span>
                <Badge
                  variant={statusStyle.variant}
                  className={cn('text-[10px] uppercase', statusStyle.className)}
                >
                  {op.status}
                </Badge>
              </div>

              <div className='text-muted-foreground flex items-center justify-between text-xs tabular-nums'>
                <span>Zone: {op.current_zone ?? '—'}</span>
                <span>
                  {op.in_progress} / {op.capacity}
                </span>
              </div>

              <div className='bg-muted h-1 overflow-hidden rounded-full'>
                <div
                  className='bg-primary h-full transition-[width]'
                  style={{ width: `${pct}%` }}
                />
              </div>

              {op.capabilities.length > 0 && (
                <div className='flex flex-wrap gap-1'>
                  {op.capabilities.map((c) => (
                    <Badge
                      key={c}
                      variant='outline'
                      className='px-1.5 py-0 text-[10px]'
                    >
                      {c}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// Created and developed by Jai Singh
