// Created and developed by Jai Singh
import { type ReactNode } from 'react'
import { type ToastPrioritySettings } from '@/lib/services/settings-service'
import { cn } from '@/lib/utils'

interface CustomToastProps {
  children: ReactNode
  type: 'info' | 'success' | 'warning' | 'error'
  settings: ToastPrioritySettings
  icon?: ReactNode
}

export function CustomToast({
  children,
  type,
  settings,
  icon,
}: CustomToastProps) {
  // Base Alert-style classes matching shadcn Alert component
  const baseClasses =
    'relative w-full rounded-lg border text-sm grid gap-y-0.5 items-start'

  // Dynamic grid layout based on icon presence (matching Alert's grid structure)
  const gridClasses =
    settings.showIcon && icon
      ? 'grid-cols-[calc(var(--spacing)*4)_1fr] gap-x-3'
      : 'grid-cols-[0_1fr]'

  // Apply custom styles via inline style for user-configured properties
  const customStyle: React.CSSProperties = {
    backgroundColor: settings.backgroundColor,
    color: settings.textColor,
    borderColor: settings.borderColor,
    borderWidth: `${settings.borderWidth}px`,
    borderRadius: `${settings.borderRadius}px`,
    fontSize: `${settings.fontSize}px`,
    fontWeight: settings.fontWeight,
    fontFamily: settings.fontFamily,
    textAlign: settings.textAlign as React.CSSProperties['textAlign'],
    boxShadow: settings.shadow,
    opacity: settings.opacity,
    filter: settings.blur > 0 ? `blur(${settings.blur}px)` : 'none',
    minWidth: '300px',
    maxWidth: '500px',
    padding: '12px 16px', // Alert uses px-4 py-3
    transition: 'all 0.2s ease-in-out',
  }

  const iconStyle: React.CSSProperties = {
    color: settings.iconColor,
    width: `${settings.iconSize}px`,
    height: `${settings.iconSize}px`,
    // Icon positioning matching Alert component
    gridColumn: '1',
    gridRow: '1',
    alignSelf: 'start',
    marginTop: '2px', // Alert uses translate-y-0.5
  }

  const contentStyle: React.CSSProperties = {
    gridColumn: '2',
    gridRow: '1',
    lineHeight: '1.5',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  }

  return (
    <div
      role='alert'
      data-slot='alert'
      data-toast-type={type}
      className={cn(baseClasses, gridClasses, 'custom-toast')}
      style={customStyle}
    >
      {settings.showIcon && icon && (
        <div style={iconStyle} className='custom-toast-icon'>
          {icon}
        </div>
      )}
      <div
        style={contentStyle}
        data-slot='alert-description'
        className='custom-toast-content'
      >
        {children}
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
