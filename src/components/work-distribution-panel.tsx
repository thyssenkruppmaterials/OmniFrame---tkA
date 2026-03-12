/**
 * Work Distribution Panel
 * Panel for supervisors to push work to specific operators
 * Part of Phase 6: Work Management System Redesign
 */
import { useState } from 'react'
import { Loader2, Send, User, Users } from 'lucide-react'
import type { CycleCountData } from '@/lib/supabase/cycle-count.service'
import { cn } from '@/lib/utils'
import type { PushMode } from '@/lib/work-service/types'
import { useActiveWorkers } from '@/hooks/use-active-workers'
import { useWorkQueue } from '@/hooks/use-work-queue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

interface WorkDistributionPanelProps {
  selectedCounts: CycleCountData[]
  onPushComplete: () => void
}

export function WorkDistributionPanel({
  selectedCounts,
  onPushComplete,
}: WorkDistributionPanelProps) {
  const { workers, onlineCount } = useActiveWorkers()
  const { pushToUser, isPushPending } = useWorkQueue()
  const [pushMode, setPushMode] = useState<PushMode>('push')
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null)
  const [isPushing, setIsPushing] = useState(false)

  const handlePush = async () => {
    if (!selectedWorker || selectedCounts.length === 0) return

    setIsPushing(true)
    try {
      for (const count of selectedCounts) {
        pushToUser({ taskId: count.id, userId: selectedWorker })
      }
      onPushComplete()
    } finally {
      setIsPushing(false)
    }
  }

  // Filter to only online/idle/busy workers (not offline or on break)
  const onlineWorkers = workers.filter(
    (w) => w.status === 'online' || w.status === 'idle' || w.status === 'busy'
  )

  const isDisabled =
    !selectedWorker ||
    selectedCounts.length === 0 ||
    isPushPending ||
    isPushing ||
    pushMode === 'pull'

  return (
    <Card className='border-primary/20 bg-primary/5'>
      <CardHeader className='pb-3'>
        <CardTitle className='flex items-center gap-2 text-lg'>
          <Send className='text-primary h-5 w-5' />
          Push Work to Operators
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
          {/* Left: Selected counts summary */}
          <div className='space-y-4'>
            <div>
              <Badge variant='secondary' className='px-3 py-1 text-base'>
                {selectedCounts.length} count
                {selectedCounts.length !== 1 ? 's' : ''} selected
              </Badge>
            </div>

            <RadioGroup
              value={pushMode}
              onValueChange={(v) => setPushMode(v as PushMode)}
              className='space-y-2'
            >
              <div className='flex items-center space-x-2'>
                <RadioGroupItem value='pull' id='pull' />
                <Label htmlFor='pull' className='cursor-pointer'>
                  IN (operators pull from queue)
                </Label>
              </div>
              <div className='flex items-center space-x-2'>
                <RadioGroupItem value='push' id='push' />
                <Label htmlFor='push' className='cursor-pointer'>
                  OUT (push to specific operator)
                </Label>
              </div>
            </RadioGroup>

            {/* Show selected counts preview (max 5) */}
            {selectedCounts.length > 0 && selectedCounts.length <= 5 && (
              <div className='text-muted-foreground mt-4 space-y-1.5 text-sm'>
                <Label className='text-muted-foreground text-xs'>
                  Selected Items:
                </Label>
                {selectedCounts.map((c) => (
                  <div key={c.id} className='flex items-center gap-2'>
                    <Badge
                      variant={
                        (c as Record<string, unknown>).priority === 'critical'
                          ? 'destructive'
                          : 'outline'
                      }
                      className='text-xs'
                    >
                      {((c as Record<string, unknown>).priority as string) ||
                        'normal'}
                    </Badge>
                    <span className='font-mono text-xs'>{c.count_number}</span>
                    <span className='max-w-[100px] truncate text-xs'>
                      {c.location}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {selectedCounts.length > 5 && (
              <p className='text-muted-foreground text-sm'>
                + {selectedCounts.length - 5} more count(s) selected
              </p>
            )}
          </div>

          {/* Right: Worker selection */}
          <div className='space-y-4'>
            <Label className='flex items-center gap-2 text-sm font-medium'>
              <Users className='h-4 w-4' />
              Available Operators ({onlineCount} online)
            </Label>

            <div className='bg-background max-h-48 space-y-2 overflow-auto rounded-md border p-2'>
              {onlineWorkers.length === 0 ? (
                <p className='text-muted-foreground py-4 text-center text-sm'>
                  No operators currently online
                </p>
              ) : (
                onlineWorkers.map((worker) => (
                  <div
                    key={worker.user_id}
                    className={cn(
                      'flex cursor-pointer items-center justify-between rounded-md p-2 transition-colors',
                      selectedWorker === worker.user_id
                        ? 'bg-primary/10 border-primary border'
                        : 'hover:bg-accent border border-transparent'
                    )}
                    onClick={() => setSelectedWorker(worker.user_id)}
                    role='button'
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setSelectedWorker(worker.user_id)
                      }
                    }}
                  >
                    <div className='flex items-center gap-2'>
                      <div
                        className={cn(
                          'h-2 w-2 rounded-full',
                          worker.status === 'busy'
                            ? 'bg-orange-500'
                            : 'bg-green-500'
                        )}
                      />
                      <User className='text-muted-foreground h-4 w-4' />
                      <span className='text-sm font-medium'>
                        {worker.full_name || 'Unknown'}
                      </span>
                    </div>
                    <div className='text-muted-foreground text-xs'>
                      {worker.status === 'busy' && worker.current_location
                        ? `@ ${worker.current_location}`
                        : worker.status === 'busy'
                          ? 'Busy'
                          : 'Available'}
                    </div>
                  </div>
                ))
              )}
            </div>

            <Button
              onClick={handlePush}
              disabled={isDisabled}
              className='w-full'
              size='lg'
            >
              {isPushPending || isPushing ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Pushing...
                </>
              ) : (
                <>
                  <Send className='mr-2 h-4 w-4' />
                  Push {selectedCounts.length} Count
                  {selectedCounts.length !== 1 ? 's' : ''} to Operator
                </>
              )}
            </Button>

            {pushMode === 'pull' && (
              <p className='text-muted-foreground text-center text-xs'>
                Pull mode: Operators will claim work from the queue themselves
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
