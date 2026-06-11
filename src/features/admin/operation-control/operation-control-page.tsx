// Created and developed by Jai Singh
/**
 * Operation Control — top-level command center.
 *
 * Same OmniFrame design system as the rest of Inventory Management
 * (shadcn Card chrome, theme tokens, standard buttons). Density and
 * selective motion accents preserve the spirit of plan §0b.1, but the
 * surface inherits the user's theme like every other tab.
 */
import { useEffect, useState } from 'react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { useWorkEngineLive } from '@/hooks/use-work-engine-live'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertRail } from './alert-rail'
import { KeyboardShortcuts } from './keyboard-shortcuts'
import { OperatorDeck } from './operator-deck'
import { QueueStrip } from './queue-strip'
import { ZoneMap } from './zone-map'

export default function OperationControlPage() {
  const { authState } = useUnifiedAuth()
  const profile = authState.profile
  const live = useWorkEngineLive()
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [now, setNow] = useState(() => new Date())

  // Refresh the header clock once a second so the operator can confirm the
  // surface is live without watching the queue counts.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // `?` toggles shortcut overlay; Space pauses/resumes the live feed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setShowShortcuts((v) => !v)
      }
      if (e.key === ' ' && (e.target as HTMLElement)?.tagName !== 'INPUT') {
        e.preventDefault()
        if (live.isPaused) {
          live.resume()
        } else {
          live.pause()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [live])

  const orgLabel = profile?.organization_id?.slice(0, 6) ?? '—'

  return (
    <div className='space-y-4'>
      <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-baseline gap-3'>
          <h2 className='text-lg font-semibold tracking-tight'>
            Operation Control
          </h2>
          <span className='text-muted-foreground text-sm tabular-nums'>
            org {orgLabel} · {now.toLocaleTimeString()}
          </span>
        </div>
        <div className='flex items-center gap-2'>
          {live.isStale && (
            <Badge
              variant='outline'
              className='border-amber-500/40 text-amber-600 motion-safe:animate-pulse dark:text-amber-400'
            >
              Reconnecting…
              <button
                type='button'
                onClick={live.reconnect}
                className='ml-2 underline underline-offset-2'
              >
                Retry
              </button>
            </Badge>
          )}
          <Button
            variant='outline'
            size='sm'
            onClick={() => (live.isPaused ? live.resume() : live.pause())}
          >
            {live.isPaused ? 'Resume feed (Space)' : 'Pause feed (Space)'}
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setShowShortcuts((v) => !v)}
          >
            ? Shortcuts
          </Button>
        </div>
      </div>

      <div className='grid grid-cols-12 gap-4'>
        <Card className='col-span-12 gap-3 py-4 lg:col-span-7'>
          <CardHeader className='px-4'>
            <CardTitle className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase'>
              Zone Map
              <Badge variant='secondary' className='tabular-nums'>
                {live.zones.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className='px-4'>
            <ZoneMap zones={live.zones} operators={live.operators} />
          </CardContent>
        </Card>

        <Card className='col-span-12 gap-3 py-4 md:col-span-6 lg:col-span-3'>
          <CardHeader className='px-4'>
            <CardTitle className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase'>
              Operators
              <Badge variant='secondary' className='tabular-nums'>
                {live.operators.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className='px-4'>
            <OperatorDeck operators={live.operators} />
          </CardContent>
        </Card>

        <Card className='col-span-12 gap-3 py-4 md:col-span-6 lg:col-span-2'>
          <CardHeader className='px-4'>
            <CardTitle className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase'>
              Alerts
              <Badge variant='secondary' className='tabular-nums'>
                {live.alerts.filter((a) => !a.acked).length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className='px-4'>
            <AlertRail alerts={live.alerts} onAck={live.acknowledgeAlert} />
          </CardContent>
        </Card>

        <Card className='col-span-12 gap-3 py-4'>
          <CardHeader className='px-4'>
            <CardTitle className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase'>
              Queues
              <Badge variant='secondary' className='tabular-nums'>
                {live.queues.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className='px-4'>
            <QueueStrip queues={live.queues} />
          </CardContent>
        </Card>
      </div>

      <KeyboardShortcuts open={showShortcuts} onOpenChange={setShowShortcuts} />
    </div>
  )
}

// Created and developed by Jai Singh
