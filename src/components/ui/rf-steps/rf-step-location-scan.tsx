// Created and developed by Jai Singh
import { useState } from 'react'
import { AlertCircle, CheckCircle, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ScannerInput } from '@/components/ui/scanner-input'
import type { StepProps } from './types'

export function RFStepLocationScan({
  taskData,
  onComplete,
  onBack,
  isProcessing,
}: StepProps) {
  const [scannedLocation, setScannedLocation] = useState('')
  const [verified, setVerified] = useState(false)
  const [mismatch, setMismatch] = useState(false)

  const handleVerify = () => {
    const trimmed = scannedLocation.trim()
    if (!trimmed) {
      toast.error('Please scan a location')
      return
    }

    if (trimmed.toUpperCase() === taskData.location.trim().toUpperCase()) {
      setVerified(true)
      setMismatch(false)
      toast.success(`Location verified: ${taskData.location}`)
      onComplete({ scannedLocation: trimmed, verified: true })
    } else {
      setVerified(false)
      setMismatch(true)
      toast.error(`Location mismatch! Expected: ${taskData.location}`)
    }
  }

  return (
    <div className='space-y-4'>
      <div className='mb-6 space-y-2 text-center'>
        <MapPin className='text-primary mx-auto h-12 w-12' />
        <h3 className='text-lg font-semibold'>Scan Location</h3>
        <p className='text-muted-foreground text-sm'>
          Scan the location barcode to confirm you're at the correct spot
        </p>
      </div>

      <Card>
        <CardContent className='p-4'>
          <div className='text-center'>
            <p className='text-muted-foreground mb-1 text-sm'>
              Expected Location
            </p>
            <p className='text-primary font-mono text-xl font-bold'>
              {taskData.location}
            </p>
            <p className='text-muted-foreground mt-1 text-xs'>
              Material: {taskData.material_number}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className='space-y-2'>
        <Label className='text-sm font-medium'>Scan Location Barcode</Label>
        <ScannerInput
          type='text'
          placeholder='Scan location barcode'
          value={scannedLocation}
          onChange={(e) => {
            setScannedLocation(e.target.value)
            setMismatch(false)
            setVerified(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleVerify()
            }
          }}
          disabled={isProcessing}
          className='text-center font-mono text-lg font-semibold'
          autoFocus
        />
      </div>

      {mismatch && (
        <Card className='border-dashed border-red-500'>
          <CardContent className='p-3'>
            <div className='flex items-center justify-center gap-2 text-sm text-red-600'>
              <AlertCircle className='h-4 w-4' />
              <span className='font-medium'>
                Mismatch: "{scannedLocation}" does not match "
                {taskData.location}"
              </span>
            </div>
            <p className='text-muted-foreground mt-1 text-center text-xs'>
              Clear and scan the correct location barcode
            </p>
          </CardContent>
        </Card>
      )}

      {verified && (
        <Card className='border-dashed border-green-500'>
          <CardContent className='p-3'>
            <div className='flex items-center justify-center gap-2 text-sm text-green-600'>
              <CheckCircle className='h-4 w-4' />
              <span className='font-medium'>
                Location Verified: {scannedLocation}
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
          onClick={handleVerify}
          disabled={isProcessing || !scannedLocation.trim()}
          className='h-14 flex-[2] text-lg'
        >
          Verify Location
        </Button>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
