// Created and developed by Jai Singh
import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Width token for `<ResponsiveDialog>`. Replaces the `min-w-[1200px]`
 * anti-pattern that forced horizontal page scroll under that width.
 *
 *  - sm  → up to 480 px
 *  - md  → up to 640 px (default form dialog)
 *  - lg  → up to 900 px
 *  - xl  → up to 1280 px (formerly `min-w-[1200px]` callsites)
 *  - full → uses the full viewport minus a small inset
 *
 * All sizes resolve to `w-[min(100vw-2rem,Npx)]`, so on a narrow viewport
 * the dialog simply fits the screen instead of clipping or scrolling.
 */
export type ResponsiveDialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

const SIZE_CLASS: Record<ResponsiveDialogSize, string> = {
  sm: 'w-[min(100vw-2rem,480px)]',
  md: 'w-[min(100vw-2rem,640px)]',
  lg: 'w-[min(100vw-2rem,900px)]',
  xl: 'w-[min(100vw-2rem,1280px)]',
  full: 'w-[calc(100vw-2rem)]',
}

interface ResponsiveDialogProps extends React.ComponentProps<typeof Dialog> {
  /** Width token. Defaults to `md`. */
  size?: ResponsiveDialogSize
  /** Class applied to the inner `DialogContent`. */
  contentClassName?: string
  /** Hide the auto-rendered close button (passes through to `DialogContent`). */
  showCloseButton?: boolean
}

interface ResponsiveDialogContentProps extends React.ComponentProps<
  typeof DialogContent
> {
  size?: ResponsiveDialogSize
}

/**
 * Drop-in replacement for `<Dialog>` + `<DialogContent>` for wide dialogs.
 *
 * Composes a flex column with three slots:
 *  - `<ResponsiveDialogHeader>` — fixed
 *  - `<ResponsiveDialogBody>` — the ONLY scrollport (`min-h-0 overflow-y-auto`)
 *  - `<ResponsiveDialogFooter>` — fixed
 *
 * Wide content (tables, forms with many columns) goes in `Body` with its
 * own `overflow-x-auto` if needed. The body owning the scroll prevents the
 * common "header and footer scroll with the content and disappear off
 * screen" bug.
 *
 * Usage:
 * ```tsx
 * <ResponsiveDialog open={open} onOpenChange={setOpen} size="xl">
 *   <ResponsiveDialogHeader>
 *     <ResponsiveDialogTitle>Edit work order</ResponsiveDialogTitle>
 *   </ResponsiveDialogHeader>
 *   <ResponsiveDialogBody>...table...</ResponsiveDialogBody>
 *   <ResponsiveDialogFooter>
 *     <Button>Save</Button>
 *   </ResponsiveDialogFooter>
 * </ResponsiveDialog>
 * ```
 */
function ResponsiveDialog({
  size = 'md',
  contentClassName,
  showCloseButton = true,
  children,
  ...rootProps
}: ResponsiveDialogProps) {
  return (
    <Dialog {...rootProps}>
      <ResponsiveDialogContent
        size={size}
        className={contentClassName}
        showCloseButton={showCloseButton}
      >
        {children}
      </ResponsiveDialogContent>
    </Dialog>
  )
}

/**
 * Standalone `DialogContent` wrapper. Use when you need to keep your own
 * `<Dialog>` root (e.g. controlled by a third-party trigger) but still want
 * the responsive width tokens + scroll body.
 */
function ResponsiveDialogContent({
  size = 'md',
  className,
  children,
  ...props
}: ResponsiveDialogContentProps) {
  return (
    <DialogContent
      data-slot='responsive-dialog-content'
      data-size={size}
      className={cn(
        'flex max-h-[90vh] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-none',
        SIZE_CLASS[size],
        className
      )}
      {...props}
    >
      {children}
    </DialogContent>
  )
}

function ResponsiveDialogHeader({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <DialogHeader
      data-slot='responsive-dialog-header'
      className={cn(
        'flex shrink-0 flex-col gap-1.5 border-b px-6 py-4 text-left',
        className
      )}
      {...props}
    />
  )
}

function ResponsiveDialogBody({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='responsive-dialog-body'
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-6 py-4',
        className
      )}
      {...props}
    />
  )
}

function ResponsiveDialogFooter({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <DialogFooter
      data-slot='responsive-dialog-footer'
      className={cn(
        'flex shrink-0 flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:justify-end',
        className
      )}
      {...props}
    />
  )
}

const ResponsiveDialogTitle = DialogTitle
const ResponsiveDialogDescription = DialogDescription

export {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
}

// Created and developed by Jai Singh
