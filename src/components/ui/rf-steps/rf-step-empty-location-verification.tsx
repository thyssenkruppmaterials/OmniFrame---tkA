// Created and developed by Jai Singh
import { useState } from 'react'
import { AlertTriangle, CheckCircle, Package, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ScannerInput } from '@/components/ui/scanner-input'
import type { StepProps } from './types'

export function RFStepEmptyLocationVerification({
  taskData,
  onComplete,
  onBack,
  isProcessing,
}: StepProps) {
  const [isEmpty, setIsEmpty] = useState<boolean | null>(null)
  const [foundPartNumber, setFoundPartNumber] = useState('')
  const [foundQuantity, setFoundQuantity] = useState(0)

  const handleKeypadClick = (key: string) => {
    if (key === 'clear') {
      setFoundQuantity(0)
    } else if (key === 'backspace') {
      setFoundQuantity(Math.floor(foundQuantity / 10))
    } else {
      const digit = parseInt(key)
      const newValue = foundQuantity * 10 + digit
      if (newValue <= 99999) {
        setFoundQuantity(newValue)
      }
    }
  }

  const handleSubmit = () => {
    if (isEmpty === true) {
      onComplete({ isEmpty: true })
    } else {
      onComplete({
        isEmpty: false,
        foundPartNumber,
        foundQuantity,
      })
    }
  }

  const canSubmit =
    isEmpty === true ||
    (isEmpty === false && foundPartNumber.trim() !== '' && foundQuantity > 0)

  return (
    <div className='space-y-4'>
      <div className='mb-6 space-y-2 text-center'>
        <Package className='text-primary mx-auto h-12 w-12' />
        <h3 className='text-lg font-semibold'>Empty Location Verification</h3>
        <p className='text-muted-foreground text-sm'>
          Verify if this location is actually empty
        </p>
      </div>

      <Card>
        <CardContent className='p-4'>
          <div className='text-center'>
            <p className='text-muted-foreground mb-1 text-sm'>Location</p>
            <p className='text-primary font-mono text-lg font-bold'>
              {taskData.location}
            </p>
            <p className='text-muted-foreground mt-1 text-xs'>
              Material: {taskData.material_number}
            </p>
            <p className='mt-2 text-xs font-medium text-orange-600'>
              Should be EMPTY
            </p>
          </div>
        </CardContent>
      </Card>

      {isEmpty === null && (
        <Card className='border-primary border-2'>
          <CardContent className='p-4'>
            <p className='mb-4 text-center font-medium'>
              Is this location empty?
            </p>
            <div className='grid grid-cols-2 gap-3'>
              <Button
                size='lg'
                variant='default'
                className='h-16'
                onClick={() => setIsEmpty(true)}
              >
                <CheckCircle className='mr-2 h-5 w-5' />
                Yes, Empty
              </Button>
              <Button
                size='lg'
                variant='outline'
                className='h-16'
                onClick={() => setIsEmpty(false)}
              >
                <XCircle className='mr-2 h-5 w-5' />
                No, Has Material
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isEmpty === true && (
        <Card className='border-2 border-green-500'>
          <CardContent className='p-4'>
            <div className='flex items-center justify-center text-green-600'>
              <CheckCircle className='mr-2 h-5 w-5' />
              <span className='font-semibold'>Location Confirmed Empty</span>
            </div>
          </CardContent>
        </Card>
      )}

      {isEmpty === false && (
        <div className='space-y-4'>
          <Card className='border-2 border-orange-500'>
            <CardContent className='p-4'>
              <div className='mb-4 flex items-center justify-center text-orange-600'>
                <AlertTriangle className='mr-2 h-5 w-5' />
                <span className='font-semibold'>
                  Material Found in Location
                </span>
              </div>

              <div className='space-y-3'>
                <div className='space-y-2'>
                  <Label>Part Number</Label>
                  <ScannerInput
                    placeholder='Scan or enter part number'
                    value={foundPartNumber}
                    onChange={(e) => setFoundPartNumber(e.target.value)}
                    className='font-mono'
                  />
                </div>

                <div className='space-y-2'>
                  <Label>Quantity Found</Label>
                  <div className='bg-muted/30 border-muted-foreground/30 rounded-lg border-2 border-dashed p-4 text-center'>
                    <div className='text-primary mb-1 font-mono text-4xl font-bold'>
                      {foundQuantity}
                    </div>
                    <div className='text-muted-foreground text-sm'>
                      Quantity Found ({taskData.unit_of_measure || 'EA'})
                    </div>
                  </div>

                  <div className='grid grid-cols-3 gap-2'>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                      <Button
                        key={num}
                        type='button'
                        variant='outline'
                        className='hover:bg-primary hover:text-primary-foreground h-14 text-xl font-semibold transition-all active:scale-95'
                        onClick={() => handleKeypadClick(num.toString())}
                      >
                        {num}
                      </Button>
                    ))}
                    <Button
                      type='button'
                      variant='outline'
                      className='hover:bg-destructive hover:text-destructive-foreground h-14 text-sm font-medium'
                      onClick={() => handleKeypadClick('clear')}
                    >
                      Clear
                    </Button>
                    <Button
                      type='button'
                      variant='outline'
                      className='hover:bg-primary hover:text-primary-foreground h-14 text-xl font-semibold'
                      onClick={() => handleKeypadClick('0')}
                    >
                      0
                    </Button>
                    <Button
                      type='button'
                      variant='outline'
                      className='hover:bg-secondary hover:text-secondary-foreground h-14 text-lg font-medium'
                      onClick={() => handleKeypadClick('backspace')}
                    >
                      ←
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Button
            variant='outline'
            size='sm'
            className='w-full'
            onClick={() => {
              setIsEmpty(null)
              setFoundPartNumber('')
              setFoundQuantity(0)
            }}
          >
            ← Back to Verification
          </Button>
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
        {isEmpty !== null && (
          <Button
            onClick={handleSubmit}
            disabled={isProcessing || !canSubmit}
            className='h-14 flex-[2] text-lg'
          >
            Submit
          </Button>
        )}
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
