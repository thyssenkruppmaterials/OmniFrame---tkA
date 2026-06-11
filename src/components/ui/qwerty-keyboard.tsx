// Created and developed by Jai Singh
/**
 * QWERTY Keyboard Component
 *
 * Full alphanumeric keyboard for RF interface data entry
 * Supports uppercase/lowercase toggle and special characters
 */
import React, { useState } from 'react'
import { Delete, Space } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface QWERTYKeyboardProps {
  value: string
  onChange: (value: string) => void
  label?: string
  placeholder?: string
}

export const QWERTYKeyboard: React.FC<QWERTYKeyboardProps> = ({
  value,
  onChange,
  placeholder = 'Type or use keyboard below',
}) => {
  const [isUpperCase, setIsUpperCase] = useState(true)

  const handleKeyPress = (key: string) => {
    if (key === 'backspace') {
      onChange(value.slice(0, -1))
    } else if (key === 'space') {
      onChange(value + ' ')
    } else if (key === 'clear') {
      onChange('')
    } else if (key === 'shift') {
      setIsUpperCase(!isUpperCase)
    } else {
      onChange(value + key)
    }
  }

  // Keyboard layout
  const row1 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
  const row2 = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P']
  const row3 = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L']
  const row4 = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '-', '@', '.']

  const getDisplayKey = (key: string) => {
    if (key === key.toUpperCase() && key !== key.toLowerCase()) {
      return isUpperCase ? key : key.toLowerCase()
    }
    return key
  }

  return (
    <div className='space-y-4'>
      {/* Display */}
      <div className='bg-muted/30 border-muted-foreground/30 flex min-h-[60px] items-center justify-center rounded-lg border-2 border-dashed p-4'>
        <div className='w-full text-center'>
          {value ? (
            <div className='font-mono text-2xl font-bold break-all'>
              {value}
            </div>
          ) : (
            <div className='text-muted-foreground text-lg'>{placeholder}</div>
          )}
        </div>
      </div>

      {/* Keyboard */}
      <div className='space-y-2'>
        {/* Row 1: Numbers */}
        <div className='grid grid-cols-10 gap-1'>
          {row1.map((key) => (
            <Button
              key={key}
              type='button'
              variant='outline'
              size='sm'
              className='h-10 p-0 text-sm font-semibold'
              onClick={() => handleKeyPress(key)}
            >
              {key}
            </Button>
          ))}
        </div>

        {/* Row 2: QWERTYUIOP */}
        <div className='grid grid-cols-10 gap-1'>
          {row2.map((key) => (
            <Button
              key={key}
              type='button'
              variant='outline'
              size='sm'
              className='h-10 p-0 text-sm font-semibold'
              onClick={() => handleKeyPress(getDisplayKey(key))}
            >
              {getDisplayKey(key)}
            </Button>
          ))}
        </div>

        {/* Row 3: ASDFGHJKL */}
        <div className='grid grid-cols-10 gap-1'>
          <div className='col-span-1' /> {/* Offset for centering */}
          {row3.map((key) => (
            <Button
              key={key}
              type='button'
              variant='outline'
              size='sm'
              className='h-10 p-0 text-sm font-semibold'
              onClick={() => handleKeyPress(getDisplayKey(key))}
            >
              {getDisplayKey(key)}
            </Button>
          ))}
        </div>

        {/* Row 4: ZXCVBNM + @ . */}
        <div className='grid grid-cols-11 gap-1'>
          {/* Shift key */}
          <Button
            type='button'
            variant={isUpperCase ? 'default' : 'outline'}
            size='sm'
            className='h-10 p-0 text-xs font-semibold'
            onClick={() => handleKeyPress('shift')}
          >
            {isUpperCase ? 'ABC' : 'abc'}
          </Button>
          {row4.map((key) => (
            <Button
              key={key}
              type='button'
              variant='outline'
              size='sm'
              className='h-10 p-0 text-sm font-semibold'
              onClick={() =>
                handleKeyPress(
                  ['-', '@', '.'].includes(key) ? key : getDisplayKey(key)
                )
              }
            >
              {['-', '@', '.'].includes(key) ? key : getDisplayKey(key)}
            </Button>
          ))}
        </div>

        {/* Row 5: Space, Backspace, Clear */}
        <div className='grid grid-cols-12 gap-1'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='col-span-2 h-10 text-xs font-medium'
            onClick={() => handleKeyPress('clear')}
          >
            Clear
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='col-span-6 h-10 text-sm font-medium'
            onClick={() => handleKeyPress('space')}
          >
            <Space className='mr-1 h-4 w-4' />
            Space
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='col-span-4 h-10 text-sm font-medium'
            onClick={() => handleKeyPress('backspace')}
          >
            <Delete className='mr-1 h-4 w-4' />
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
