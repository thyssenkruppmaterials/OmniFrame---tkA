// Created and developed by Jai Singh
import { useState } from 'react'
import { CheckCircle, ClipboardCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import type { StepProps } from './types'

const DEFAULT_OPTIONS = ['Good', 'Damaged', 'Expired']

export function RFStepConditionAssessment({
  step,
  taskData,
  onComplete,
  onBack,
  isProcessing,
}: StepProps) {
  const options = (step.config.options as string[]) ?? DEFAULT_OPTIONS
  const [condition, setCondition] = useState<string | null>(null)

  return (
    <div className='space-y-4'>
      <div className='mb-6 space-y-2 text-center'>
        <ClipboardCheck className='text-primary mx-auto h-12 w-12' />
        <h3 className='text-lg font-semibold'>Condition Assessment</h3>
        <p className='text-muted-foreground text-sm'>
          Assess the condition of the material at this location
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
        <Label className='text-sm font-medium'>Select Condition</Label>
        <div className='space-y-2'>
          {options.map((option) => (
            <Button
              key={option}
              type='button'
              variant={condition === option ? 'default' : 'outline'}
              className='h-14 w-full justify-start text-lg'
              onClick={() => setCondition(option)}
            >
              {condition === option && <CheckCircle className='mr-3 h-5 w-5' />}
              <span className={condition === option ? 'font-semibold' : ''}>
                {option}
              </span>
            </Button>
          ))}
        </div>
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
          onClick={() => onComplete({ condition })}
          disabled={isProcessing || !condition}
          className='h-14 flex-[2] text-lg'
        >
          Continue
        </Button>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
