// Created and developed by Jai Singh
import { useRef, useState } from 'react'
import { AlertTriangle, Camera, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { StepProps } from './types'

export function RFStepReview({
  taskData,
  stepResult,
  onComplete,
  onBack,
  isProcessing,
}: StepProps) {
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const countedQuantity = (stepResult.countedQuantity as number) ?? 0
  const systemQty = taskData.system_quantity
  const variance = countedQuantity - systemQty
  const percentage =
    systemQty > 0
      ? Math.abs((variance / systemQty) * 100)
      : variance !== 0
        ? Infinity
        : 0

  const handlePhotoCapture = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB')
      return
    }
    setPhoto(file)
    const reader = new FileReader()
    reader.onloadend = () => {
      setPhotoPreview(reader.result as string)
    }
    reader.readAsDataURL(file)
    toast.success('Photo captured')
  }

  return (
    <div className='space-y-4'>
      <div className='mb-6 space-y-2 text-center'>
        <AlertTriangle className='mx-auto h-12 w-12 text-orange-500' />
        <h3 className='text-lg font-semibold'>Variance Review Required</h3>
        <p className='text-muted-foreground text-sm'>
          This count has a significant variance that requires review
        </p>
      </div>

      <Card className='border-orange-200'>
        <CardContent className='p-4'>
          <h4 className='mb-3 flex items-center font-semibold text-orange-600'>
            <AlertTriangle className='mr-2 h-4 w-4' />
            Variance Detected
          </h4>
          <div className='space-y-3 text-sm'>
            <div className='mb-3 rounded-lg bg-orange-50 p-3 dark:bg-orange-950/20'>
              <p className='text-center font-medium text-orange-800 dark:text-orange-200'>
                Your count differs from the system quantity
              </p>
            </div>

            <div className='flex justify-between'>
              <span className='text-muted-foreground'>System Quantity:</span>
              <span className='font-medium'>
                {systemQty.toLocaleString()} {taskData.unit_of_measure || 'EA'}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Your Count:</span>
              <span className='font-medium'>
                {countedQuantity.toLocaleString()}{' '}
                {taskData.unit_of_measure || 'EA'}
              </span>
            </div>
            <div className='flex justify-between border-t pt-2'>
              <span className='text-muted-foreground'>Variance:</span>
              <span
                className={cn(
                  'font-semibold',
                  variance > 0 ? 'text-orange-600' : 'text-red-600'
                )}
              >
                {variance > 0 ? '+' : ''}
                {variance} units
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Percentage:</span>
              <span className='font-semibold text-orange-600'>
                {percentage === Infinity
                  ? 'N/A (zero base)'
                  : `${percentage.toFixed(1)}%`}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className='space-y-2'>
        <Label htmlFor='review-notes' className='text-sm font-medium'>
          Notes (explain variance)
        </Label>
        <Textarea
          id='review-notes'
          placeholder='Add notes explaining the variance...'
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isProcessing}
          className='min-h-[80px]'
        />
      </div>

      <div className='space-y-2'>
        <Label className='text-sm font-medium'>Variance Photo (Optional)</Label>
        {photoPreview ? (
          <div className='space-y-2'>
            <div className='relative overflow-hidden rounded-lg border-2 border-green-500'>
              <img
                src={photoPreview}
                alt='Variance photo'
                className='h-32 w-full object-cover'
              />
              <Badge className='absolute top-2 right-2 bg-green-600'>
                <CheckCircle className='mr-1 h-3 w-3' />
                Photo
              </Badge>
            </div>
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='w-full'
              onClick={() => {
                setPhoto(null)
                setPhotoPreview(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
            >
              Retake Photo
            </Button>
          </div>
        ) : (
          <div className='relative'>
            <input
              ref={fileInputRef}
              type='file'
              accept='image/*'
              capture='environment'
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handlePhotoCapture(file)
              }}
              className='absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0'
              title='Tap to capture photo'
            />
            <div className='hover:bg-accent hover:border-accent-foreground/20 pointer-events-none flex h-20 w-full items-center justify-center rounded-lg border-2 border-dashed transition-colors'>
              <div className='flex flex-col items-center space-y-1'>
                <Camera className='text-muted-foreground h-5 w-5' />
                <span className='text-xs font-medium'>
                  Tap to Capture Photo
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

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
          onClick={() => onComplete({ reviewed: true, notes, photo })}
          disabled={isProcessing}
          className='h-14 flex-[2] text-lg'
        >
          Confirm & Complete
        </Button>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
