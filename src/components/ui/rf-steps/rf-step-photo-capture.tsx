// Created and developed by Jai Singh
import { useRef, useState } from 'react'
import { Camera, CheckCircle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { StepProps } from './types'

export function RFStepPhotoCapture({
  step,
  onComplete,
  onBack,
  isProcessing,
}: StepProps) {
  const maxPhotos = (step.config.max_photos as number) ?? 3
  const [photos, setPhotos] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleCapture = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB')
      return
    }
    if (photos.length >= maxPhotos) {
      toast.error(`Maximum ${maxPhotos} photos allowed`)
      return
    }

    setPhotos((prev) => [...prev, file])
    const reader = new FileReader()
    reader.onloadend = () => {
      setPreviews((prev) => [...prev, reader.result as string])
    }
    reader.readAsDataURL(file)
    toast.success('Photo captured')

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleRemove = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index))
    setPreviews((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className='space-y-4'>
      <div className='mb-6 space-y-2 text-center'>
        <Camera className='text-primary mx-auto h-12 w-12' />
        <h3 className='text-lg font-semibold'>Photo Capture</h3>
        <p className='text-muted-foreground text-sm'>
          Take photos to document this count ({photos.length}/{maxPhotos})
        </p>
      </div>

      {previews.length > 0 && (
        <div className='grid grid-cols-2 gap-2'>
          {previews.map((preview, index) => (
            <div
              key={index}
              className='relative overflow-hidden rounded-lg border-2 border-green-500'
            >
              <img
                src={preview}
                alt={`Photo ${index + 1}`}
                className='h-32 w-full object-cover'
              />
              <Badge className='absolute top-2 left-2 bg-green-600'>
                <CheckCircle className='mr-1 h-3 w-3' />
                {index + 1}
              </Badge>
              <Button
                type='button'
                variant='destructive'
                size='sm'
                className='absolute top-1 right-1 h-7 w-7 p-0'
                onClick={() => handleRemove(index)}
              >
                <Trash2 className='h-3 w-3' />
              </Button>
            </div>
          ))}
        </div>
      )}

      {photos.length < maxPhotos && (
        <div className='relative'>
          <input
            ref={fileInputRef}
            type='file'
            accept='image/*'
            capture='environment'
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleCapture(file)
            }}
            className='absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0'
            title='Tap to capture photo'
          />
          <div className='hover:bg-accent hover:border-accent-foreground/20 pointer-events-none flex h-24 w-full items-center justify-center rounded-lg border-2 border-dashed transition-colors'>
            <div className='flex flex-col items-center space-y-1'>
              <Camera className='text-muted-foreground h-6 w-6' />
              <span className='text-xs font-medium'>
                {photos.length === 0
                  ? 'Tap to Capture Photo'
                  : 'Add Another Photo'}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className='flex gap-2'>
        <Button
          variant='outline'
          onClick={onBack}
          disabled={isProcessing}
          className='h-14 flex-1 text-lg'
        >
          Back
        </Button>
        {!step.required && photos.length === 0 ? (
          <Button
            variant='secondary'
            onClick={() => onComplete({ photos: [] })}
            disabled={isProcessing}
            className='h-14 flex-[2] text-lg'
          >
            Skip
          </Button>
        ) : (
          <Button
            onClick={() => onComplete({ photos })}
            disabled={isProcessing || (step.required && photos.length === 0)}
            className='h-14 flex-[2] text-lg'
          >
            {photos.length > 0
              ? `Continue (${photos.length} photo${photos.length !== 1 ? 's' : ''})`
              : 'Continue'}
          </Button>
        )}
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
