/**
 * Date Picker Component
 * Modern date picker using shadcn/ui Calendar component
 * Based on: https://ui.shadcn.com/docs/components/date-picker
 * Created: October 25, 2025
 */
import * as React from 'react'
import { format } from 'date-fns'
import { Calendar as CalendarIcon, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface DatePickerProps {
  date?: Date
  onSelect?: (date: Date | undefined) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function DatePicker({
  date,
  onSelect,
  placeholder = 'Select date',
  className,
  disabled,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal',
            !date && 'text-muted-foreground',
            className
          )}
        >
          {date ? format(date, 'PPP') : placeholder}
          <ChevronDown className='h-4 w-4 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-auto overflow-hidden p-0' align='start'>
        <Calendar
          mode='single'
          selected={date}
          onSelect={(selectedDate) => {
            onSelect?.(selectedDate)
            setOpen(false)
          }}
          captionLayout='dropdown'
          disabled={disabled}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Date Picker with Input Field
 * Allows typing and calendar selection
 */
interface DatePickerWithInputProps {
  date?: Date
  onSelect?: (date: Date | undefined) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function DatePickerWithInput({
  date,
  onSelect,
  placeholder = 'Select date',
  className,
  disabled,
}: DatePickerWithInputProps) {
  const [open, setOpen] = React.useState(false)
  const [month, setMonth] = React.useState<Date | undefined>(date)
  const [value, setValue] = React.useState(date ? format(date, 'PPP') : '')

  React.useEffect(() => {
    if (date) {
      setValue(format(date, 'PPP'))
      setMonth(date)
    } else {
      setValue('')
    }
  }, [date])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value)
    const parsedDate = new Date(e.target.value)
    if (!isNaN(parsedDate.getTime())) {
      onSelect?.(parsedDate)
      setMonth(parsedDate)
    }
  }

  return (
    <div className='relative'>
      <input
        type='text'
        value={value}
        onChange={handleInputChange}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'border-input bg-background ring-offset-background file:text-foreground placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          'pr-10',
          className
        )}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant='ghost'
            size='sm'
            disabled={disabled}
            className='absolute top-1/2 right-1 h-8 w-8 -translate-y-1/2 p-0'
          >
            <CalendarIcon className='h-4 w-4' />
            <span className='sr-only'>Select date</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-auto overflow-hidden p-0' align='end'>
          <Calendar
            mode='single'
            selected={date}
            month={month}
            onMonthChange={setMonth}
            onSelect={(selectedDate) => {
              onSelect?.(selectedDate)
              if (selectedDate) {
                setValue(format(selectedDate, 'PPP'))
              }
              setOpen(false)
            }}
            captionLayout='dropdown'
            disabled={disabled}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
