// Created and developed by Jai Singh
import React from 'react'
import { AlertTriangle, AlertCircle, Info, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type ConfirmDialogVariant = 'warning' | 'danger' | 'info'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  description?: string
  message: string
  variant?: ConfirmDialogVariant
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
  isProcessing?: boolean
  details?: string[]
  badge?: {
    label: string
    value: string | number
  }
}

const variantConfig = {
  warning: {
    icon: AlertTriangle,
    iconColor: 'text-yellow-500',
    bgColor: 'bg-yellow-50 dark:bg-yellow-900/20',
    borderColor: 'border-yellow-200 dark:border-yellow-800',
    textColor: 'text-yellow-900 dark:text-yellow-200',
    buttonColor: 'bg-yellow-600 hover:bg-yellow-700',
  },
  danger: {
    icon: AlertCircle,
    iconColor: 'text-red-500',
    bgColor: 'bg-red-50 dark:bg-red-900/20',
    borderColor: 'border-red-200 dark:border-red-800',
    textColor: 'text-red-900 dark:text-red-200',
    buttonColor: 'bg-red-600 hover:bg-red-700',
  },
  info: {
    icon: Info,
    iconColor: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
    textColor: 'text-blue-900 dark:text-blue-200',
    buttonColor: 'bg-blue-600 hover:bg-blue-700',
  },
}

export const ConfirmDialog = React.memo(
  ({
    isOpen,
    title,
    description,
    message,
    variant = 'warning',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    onConfirm,
    onCancel,
    isProcessing = false,
    details,
    badge,
  }: ConfirmDialogProps) => {
    const config = variantConfig[variant]
    const Icon = config.icon

    return (
      <Dialog
        open={isOpen}
        onOpenChange={(open) => !open && !isProcessing && onCancel()}
      >
        <DialogContent
          className='sm:max-w-[500px]'
          showCloseButton={!isProcessing}
        >
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <Icon className={`h-5 w-5 ${config.iconColor}`} />
              {title}
            </DialogTitle>
            <DialogDescription>{description || message}</DialogDescription>
          </DialogHeader>

          <div className='space-y-4'>
            {/* Main Message */}
            <div
              className={`rounded-lg border p-4 ${config.bgColor} ${config.borderColor}`}
            >
              <div className='space-y-3'>
                {badge && (
                  <div className='flex items-center justify-between'>
                    <span className={`text-sm font-medium ${config.textColor}`}>
                      {badge.label}:
                    </span>
                    <Badge variant='secondary' className='font-mono text-base'>
                      {typeof badge.value === 'number'
                        ? badge.value.toLocaleString()
                        : badge.value}
                    </Badge>
                  </div>
                )}

                <p className={`text-sm ${config.textColor}`}>{message}</p>

                {details && details.length > 0 && (
                  <div className={`text-xs ${config.textColor} mt-2 space-y-1`}>
                    {details.map((detail, index) => (
                      <p key={index}>• {detail}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Warning Message */}
            {variant === 'danger' && (
              <div className='bg-muted flex items-start gap-2 rounded-lg p-3'>
                <AlertTriangle className='mt-0.5 h-4 w-4 flex-shrink-0 text-red-500' />
                <p className='text-muted-foreground text-sm'>
                  This action cannot be undone. Please confirm you want to
                  proceed.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className='gap-2'>
            <Button
              variant='outline'
              onClick={onCancel}
              disabled={isProcessing}
            >
              {cancelText}
            </Button>
            <Button
              onClick={onConfirm}
              disabled={isProcessing}
              className={config.buttonColor}
            >
              {isProcessing ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Processing...
                </>
              ) : (
                confirmText
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }
)

ConfirmDialog.displayName = 'ConfirmDialog'

// Created and developed by Jai Singh
