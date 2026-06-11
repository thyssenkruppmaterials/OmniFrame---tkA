// Created and developed by Jai Singh
'use client'

import * as React from 'react'
import { Check, Palette, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export interface ColorPreset {
  value: string
  label?: string
}

interface ColorPickerInputProps {
  value?: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  presetColors?: readonly ColorPreset[]
  allowClear?: boolean
  className?: string
}

const HEX_COLOR_REGEX = /^#[0-9A-F]{6}$/i

function normalizeHexInput(raw: string) {
  if (!raw.trim()) return ''

  let next = raw.trim()
  if (next.startsWith('#')) {
    next = next.slice(1)
  }

  next = next
    .replace(/[^0-9a-f]/gi, '')
    .slice(0, 6)
    .toUpperCase()
  return next ? `#${next}` : ''
}

function getPreviewColor(value: string | undefined, placeholder: string) {
  if (value && HEX_COLOR_REGEX.test(value)) {
    return value
  }
  return placeholder
}

export function ColorPickerInput({
  value = '',
  onChange,
  disabled,
  placeholder = '#22c55e',
  presetColors = [],
  allowClear = true,
  className,
}: ColorPickerInputProps) {
  const [open, setOpen] = React.useState(false)
  const normalizedValue = normalizeHexInput(value)
  const previewColor = getPreviewColor(normalizedValue, placeholder)
  const showValidationHint =
    normalizedValue.length > 0 && !HEX_COLOR_REGEX.test(normalizedValue)

  return (
    <div className={cn('space-y-2', className)}>
      <div className='flex items-center gap-2'>
        <Input
          value={normalizedValue}
          onChange={(e) => onChange(normalizeHexInput(e.target.value))}
          placeholder={placeholder}
          disabled={disabled}
          className='flex-1 font-mono'
        />

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type='button'
              disabled={disabled}
              className='hover:ring-primary relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded border transition-all hover:ring-2 hover:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
              style={{ backgroundColor: previewColor }}
              title='Pick custom color'
            >
              <div className='absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/10'>
                <Palette className='h-4 w-4 text-white drop-shadow-md' />
              </div>
            </button>
          </PopoverTrigger>
          <PopoverContent className='w-72 p-3' align='end'>
            <div className='space-y-3'>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>Custom Color</span>
                <code className='bg-muted rounded px-2 py-1 font-mono text-xs'>
                  {HEX_COLOR_REGEX.test(normalizedValue)
                    ? normalizedValue.toUpperCase()
                    : placeholder.toUpperCase()}
                </code>
              </div>

              <input
                type='color'
                value={previewColor}
                onChange={(e) => onChange(e.target.value.toUpperCase())}
                disabled={disabled}
                className='h-10 w-full cursor-pointer rounded border-0 bg-transparent p-0'
                style={{ padding: 0 }}
              />

              {presetColors.length > 0 && (
                <div className='space-y-2'>
                  <span className='text-muted-foreground block text-xs'>
                    Preset Colors
                  </span>
                  <div className='grid grid-cols-5 gap-2'>
                    {presetColors.map((preset) => {
                      const isSelected =
                        normalizedValue.toUpperCase() ===
                        preset.value.toUpperCase()
                      return (
                        <button
                          key={preset.value}
                          type='button'
                          className={cn(
                            'relative h-8 w-full rounded border transition-transform hover:scale-105',
                            isSelected
                              ? 'ring-primary ring-2 ring-offset-1'
                              : 'border-border'
                          )}
                          style={{ backgroundColor: preset.value }}
                          onClick={() => onChange(preset.value.toUpperCase())}
                          title={preset.label ?? preset.value}
                        >
                          {isSelected && (
                            <Check className='absolute inset-0 m-auto h-4 w-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]' />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {allowClear && (
                <div className='flex justify-end border-t pt-2'>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={disabled || !normalizedValue}
                    onClick={() => {
                      onChange('')
                      setOpen(false)
                    }}
                  >
                    <X className='mr-1 h-3 w-3' />
                    Clear
                  </Button>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {showValidationHint && (
        <p className='text-muted-foreground text-xs'>
          Enter a full 6-digit hex value like `#22C55E`, or use the color square
          and slider.
        </p>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
