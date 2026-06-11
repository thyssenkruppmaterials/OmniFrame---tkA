// Created and developed by Jai Singh
import { useState } from 'react'
import { CheckCircle, ScanLine } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ScannerInput } from '@/components/ui/scanner-input'
import type { StepProps } from './types'

export function RFStepBarcodeScan({
  taskData,
  onComplete,
  onBack,
  isProcessing,
}: StepProps) {
  const [scannedBarcode, setScannedBarcode] = useState('')

  const handleSubmit = () => {
    const trimmed = scannedBarcode.trim()
    if (!trimmed) {
      toast.error('Please scan a barcode')
      return
    }
    onComplete({ scannedBarcode: trimmed })
  }

  return (
    <div className='space-y-4'>
      <div className='mb-6 space-y-2 text-center'>
        <ScanLine className='text-primary mx-auto h-12 w-12' />
        <h3 className='text-lg font-semibold'>Scan Barcode</h3>
        <p className='text-muted-foreground text-sm'>
          Scan the item barcode label
        </p>
      </div>

      <Card>
        <CardContent className='p-4'>
          <div className='text-center'>
            <p className='text-muted-foreground mb-1 text-sm'>Material</p>
            <p className='text-primary font-mono text-lg font-bold'>
              {taskData.material_number}
            </p>
            <p className='text-muted-foreground mt-1 text-xs'>
              Location: {taskData.location}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className='space-y-2'>
        <Label className='text-sm font-medium'>Scan Barcode Label</Label>
        <ScannerInput
          placeholder='Scan barcode'
          value={scannedBarcode}
          onChange={(e) => setScannedBarcode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSubmit()
            }
          }}
          disabled={isProcessing}
          className='text-center font-mono text-lg font-semibold'
          autoFocus
        />
      </div>

      {scannedBarcode.trim() && (
        <Card className='border-primary border-dashed'>
          <CardContent className='p-3'>
            <div className='flex items-center justify-center gap-2 text-sm'>
              <CheckCircle className='text-primary h-4 w-4' />
              <span className='text-primary font-mono font-medium'>
                {scannedBarcode.trim()}
              </span>
            </div>
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
          onClick={handleSubmit}
          disabled={isProcessing || !scannedBarcode.trim()}
          className='h-14 flex-[2] text-lg'
        >
          Continue
        </Button>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
