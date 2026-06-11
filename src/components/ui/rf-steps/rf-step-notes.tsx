// Created and developed by Jai Singh
import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { QWERTYKeyboard } from '@/components/ui/qwerty-keyboard'
import { Textarea } from '@/components/ui/textarea'
import type { StepProps } from './types'

export function RFStepNotes({
  step,
  onComplete,
  onBack,
  isProcessing,
}: StepProps) {
  const [notes, setNotes] = useState('')
  const [useKeyboard, setUseKeyboard] = useState(false)

  return (
    <div className='space-y-4'>
      <div className='mb-6 space-y-2 text-center'>
        <FileText className='text-primary mx-auto h-12 w-12' />
        <h3 className='text-lg font-semibold'>Notes</h3>
        <p className='text-muted-foreground text-sm'>
          {step.required
            ? 'Add notes for this count (required)'
            : 'Optionally add notes for this count'}
        </p>
      </div>

      <div className='space-y-2'>
        <Label htmlFor='step-notes' className='text-sm font-medium'>
          {step.required ? 'Notes (Required)' : 'Notes (Optional)'}
        </Label>

        {!useKeyboard ? (
          <>
            <Textarea
              id='step-notes'
              placeholder='Add any notes about this count...'
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isProcessing}
              className='min-h-[120px]'
            />
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='w-full'
              onClick={() => setUseKeyboard(true)}
            >
              Use On-Screen Keyboard
            </Button>
          </>
        ) : (
          <>
            <QWERTYKeyboard
              value={notes}
              onChange={(value) => setNotes(value)}
              placeholder='Type notes'
            />
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='w-full'
              onClick={() => setUseKeyboard(false)}
            >
              Use Text Input
            </Button>
          </>
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
        {!step.required && !notes.trim() ? (
          <Button
            variant='secondary'
            onClick={() => onComplete({ notes: '' })}
            disabled={isProcessing}
            className='h-14 flex-[2] text-lg'
          >
            Skip
          </Button>
        ) : (
          <Button
            onClick={() => onComplete({ notes })}
            disabled={isProcessing || (step.required && !notes.trim())}
            className='h-14 flex-[2] text-lg'
          >
            Continue
          </Button>
        )}
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
