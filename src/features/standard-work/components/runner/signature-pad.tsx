// Created and developed by Jai Singh
/**
 * Signature Pad
 *
 * Lightweight HTML5 canvas signature capture used by the Standard Work
 * runner for `signature` item types. Pointer-event based so it works on
 * mouse, touch, and stylus input. Calls `onCapture` with a PNG blob whenever
 * the user accepts (Save) the signature.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, Pen, Save } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface SignaturePadProps {
  onCapture: (blob: Blob) => Promise<void> | void
  disabled?: boolean
  /** Existing signature URL to render as a saved preview. */
  existingUrl?: string | null
  className?: string
  isSaving?: boolean
}

export function SignaturePad({
  onCapture,
  disabled,
  existingUrl,
  className,
  isSaving,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [isEmpty, setIsEmpty] = useState(true)

  // Configure canvas DPI / size relative to its container so the drawing
  // surface stays crisp on high-DPI displays.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'currentColor'
  }, [])

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = getPos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    setIsDrawing(true)
    setIsEmpty(false)
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = getPos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const end = () => {
    setIsDrawing(false)
  }

  const clear = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setIsEmpty(true)
  }, [])

  const save = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || isEmpty) return
    canvas.toBlob(
      async (blob) => {
        if (!blob) return
        await onCapture(blob)
      },
      'image/png',
      0.92
    )
  }, [isEmpty, onCapture])

  return (
    <div className={cn('space-y-2', className)}>
      {existingUrl && (
        <div className='border-border/50 bg-muted/20 rounded-lg border p-2'>
          <p className='text-muted-foreground mb-1.5 text-[10px] font-medium tracking-wider uppercase'>
            Saved signature
          </p>
          <img
            src={existingUrl}
            alt='Saved signature'
            className='max-h-24 rounded border bg-white'
          />
        </div>
      )}
      <div
        className={cn(
          'relative rounded-lg border-2 border-dashed bg-white',
          'aspect-4/1 min-h-[120px]',
          disabled && 'opacity-50'
        )}
      >
        <canvas
          ref={canvasRef}
          className='h-full w-full cursor-crosshair touch-none rounded-md text-slate-900'
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          aria-label='Signature pad. Sign with your mouse, finger, or stylus.'
        />
        {isEmpty && (
          <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
            <span className='text-muted-foreground/60 flex items-center gap-1.5 text-xs'>
              <Pen className='h-3 w-3' aria-hidden='true' />
              Sign here
            </span>
          </div>
        )}
      </div>
      <div className='flex items-center gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={clear}
          disabled={disabled || isEmpty}
          className='h-8'
        >
          <Eraser className='mr-1.5 h-3 w-3' />
          Clear
        </Button>
        <Button
          type='button'
          size='sm'
          onClick={save}
          disabled={disabled || isEmpty || isSaving}
          className='h-8'
        >
          <Save className='mr-1.5 h-3 w-3' />
          {isSaving
            ? 'Saving…'
            : existingUrl
              ? 'Update Signature'
              : 'Save Signature'}
        </Button>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
