// Created and developed by Jai Singh
import { MapPin, Package, Play } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { StepProps } from './types'

const priorityStyles: Record<string, { className: string; label: string }> = {
  critical: {
    className: 'bg-red-600 text-white hover:bg-red-700',
    label: 'CRITICAL',
  },
  hot: {
    className: 'bg-orange-500 text-white hover:bg-orange-600',
    label: 'HOT',
  },
  normal: {
    className: 'bg-blue-500 text-white hover:bg-blue-600',
    label: 'NORMAL',
  },
  low: { className: 'bg-gray-500 text-white hover:bg-gray-600', label: 'LOW' },
}

export function RFStepConfirm({
  taskData,
  onComplete,
  isProcessing,
}: StepProps) {
  const priority = priorityStyles[taskData.priority] ?? priorityStyles.normal
  const isRecount =
    taskData.counted_quantity !== null &&
    taskData.counted_quantity !== undefined

  return (
    <div className='space-y-4'>
      <div className='mb-6 space-y-2 text-center'>
        <Package className='text-primary mx-auto h-12 w-12' />
        <h3 className='text-lg font-semibold'>Confirm Item Details</h3>
        <p className='text-muted-foreground text-sm'>
          Verify the assigned count information before starting
        </p>
      </div>

      <Card>
        <CardContent className='p-4'>
          <h4 className='mb-3 flex items-center font-semibold'>
            <Package className='mr-2 h-4 w-4' />
            Assigned Count Information
          </h4>
          <div className='grid grid-cols-2 gap-3 text-sm'>
            <div>
              <span className='text-muted-foreground'>Count Number:</span>
              <div className='font-mono font-medium'>
                {taskData.count_number}
              </div>
            </div>
            <div>
              <span className='text-muted-foreground'>Material:</span>
              <div className='font-medium'>{taskData.material_number}</div>
            </div>
            <div className='col-span-2'>
              <span className='text-muted-foreground'>Description:</span>
              <div className='font-medium'>
                {taskData.material_description || 'N/A'}
              </div>
            </div>
            <div>
              <span className='text-muted-foreground'>Location:</span>
              <div className='flex items-center gap-1 font-mono font-medium'>
                <MapPin className='h-3 w-3' />
                {taskData.location}
              </div>
            </div>
            <div>
              <span className='text-muted-foreground'>Unit:</span>
              <div className='text-primary font-medium'>
                {taskData.unit_of_measure || 'EA'}
              </div>
            </div>
            {isRecount && (
              <div className='col-span-2 border-t pt-2'>
                <span className='text-muted-foreground'>System Quantity:</span>
                <div className='text-primary text-lg font-bold'>
                  {taskData.system_quantity.toLocaleString()}{' '}
                  {taskData.unit_of_measure || 'EA'}
                </div>
                <p className='text-muted-foreground mt-1 text-xs'>
                  Previous count: {taskData.counted_quantity?.toLocaleString()}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className='text-center'>
        <Badge className={priority.className}>{priority.label}</Badge>
      </div>

      <Button
        onClick={() => onComplete({})}
        disabled={isProcessing}
        className='h-14 w-full text-lg'
      >
        <Play className='mr-2 h-5 w-5' />
        Start Count
      </Button>
    </div>
  )
}

// Created and developed by Jai Singh
