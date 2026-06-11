// Created and developed by Jai Singh
/**
 * Shared NumericKeypad (Phase 5.4).
 *
 * Replaces three duplicated copies in:
 *   - rf-cycle-count-unified.tsx
 *   - rf-step-quantity-entry.tsx
 *   - rf-step-empty-location-verification.tsx
 *
 * Sizing tuned for warehouse gloves: `h-14` buttons, `active:scale-95`
 * tactile feedback, full-width grid.
 */
import { Button } from '@/components/ui/button'

interface Props {
  value: string
  onChange: (next: string) => void
  onSubmit?: () => void
  maxDigits?: number
  allowDecimal?: boolean
  disabled?: boolean
  /** Optional label rendered above the keypad. */
  label?: string
}

const ROWS: Array<Array<string>> = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
]

export function NumericKeypad({
  value,
  onChange,
  onSubmit,
  maxDigits = 8,
  allowDecimal = false,
  disabled,
  label,
}: Props) {
  function press(digit: string) {
    if (disabled) return
    if (digit === '.') {
      if (!allowDecimal || value.includes('.')) return
      onChange(value.length === 0 ? '0.' : `${value}.`)
      return
    }
    if (value.length >= maxDigits) return
    if (value === '0' && digit !== '.') {
      onChange(digit)
      return
    }
    onChange(`${value}${digit}`)
  }

  function backspace() {
    if (disabled) return
    onChange(value.slice(0, -1))
  }

  function clear() {
    if (disabled) return
    onChange('')
  }

  return (
    <div className='space-y-3'>
      {label && (
        <div className='text-muted-foreground text-center text-xs tracking-wide uppercase'>
          {label}
        </div>
      )}
      <div className='grid grid-cols-3 gap-2'>
        {ROWS.flat().map((d) => (
          <Button
            key={d}
            variant='outline'
            className='h-14 text-xl transition-transform active:scale-95'
            onClick={() => press(d)}
            disabled={disabled}
          >
            {d}
          </Button>
        ))}
        <Button
          variant='outline'
          className='h-14 text-xl transition-transform active:scale-95'
          onClick={clear}
          disabled={disabled}
        >
          C
        </Button>
        <Button
          variant='outline'
          className='h-14 text-xl transition-transform active:scale-95'
          onClick={() => press('0')}
          disabled={disabled}
        >
          0
        </Button>
        <Button
          variant='outline'
          className='h-14 text-xl transition-transform active:scale-95'
          onClick={backspace}
          disabled={disabled}
        >
          ←
        </Button>
        {allowDecimal && (
          <Button
            variant='outline'
            className='col-span-3 h-14 text-xl transition-transform active:scale-95'
            onClick={() => press('.')}
            disabled={disabled}
          >
            .
          </Button>
        )}
        {onSubmit && (
          <Button
            className='col-span-3 h-14 text-lg transition-transform active:scale-95'
            onClick={onSubmit}
            disabled={disabled || value.length === 0}
          >
            Confirm
          </Button>
        )}
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
