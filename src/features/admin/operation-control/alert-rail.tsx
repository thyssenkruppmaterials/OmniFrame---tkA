// Created and developed by Jai Singh
import { cn } from '@/lib/utils'
import type { AlertSignal } from '@/hooks/use-work-engine-live'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface Props {
  alerts: AlertSignal[]
  onAck: (id: string) => void
}

const SEVERITY_BORDER: Record<AlertSignal['severity'], string> = {
  critical: 'border-destructive/40 motion-safe:animate-pulse',
  warning: 'border-amber-500/40',
  info: 'border-border',
}

export function AlertRail({ alerts, onAck }: Props) {
  const actionable = alerts.filter((a) => !a.acked && a.severity !== 'info')
  const informational = alerts.filter((a) => a.acked || a.severity === 'info')

  if (actionable.length === 0 && informational.length === 0) {
    return (
      <div className='text-muted-foreground py-6 text-center text-sm'>
        No active signals.
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      {actionable.map((a) => (
        <Card
          key={a.id}
          className={cn('gap-1 border py-3', SEVERITY_BORDER[a.severity])}
        >
          <CardContent className='space-y-1 px-3 text-xs'>
            <div className='flex items-center gap-2'>
              <span className='font-medium capitalize'>
                {a.glyph.replace('_', ' ')}
              </span>
              <span className='text-muted-foreground ml-auto text-[10px] tabular-nums'>
                {new Date(a.emitted_at).toLocaleTimeString()}
              </span>
            </div>
            <div className='text-muted-foreground'>{a.title}</div>
            <div className='truncate text-[10px]'>{a.context}</div>
            <Button
              variant='ghost'
              size='sm'
              className='h-6 px-2 text-[10px]'
              onClick={() => onAck(a.id)}
            >
              Acknowledge
            </Button>
          </CardContent>
        </Card>
      ))}

      {informational.length > 0 && (
        <details className='text-xs'>
          <summary className='text-muted-foreground hover:text-foreground cursor-pointer transition-colors'>
            {informational.length} informational
          </summary>
          <div className='mt-1 space-y-1'>
            {informational.map((a) => (
              <div
                key={a.id}
                className='text-muted-foreground px-2 py-1 text-[11px]'
              >
                {a.title}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
