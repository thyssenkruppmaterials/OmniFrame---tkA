// Created and developed by Jai Singh
import { useState } from 'react'
import { Hash, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ScannerInput } from '@/components/ui/scanner-input'
import type { StepProps } from './types'

export function RFStepSerialCapture({
  step,
  onComplete,
  onBack,
  isProcessing,
}: StepProps) {
  const minSerials = (step.config.min_serials as number) ?? 1
  const [serialNumbers, setSerialNumbers] = useState<string[]>([])
  const [currentSerial, setCurrentSerial] = useState('')

  const handleAdd = () => {
    const trimmed = currentSerial.trim()
    if (!trimmed) {
      toast.error('Please enter or scan a serial number')
      return
    }
    if (serialNumbers.includes(trimmed)) {
      toast.error('This serial number has already been captured')
      return
    }
    setSerialNumbers((prev) => [...prev, trimmed])
    setCurrentSerial('')
    toast.success(`Serial captured: ${trimmed}`)
  }

  const handleRemove = (index: number) => {
    setSerialNumbers((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className='space-y-4'>
      <div className='mb-6 space-y-2 text-center'>
        <Hash className='text-primary mx-auto h-12 w-12' />
        <h3 className='text-lg font-semibold'>Capture Serial Numbers</h3>
        <p className='text-muted-foreground text-sm'>
          Scan or enter serial numbers (minimum {minSerials})
        </p>
      </div>

      <div className='space-y-2'>
        <Label className='text-sm font-medium'>Scan Serial Number</Label>
        <div className='flex gap-2'>
          <ScannerInput
            placeholder='Scan serial number'
            value={currentSerial}
            onChange={(e) => setCurrentSerial(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
            className='flex-1 font-mono'
            autoFocus
          />
          <Button
            onClick={handleAdd}
            disabled={!currentSerial.trim()}
            className='h-9 px-4'
          >
            <Plus className='mr-1 h-4 w-4' />
            Add
          </Button>
        </div>
      </div>

      {serialNumbers.length > 0 && (
        <Card>
          <CardContent className='p-3'>
            <div className='mb-2 flex items-center justify-between'>
              <Label className='text-sm font-medium'>Captured Serials</Label>
              <Badge variant='secondary'>{serialNumbers.length}</Badge>
            </div>
            <div className='space-y-2'>
              {serialNumbers.map((serial, index) => (
                <div
                  key={index}
                  className='bg-muted/50 flex items-center justify-between rounded-md px-3 py-2'
                >
                  <span className='font-mono text-sm'>{serial}</span>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='h-7 w-7 p-0 text-red-500 hover:text-red-700'
                    onClick={() => handleRemove(index)}
                  >
                    <Trash2 className='h-3 w-3' />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {serialNumbers.length === 0 && (
        <Card className='border-dashed'>
          <CardContent className='p-4'>
            <p className='text-muted-foreground text-center text-sm'>
              No serial numbers captured yet
            </p>
          </CardContent>
        </Card>
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
        <Button
          onClick={() => onComplete({ serialNumbers })}
          disabled={isProcessing || serialNumbers.length < minSerials}
          className='h-14 flex-[2] text-lg'
        >
          Continue ({serialNumbers.length}/{minSerials})
        </Button>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
