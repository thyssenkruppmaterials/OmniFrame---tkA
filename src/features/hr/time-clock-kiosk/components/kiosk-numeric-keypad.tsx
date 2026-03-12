/**
 * Numeric keypad for kiosk touch input.
 * Use with a display div (not an input) to prevent native keyboard from opening.
 */
import { IconBackspace } from '@tabler/icons-react'

interface KioskNumericKeypadProps {
  value: string
  onChange: (value: string) => void
  allowDecimal?: boolean
  maxLength?: number
  disabled?: boolean
  className?: string
}

export function KioskNumericKeypad({
  value,
  onChange,
  allowDecimal = false,
  maxLength = 20,
  disabled = false,
  className = '',
}: KioskNumericKeypadProps) {
  const handleKeyPress = (key: string) => {
    if (value.length >= maxLength) return
    if (key === '.' && (allowDecimal === false || value.includes('.'))) return
    if (key === '.' && value === '') {
      onChange('0.')
      return
    }
    onChange(value + key)
  }

  const handleBackspace = () => {
    onChange(value.slice(0, -1))
  }

  const handleClear = () => {
    onChange('')
  }

  return (
    <div className={`grid w-full max-w-[280px] grid-cols-3 gap-2 ${className}`}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
        <button
          key={digit}
          type='button'
          onClick={() => handleKeyPress(digit)}
          disabled={disabled}
          className='bg-card hover:bg-accent active:bg-accent/80 text-foreground border-border h-14 rounded-xl border text-xl font-semibold transition active:scale-[0.96] disabled:opacity-50'
        >
          {digit}
        </button>
      ))}
      <button
        type='button'
        onClick={handleClear}
        disabled={disabled}
        className='bg-destructive/10 hover:bg-destructive/15 active:bg-destructive/20 text-destructive border-destructive/20 h-14 rounded-xl border text-xs font-semibold tracking-wider uppercase transition disabled:opacity-50'
      >
        Clear
      </button>
      <button
        type='button'
        onClick={() => handleKeyPress('0')}
        disabled={disabled}
        className='bg-card hover:bg-accent active:bg-accent/80 text-foreground border-border h-14 rounded-xl border text-xl font-semibold transition active:scale-[0.96] disabled:opacity-50'
      >
        0
      </button>
      {allowDecimal ? (
        <>
          <button
            type='button'
            onClick={() => handleKeyPress('.')}
            disabled={disabled || value.includes('.')}
            className='bg-card hover:bg-accent active:bg-accent/80 text-foreground border-border h-14 rounded-xl border text-xl font-semibold transition active:scale-[0.96] disabled:opacity-50'
          >
            .
          </button>
          <button
            type='button'
            onClick={handleBackspace}
            disabled={disabled}
            className='flex h-14 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-600 transition hover:bg-amber-500/15 active:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400'
          >
            <IconBackspace className='h-5 w-5' />
          </button>
        </>
      ) : (
        <button
          type='button'
          onClick={handleBackspace}
          disabled={disabled}
          className='flex h-14 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-600 transition hover:bg-amber-500/15 active:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400'
        >
          <IconBackspace className='h-5 w-5' />
        </button>
      )}
    </div>
  )
}
