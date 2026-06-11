// Created and developed by Jai Singh
import { useState, useCallback } from 'react'
import { IconBackspace, IconArrowRight } from '@tabler/icons-react'

interface BadgeInputProps {
  onSubmit: (badgeNumber: string) => void
  isLoading: boolean
  error: string | null
}

export default function BadgeInput({
  onSubmit,
  isLoading,
  error,
}: BadgeInputProps) {
  const [value, setValue] = useState('')

  const handleKeyPress = useCallback(
    (digit: string) => {
      if (value.length < 20) {
        setValue((prev) => prev + digit)
      }
    },
    [value.length]
  )

  const handleBackspace = useCallback(() => {
    setValue((prev) => prev.slice(0, -1))
  }, [])

  const handleClear = useCallback(() => {
    setValue('')
  }, [])

  const handleSubmit = useCallback(() => {
    if (value.trim().length > 0 && !isLoading) {
      onSubmit(value.trim())
    }
  }, [value, isLoading, onSubmit])

  return (
    <div className='flex w-full max-w-sm flex-col items-center gap-5'>
      {/* Badge Number Display - div prevents native keyboard; use on-screen keypad below */}
      <div className='w-full'>
        <label className='text-muted-foreground mb-2 block text-center text-xs font-medium tracking-wider uppercase'>
          Badge Number
        </label>
        <div
          className='bg-card border-border text-foreground w-full rounded-xl border px-4 py-4 text-center font-mono text-2xl tracking-widest'
          aria-live='polite'
        >
          {value || (
            <span className='text-muted-foreground/40'>
              Scan or enter badge...
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className='text-destructive bg-destructive/10 border-destructive/20 w-full rounded-lg border px-4 py-2.5 text-center text-sm'>
          {error}
        </div>
      )}

      {/* Numeric Keypad */}
      <div className='grid w-full max-w-[280px] grid-cols-3 gap-2'>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button
            key={digit}
            onClick={() => handleKeyPress(digit)}
            disabled={isLoading}
            className='bg-card hover:bg-accent active:bg-accent/80 text-foreground border-border h-14 rounded-xl border text-xl font-semibold transition active:scale-[0.96] disabled:opacity-50'
          >
            {digit}
          </button>
        ))}
        <button
          onClick={handleClear}
          disabled={isLoading}
          className='bg-destructive/10 hover:bg-destructive/15 active:bg-destructive/20 text-destructive border-destructive/20 h-14 rounded-xl border text-xs font-semibold tracking-wider uppercase transition disabled:opacity-50'
        >
          Clear
        </button>
        <button
          onClick={() => handleKeyPress('0')}
          disabled={isLoading}
          className='bg-card hover:bg-accent active:bg-accent/80 text-foreground border-border h-14 rounded-xl border text-xl font-semibold transition active:scale-[0.96] disabled:opacity-50'
        >
          0
        </button>
        <button
          onClick={handleBackspace}
          disabled={isLoading}
          className='flex h-14 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-600 transition hover:bg-amber-500/15 active:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400'
        >
          <IconBackspace className='h-5 w-5' />
        </button>
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={!value.trim() || isLoading}
        className='bg-primary hover:bg-primary/90 text-primary-foreground flex w-full max-w-[280px] items-center justify-center gap-2 rounded-xl py-4 text-base font-semibold shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40'
      >
        {isLoading ? (
          <div className='border-primary-foreground/30 border-t-primary-foreground h-5 w-5 animate-spin rounded-full border-2' />
        ) : (
          <>
            Submit
            <IconArrowRight className='h-5 w-5' />
          </>
        )}
      </button>
    </div>
  )
}

// Created and developed by Jai Singh
