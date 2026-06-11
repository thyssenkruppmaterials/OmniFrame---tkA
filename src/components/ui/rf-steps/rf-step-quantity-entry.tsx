// Created and developed by Jai Singh
import { useState } from 'react'
import { Calculator, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { StepProps } from './types'

export function RFStepQuantityEntry({
  taskData,
  onComplete,
  onBack,
  isProcessing,
}: StepProps) {
  const [value, setValue] = useState(0)

  const handleKeypadClick = (key: string) => {
    if (key === 'clear') {
      setValue(0)
    } else if (key === 'backspace') {
      setValue(Math.floor(value / 10))
    } else {
      const digit = parseInt(key)
      const newValue = value * 10 + digit
      if (newValue <= 99999) {
        setValue(newValue)
      }
    }
  }

  return (
    <div className='space-y-4'>
      <div className='mb-6 space-y-2 text-center'>
        <Calculator className='text-primary mx-auto h-12 w-12' />
        <h3 className='text-lg font-semibold'>Enter Quantity</h3>
        <p className='text-muted-foreground text-sm'>
          Count the items at this location and enter the quantity
        </p>
      </div>

      <Card className='mb-4'>
        <CardContent className='p-4'>
          <div className='text-center'>
            <p className='text-muted-foreground mb-1 text-sm'>Count Item</p>
            <p className='text-primary text-lg font-bold'>
              {taskData.material_number}
              <span className='text-muted-foreground ml-2 text-sm font-normal'>
                ({taskData.unit_of_measure || 'EA'})
              </span>
            </p>
            <p className='text-muted-foreground mt-1 text-xs'>
              Location: {taskData.location}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className='bg-muted/30 border-muted-foreground/30 rounded-lg border-2 border-dashed p-6 text-center'>
        <div className='text-primary mb-2 font-mono text-5xl font-bold'>
          {value}
        </div>
        <div className='text-muted-foreground text-sm'>
          Counted Quantity ({taskData.unit_of_measure || 'EA'})
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

      {value > 0 && (
        <Card className='border-primary border-dashed'>
          <CardContent className='p-3'>
            <div className='flex items-center justify-center gap-2 text-sm'>
              <CheckCircle className='text-primary h-4 w-4' />
              <span className='text-primary font-medium'>
                Counted: {value} {taskData.unit_of_measure || 'EA'}
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
          onClick={() => onComplete({ countedQuantity: value })}
          disabled={isProcessing}
          className='h-14 flex-[2] text-lg'
        >
          Submit Count
        </Button>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
