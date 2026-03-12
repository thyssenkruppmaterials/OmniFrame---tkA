/**
 * Field Component
 * Accessible form field components following shadcn/ui Field pattern
 * Based on: https://ui.shadcn.com/docs/components/field
 * Created: December 11, 2025
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'

interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'vertical' | 'horizontal' | 'responsive'
}

function Field({ className, orientation = 'vertical', ...props }: FieldProps) {
  return (
    <div
      data-slot='field'
      data-orientation={orientation}
      className={cn(
        'grid gap-2',
        orientation === 'horizontal' && 'grid-cols-[1fr_auto] items-center',
        orientation === 'responsive' &&
          'grid-cols-1 @md:grid-cols-[1fr_auto] @md:items-center',
        'group-data-[disabled=true]:opacity-50',
        className
      )}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot='field-label'
      className={cn('group-data-[invalid=true]:text-destructive', className)}
      {...props}
    />
  )
}

function FieldDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot='field-description'
      className={cn('text-muted-foreground text-sm text-balance', className)}
      {...props}
    />
  )
}

function FieldError({
  className,
  errors,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & {
  errors?: Array<{ message?: string } | undefined> | string[]
}) {
  const errorMessages = errors
    ?.map((e) => (typeof e === 'string' ? e : e?.message))
    .filter(Boolean)

  const content = errorMessages?.length
    ? errorMessages.length === 1
      ? errorMessages[0]
      : errorMessages.map((msg, i) => <li key={i}>{msg}</li>)
    : children

  if (!content) return null

  return (
    <p
      data-slot='field-error'
      role='alert'
      className={cn('text-destructive text-sm', className)}
      {...props}
    >
      {Array.isArray(content) ? (
        <ul className='list-disc pl-4'>{content}</ul>
      ) : (
        content
      )}
    </p>
  )
}

function FieldGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot='field-group'
      className={cn('flex flex-col gap-4', className)}
      {...props}
    />
  )
}

function FieldSet({
  className,
  ...props
}: React.FieldsetHTMLAttributes<HTMLFieldSetElement>) {
  return (
    <fieldset
      data-slot='field-set'
      className={cn('space-y-4', className)}
      {...props}
    />
  )
}

function FieldLegend({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLLegendElement> & {
  variant?: 'default' | 'label'
}) {
  return (
    <legend
      data-slot='field-legend'
      className={cn(
        'text-foreground font-medium',
        variant === 'label' ? 'text-sm' : 'text-base',
        className
      )}
      {...props}
    />
  )
}

function FieldContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot='field-content'
      className={cn('flex flex-col gap-1', className)}
      {...props}
    />
  )
}

function FieldTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot='field-title'
      className={cn('text-foreground text-sm font-medium', className)}
      {...props}
    />
  )
}

function FieldSeparator({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  if (children) {
    return (
      <div
        data-slot='field-separator'
        className={cn('relative my-4', className)}
        {...props}
      >
        <div className='absolute inset-0 flex items-center'>
          <span className='w-full border-t' />
        </div>
        <div className='relative flex justify-center text-xs uppercase'>
          <span className='bg-background text-muted-foreground px-2'>
            {children}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      data-slot='field-separator'
      className={cn('my-4 border-t', className)}
      {...props}
    />
  )
}

export {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
}
