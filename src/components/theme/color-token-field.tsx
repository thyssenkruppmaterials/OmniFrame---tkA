// Created and developed by Jai Singh
import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  validateHex,
  getPerceivedLightness,
  shouldUseLightText,
} from '@/lib/utils/color-conversion'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface ColorTokenFieldProps {
  label: string
  value: string
  onChange: (hex: string) => void
  description?: string
  contrastAgainst?: string
  className?: string
}

export function ColorTokenField({
  label,
  value,
  onChange,
  description,
  contrastAgainst,
  className,
}: ColorTokenFieldProps) {
  const id = useId()
  const colorInputRef = useRef<HTMLInputElement>(null)
  const [inputValue, setInputValue] = useState(value)
  const [isFocused, setIsFocused] = useState(false)

  const validated = validateHex(value)
  const lastValid = validated ?? '#000000'
  const inputValidated = validateHex(inputValue)
  const displayHex = inputValidated ?? lastValid
  const isValid = !!validateHex(inputValue)
  const showError = !isFocused && inputValue.length > 0 && !isValid

  useEffect(() => {
    if (!isFocused) {
      setInputValue(value)
    }
  }, [value, isFocused])

  const handleSwatchClick = () => {
    colorInputRef.current?.click()
  }

  const handleNativeColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value
    setInputValue(hex)
    onChange(hex)
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value
    if (raw.length > 0 && !raw.startsWith('#')) {
      raw = '#' + raw
    }
    const cleaned =
      raw === '#'
        ? '#'
        : '#' +
          raw
            .slice(1)
            .replace(/[^0-9A-Fa-f]/g, '')
            .slice(0, 6)
    setInputValue(cleaned)

    const normalized = validateHex(cleaned)
    if (normalized) {
      onChange(normalized)
    }
  }

  const handleBlur = () => {
    setIsFocused(false)
    const normalized = validateHex(inputValue)
    if (normalized) {
      setInputValue(normalized)
      onChange(normalized)
    } else if (inputValue === '' || inputValue === '#') {
      setInputValue(value)
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').trim()
    const hex = pasted
      .replace(/^#/, '')
      .replace(/[^0-9A-Fa-f]/g, '')
      .slice(0, 6)
    if (hex.length >= 3) {
      e.preventDefault()
      const full = `#${hex}`
      const normalized = validateHex(full)
      if (normalized) {
        setInputValue(normalized)
        onChange(normalized)
      } else {
        setInputValue(full)
      }
    }
  }

  const contrastBadge = (() => {
    if (!validateHex(displayHex)) return null

    if (contrastAgainst && validateHex(contrastAgainst)) {
      const l1 = getPerceivedLightness(displayHex)
      const l2 = getPerceivedLightness(contrastAgainst)
      const diff = Math.abs(l1 - l2)
      const good = diff > 0.4
      return (
        <Badge
          variant='outline'
          className={cn(
            'h-4 px-1.5 py-0 text-[10px]',
            good
              ? 'border-green-500/50 text-green-600 dark:text-green-400'
              : 'border-amber-500/50 text-amber-600 dark:text-amber-400'
          )}
        >
          {good ? 'Good' : 'Low'}
        </Badge>
      )
    }

    const textType = shouldUseLightText(displayHex)
    return (
      <Badge
        variant='outline'
        className='h-4 px-1.5 py-0 text-[10px]'
        style={{
          backgroundColor: displayHex,
          color: textType === 'light' ? '#fff' : '#000',
          borderColor:
            textType === 'light' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)',
        }}
      >
        {textType === 'light' ? 'Light' : 'Dark'}
      </Badge>
    )
  })()

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className='flex items-center justify-between gap-2'>
        <Label htmlFor={`${id}-hex`} className='text-xs font-medium'>
          {label}
        </Label>
        {contrastBadge}
      </div>
      <div className='flex items-center gap-2'>
        <div className='relative'>
          <button
            type='button'
            onClick={handleSwatchClick}
            className='border-input h-9 w-9 shrink-0 cursor-pointer rounded-md border shadow-xs transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none'
            style={{ backgroundColor: displayHex }}
            aria-label={`Pick color for ${label}`}
          />
          <input
            ref={colorInputRef}
            type='color'
            value={displayHex}
            onChange={handleNativeColorChange}
            className='pointer-events-none absolute inset-0 h-0 w-0 opacity-0'
            tabIndex={-1}
            aria-hidden='true'
          />
        </div>
        <div className='min-w-0 flex-1'>
          <Input
            id={`${id}-hex`}
            type='text'
            value={inputValue}
            onChange={handleTextChange}
            onBlur={handleBlur}
            onFocus={() => setIsFocused(true)}
            onPaste={handlePaste}
            placeholder='#000000'
            autoComplete='off'
            spellCheck={false}
            aria-invalid={showError}
            className={cn(
              'h-9 font-mono text-xs',
              showError &&
                'border-destructive focus-visible:ring-destructive/20'
            )}
          />
        </div>
      </div>
      {showError && (
        <p className='text-destructive text-[11px]' role='alert'>
          Invalid hex color
        </p>
      )}
      {description && !showError && (
        <p className='text-muted-foreground text-[11px]'>{description}</p>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
