// Created and developed by Jai Singh
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { StepProps } from './types'

export function RFStepSupervisorSignoff({
  taskData,
  onComplete,
  onBack,
  isProcessing,
}: StepProps) {
  return (
    <div className='space-y-4'>
      <div className='mb-6 space-y-2 text-center'>
        <ShieldCheck className='text-primary mx-auto h-12 w-12' />
        <h3 className='text-lg font-semibold'>Supervisor Sign-Off</h3>
        <p className='text-muted-foreground text-sm'>
          This count requires supervisor approval before completion
        </p>
      </div>

      <Card className='border-2 border-orange-300'>
        <CardContent className='p-4'>
          <div className='space-y-3 text-sm'>
            <div className='rounded-lg bg-orange-50 p-3 dark:bg-orange-950/20'>
              <p className='text-center font-medium text-orange-800 dark:text-orange-200'>
                This count requires supervisor approval before completion.
              </p>
              <p className='text-muted-foreground mt-2 text-center text-xs'>
                Submitting will transition this task to pending supervisor
                review. You will not be able to complete it until a supervisor
                approves.
              </p>
            </div>

            <div className='flex justify-between border-t pt-2'>
              <span className='text-muted-foreground'>Count Number:</span>
              <span className='font-mono font-medium'>
                {taskData.count_number}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Material:</span>
              <span className='font-medium'>{taskData.material_number}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Location:</span>
              <span className='font-mono font-medium'>{taskData.location}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className='flex gap-2'>
        <Button
          variant='outline'
          onClick={onBack}
          disabled={isProcessing}
          className='h-14 flex-1 text-lg'
        >
          Back
        </Button>
        <Button
          onClick={() => onComplete({ awaitingSignoff: true })}
          disabled={isProcessing}
          className='h-14 flex-[2] text-lg'
        >
          <ShieldCheck className='mr-2 h-5 w-5' />
          Submit for Approval
        </Button>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
