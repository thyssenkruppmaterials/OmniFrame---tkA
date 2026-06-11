// Created and developed by Jai Singh
/**
 * Photo Capture
 *
 * File-input based photo capture for Standard Work checklist `photo` items.
 * Prefers the device camera on mobile (`capture="environment"`) but falls
 * back to file selection on desktop. Shows a thumbnail preview and a Replace
 * action once a file is selected.
 */
import { useRef, useState } from 'react'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface PhotoCaptureProps {
  onCapture: (file: File) => Promise<void> | void
  onRemove?: () => Promise<void> | void
  existingUrl?: string | null
  disabled?: boolean
  isSaving?: boolean
  className?: string
}

export function PhotoCapture({
  onCapture,
  onRemove,
  existingUrl,
  disabled,
  isSaving,
  className,
}: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isPending, setIsPending] = useState(false)

  const handleSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setIsPending(true)
    try {
      await onCapture(file)
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <input
        ref={inputRef}
        type='file'
        accept='image/*'
        capture='environment'
        className='sr-only'
        onChange={handleSelect}
        disabled={disabled || isSaving}
      />

      {existingUrl ? (
        <div className='border-border/60 group relative overflow-hidden rounded-lg border'>
          <img
            src={existingUrl}
            alt='Captured evidence'
            className='bg-muted max-h-72 w-full object-contain'
          />
          <div className='from-background/90 absolute inset-x-0 bottom-0 flex items-center justify-end gap-2 bg-linear-to-t to-transparent p-2'>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() => inputRef.current?.click()}
              disabled={disabled || isSaving || isPending}
              className='h-8'
            >
              <Camera className='mr-1.5 h-3 w-3' />
              Replace
            </Button>
            {onRemove && (
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={() => onRemove()}
                disabled={disabled || isSaving || isPending}
                className='text-destructive hover:text-destructive h-8'
              >
                <Trash2 className='mr-1.5 h-3 w-3' />
                Remove
              </Button>
            )}
          </div>
        </div>
      ) : (
        <button
          type='button'
          onClick={() => inputRef.current?.click()}
          disabled={disabled || isSaving || isPending}
          className={cn(
            'group hover:border-primary/40 hover:bg-accent/30 flex h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed transition-colors',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2',
            (disabled || isSaving || isPending) &&
              'cursor-not-allowed opacity-50'
          )}
        >
          {isPending || isSaving ? (
            <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
          ) : (
            <Camera
              className='text-muted-foreground/60 group-hover:text-primary h-6 w-6 transition-colors'
              aria-hidden='true'
            />
          )}
          <div className='text-center'>
            <p className='text-sm font-medium'>
              {isPending || isSaving ? 'Uploading…' : 'Take or upload photo'}
            </p>
            <p className='text-muted-foreground mt-0.5 text-xs'>
              JPG, PNG · up to 8 MB
            </p>
          </div>
        </button>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
