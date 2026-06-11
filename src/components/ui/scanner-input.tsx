// Created and developed by Jai Singh
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface ScannerInputProps extends React.ComponentProps<'input'> {
  className?: string
  type?: string
  autoComplete?: string
}

/**
 * ScannerInput Component - Specialized input for RF interfaces with Bluetooth barcode scanners
 *
 * Fixes iOS PWA keyboard toolbar issue by:
 * 1. Using inputmode="none" to suppress iOS virtual keyboard and toolbar
 * 2. Applying iOS-specific webkit CSS to prevent keyboard UI elements
 * 3. Setting font-size: 16px to prevent iOS zoom on focus
 * 4. Disabling touch callouts and selection highlighting
 *
 * This component maintains full compatibility with Bluetooth barcode scanner input
 * while removing the unwanted iOS keyboard navigation toolbar (Previous/Next/Done buttons)
 */
function ScannerInput({
  className,
  type = 'text',
  autoComplete = 'off',
  ...props
}: ScannerInputProps) {
  return (
    <input
      type={type}
      autoComplete={autoComplete}
      inputMode='none' // Critical: Tells iOS no virtual keyboard/toolbar needed
      data-slot='scanner-input'
      className={cn(
        // Base input styles (inherited from Input component)
        'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        // iOS PWA specific fixes for keyboard toolbar suppression
        'scanner-input-ios-fix',
        className
      )}
      style={{
        // Ensure minimum font size to prevent iOS zoom on focus
        fontSize: Math.max(
          16,
          parseInt(getComputedStyle(document.documentElement).fontSize) || 16
        ),
        ...props.style,
      }}
      {...props}
    />
  )
}

export { ScannerInput }

// Created and developed by Jai Singh
