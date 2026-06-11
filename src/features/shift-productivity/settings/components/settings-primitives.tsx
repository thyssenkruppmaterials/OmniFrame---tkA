// Created and developed by Jai Singh
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import type { SettingsFeatureStatus } from '../settings-feature-matrix'
import { statusCopy } from '../settings-feature-matrix'

const statusVariant: Record<
  SettingsFeatureStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  live: 'default',
  partial: 'secondary',
  setup: 'outline',
  pending: 'destructive',
}

interface SettingsStatusBadgeProps {
  status: SettingsFeatureStatus
  className?: string
}

export function SettingsStatusBadge({
  status,
  className,
}: SettingsStatusBadgeProps) {
  return (
    <Badge
      variant={statusVariant[status]}
      className={cn('shrink-0', className)}
    >
      {statusCopy[status].label}
    </Badge>
  )
}

interface SettingsSummaryCardProps {
  title: string
  value: string | number
  description?: string
  icon: LucideIcon
  toneClassName?: string
  isLoading?: boolean
}

export function SettingsSummaryCard({
  title,
  value,
  description,
  icon: Icon,
  toneClassName,
  isLoading,
}: SettingsSummaryCardProps) {
  return (
    <Card className='overflow-hidden'>
      <CardContent className='p-5'>
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
              {title}
            </p>
            {isLoading ? (
              <Skeleton className='mt-2 h-8 w-16' />
            ) : (
              <p className='mt-1 text-2xl font-bold tracking-tight tabular-nums'>
                {value}
              </p>
            )}
            {description && (
              <p className='text-muted-foreground mt-1 text-xs'>
                {description}
              </p>
            )}
          </div>
          <div
            className={cn(
              'bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl',
              toneClassName
            )}
          >
            <Icon className='size-5' />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface SettingsSectionCardProps {
  title: string
  description?: string
  icon?: LucideIcon
  status?: SettingsFeatureStatus
  children: React.ReactNode
  className?: string
  contentClassName?: string
}

export function SettingsSectionCard({
  title,
  description,
  icon: Icon,
  status,
  children,
  className,
  contentClassName,
}: SettingsSectionCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className='flex items-start justify-between gap-4'>
          <div className='flex min-w-0 items-start gap-3'>
            {Icon && (
              <div className='bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl'>
                <Icon className='size-5' />
              </div>
            )}
            <div className='min-w-0'>
              <CardTitle>{title}</CardTitle>
              {description && <CardDescription>{description}</CardDescription>}
            </div>
          </div>
          {status && <SettingsStatusBadge status={status} />}
        </div>
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  )
}

interface SettingsErrorStateProps {
  title?: string
  description: string
  onRetry?: () => void
  isRetrying?: boolean
}

export function SettingsErrorState({
  title = 'Unable to load settings',
  description,
  onRetry,
  isRetrying,
}: SettingsErrorStateProps) {
  return (
    <Alert variant='destructive'>
      <AlertCircle className='size-4' />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className='mt-2 flex flex-col gap-3'>
        <span>{description}</span>
        {onRetry && (
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='w-fit'
            onClick={onRetry}
            disabled={isRetrying}
          >
            {isRetrying ? (
              <Loader2 className='animate-spin' data-icon='inline-start' />
            ) : (
              <RefreshCw data-icon='inline-start' />
            )}
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}

interface SettingsSaveBarProps {
  isDirty: boolean
  isSaving: boolean
  disabled?: boolean
  submitLabel?: string
  savingLabel?: string
}

export function SettingsSaveBar({
  isDirty,
  isSaving,
  disabled,
  submitLabel = 'Save changes',
  savingLabel = 'Saving...',
}: SettingsSaveBarProps) {
  return (
    <div className='bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 z-10 -mx-1 flex flex-col gap-3 border-t py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between'>
      <div className='text-muted-foreground flex items-center gap-2 text-sm'>
        <CheckCircle2 className={cn('size-4', isDirty && 'text-primary')} />
        {isDirty ? 'Unsaved changes' : 'All changes saved'}
      </div>
      <Button type='submit' disabled={disabled || isSaving || !isDirty}>
        {isSaving && (
          <Loader2 className='animate-spin' data-icon='inline-start' />
        )}
        {isSaving ? savingLabel : submitLabel}
      </Button>
    </div>
  )
}

interface SettingsToggleRowProps {
  title: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  badge?: React.ReactNode
}

export function SettingsToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
  badge,
}: SettingsToggleRowProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between',
        disabled && 'bg-muted/30'
      )}
      data-disabled={disabled || undefined}
    >
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center gap-2'>
          <p className='font-medium'>{title}</p>
          {badge}
        </div>
        <p className='text-muted-foreground text-sm'>{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={title}
      />
    </div>
  )
}

export function SettingsSectionSkeleton() {
  return (
    <div className='flex flex-col gap-4'>
      <Skeleton className='h-24 w-full' />
      <Skeleton className='h-40 w-full' />
      <Skeleton className='h-32 w-full' />
    </div>
  )
}

// Created and developed by Jai Singh
