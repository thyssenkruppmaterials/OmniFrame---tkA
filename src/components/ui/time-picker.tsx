/**
 * Time Picker Component
 * Shadcn-styled time picker using Select components
 * Created: December 27, 2025
 */
import * as React from 'react'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface TimePickerProps {
  value?: string // HH:mm format
  onChange?: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  minuteStep?: number // 1, 5, 15, 30
}

export function TimePicker({
  value,
  onChange,
  placeholder = 'Select time',
  className,
  disabled,
  minuteStep = 1,
}: TimePickerProps) {
  const [open, setOpen] = React.useState(false)
  const hourRef = React.useRef<HTMLDivElement>(null)
  const minuteRef = React.useRef<HTMLDivElement>(null)

  // Handle mouse wheel scrolling explicitly
  const handleWheel = React.useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const container = e.currentTarget
      container.scrollTop += e.deltaY
      e.stopPropagation()
    },
    []
  )

  // Parse value to get hours and minutes
  const [selectedHour, selectedMinute] = React.useMemo(() => {
    if (!value) return [null, null]
    const [h, m] = value.split(':').map(Number)
    return [h, m]
  }, [value])

  // Generate hours (0-23)
  const hours = Array.from({ length: 24 }, (_, i) => i)

  // Generate minutes based on step
  const minutes = Array.from(
    { length: 60 / minuteStep },
    (_, i) => i * minuteStep
  )

  const formatTime = (hour: number, minute: number) => {
    const h = hour.toString().padStart(2, '0')
    const m = minute.toString().padStart(2, '0')
    return `${h}:${m}`
  }

  const formatDisplayTime = (timeStr: string) => {
    if (!timeStr) return placeholder
    const [h, m] = timeStr.split(':').map(Number)
    const hour = h % 12 || 12
    const ampm = h >= 12 ? 'PM' : 'AM'
    return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`
  }

  const handleHourSelect = (hour: number) => {
    const minute = selectedMinute ?? 0
    const newValue = formatTime(hour, minute)
    onChange?.(newValue)
  }

  const handleMinuteSelect = (minute: number) => {
    const hour = selectedHour ?? 0
    const newValue = formatTime(hour, minute)
    onChange?.(newValue)
    setOpen(false)
  }

  // Scroll to selected values when popover opens
  React.useEffect(() => {
    if (open) {
      setTimeout(() => {
        if (selectedHour !== null && hourRef.current) {
          const selectedButton = hourRef.current.querySelector(
            `[data-hour="${selectedHour}"]`
          )
          selectedButton?.scrollIntoView({
            block: 'center',
            behavior: 'instant',
          })
        }
        if (selectedMinute !== null && minuteRef.current) {
          const selectedButton = minuteRef.current.querySelector(
            `[data-minute="${selectedMinute}"]`
          )
          selectedButton?.scrollIntoView({
            block: 'center',
            behavior: 'instant',
          })
        }
      }, 0)
    }
  }, [open, selectedHour, selectedMinute])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal',
            !value && 'text-muted-foreground',
            className
          )}
        >
          {formatDisplayTime(value || '')}
          <Clock className='ml-2 h-4 w-4 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-auto p-0' align='start'>
        <div className='flex'>
          {/* Hours */}
          <div className='border-r'>
            <div className='text-muted-foreground border-b px-3 py-2 text-sm font-medium'>
              Hour
            </div>
            <div
              ref={hourRef}
              className='h-60 overflow-y-auto overscroll-contain scroll-smooth'
              style={{ scrollbarWidth: 'thin' }}
              onWheel={handleWheel}
            >
              <div className='flex flex-col p-1'>
                {hours.map((hour) => {
                  const displayHour = hour % 12 || 12
                  const ampm = hour >= 12 ? 'PM' : 'AM'
                  return (
                    <Button
                      key={hour}
                      data-hour={hour}
                      variant={selectedHour === hour ? 'default' : 'ghost'}
                      size='sm'
                      className={cn(
                        'justify-start font-normal',
                        selectedHour === hour &&
                          'bg-primary text-primary-foreground'
                      )}
                      onClick={() => handleHourSelect(hour)}
                    >
                      {displayHour} {ampm}
                    </Button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Minutes */}
          <div>
            <div className='text-muted-foreground border-b px-3 py-2 text-sm font-medium'>
              Min
            </div>
            <div
              ref={minuteRef}
              className='h-60 overflow-y-auto overscroll-contain scroll-smooth'
              style={{ scrollbarWidth: 'thin' }}
              onWheel={handleWheel}
            >
              <div className='flex flex-col p-1'>
                {minutes.map((minute) => (
                  <Button
                    key={minute}
                    data-minute={minute}
                    variant={selectedMinute === minute ? 'default' : 'ghost'}
                    size='sm'
                    className={cn(
                      'justify-start font-normal',
                      selectedMinute === minute &&
                        'bg-primary text-primary-foreground'
                    )}
                    onClick={() => handleMinuteSelect(minute)}
                  >
                    :{minute.toString().padStart(2, '0')}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Simple Time Input with better styling
 * Uses native time input but styled to match shadcn
 */
interface TimeInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value?: string
  onValueChange?: (value: string) => void
}

export const TimeInput = React.forwardRef<HTMLInputElement, TimeInputProps>(
  ({ className, value, onChange, onValueChange, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(e)
      onValueChange?.(e.target.value)
    }

    return (
      <div className='relative'>
        <input
          type='time'
          ref={ref}
          value={value}
          onChange={handleChange}
          className={cn(
            'border-input bg-background ring-offset-background flex h-10 w-full rounded-md border px-3 py-2 text-sm',
            'file:text-foreground file:border-0 file:bg-transparent file:text-sm file:font-medium',
            'placeholder:text-muted-foreground',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-50',
            '[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0',
            className
          )}
          {...props}
        />
        <Clock className='text-muted-foreground pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2' />
      </div>
    )
  }
)
TimeInput.displayName = 'TimeInput'

export default TimePicker
