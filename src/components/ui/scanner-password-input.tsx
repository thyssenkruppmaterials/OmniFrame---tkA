import * as React from 'react'
import { IconEye, IconEyeOff } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from './button'

export type ScannerPasswordInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type'
>

/**
 * ScannerPasswordInput Component - Specialized password input for RF interfaces with iOS PWA fixes
 *
 * Extends PasswordInput with iOS PWA keyboard toolbar suppression by:
 * 1. Using inputmode="none" to suppress iOS virtual keyboard and toolbar
 * 2. Applying iOS-specific webkit CSS to prevent keyboard UI elements
 * 3. Setting font-size: 16px to prevent iOS zoom on focus
 * 4. Disabling touch callouts and selection highlighting
 *
 * This component maintains full compatibility with Bluetooth barcode scanner input
 * and password visibility toggle while removing unwanted iOS keyboard navigation toolbar
 */
const ScannerPasswordInput = React.forwardRef<
  HTMLInputElement,
  ScannerPasswordInputProps
>(({ className, disabled, autoComplete = 'off', ...props }, ref) => {
  const [showPassword, setShowPassword] = React.useState(false)

  return (
    <div className={cn('relative rounded-md', className)}>
      <input
        type={showPassword ? 'text' : 'password'}
        autoComplete={autoComplete}
        inputMode='none' // Critical: Tells iOS no virtual keyboard/toolbar needed
        data-slot='scanner-password-input'
        className={cn(
          // Base password input styles (inherited from PasswordInput component)
          'border-input placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-1 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
          // iOS PWA specific fixes for keyboard toolbar suppression
          'scanner-input-ios-fix'
        )}
        style={{
          // Ensure minimum font size to prevent iOS zoom on focus
          fontSize: Math.max(
            16,
            parseInt(getComputedStyle(document.documentElement).fontSize) || 16
          ),
          ...props.style,
        }}
        ref={ref}
        disabled={disabled}
        {...props}
      />
      <Button
        type='button'
        size='icon'
        variant='ghost'
        disabled={disabled}
        className='text-muted-foreground absolute top-1/2 right-1 h-6 w-6 -translate-y-1/2 rounded-md'
        onClick={() => setShowPassword((prev) => !prev)}
      >
        {showPassword ? <IconEye size={18} /> : <IconEyeOff size={18} />}
      </Button>
    </div>
  )
})
ScannerPasswordInput.displayName = 'ScannerPasswordInput'

export { ScannerPasswordInput }
