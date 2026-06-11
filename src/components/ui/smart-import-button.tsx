// Created and developed by Jai Singh
/**
 * SmartImportButton — split button that auto-promotes the best import
 * option based on environment context.
 *
 * Renders as: [primary action] [▼ caret menu of every other option].
 *
 * The default (primary) action is picked from the supplied `options`:
 *   1. The first non-hidden option marked `preferred: true`, OR
 *   2. The option whose id matches `defaultId`, OR
 *   3. The first non-hidden option.
 *
 * "Hidden" options are excluded from both the menu AND default selection
 * so callers can pass an `agent` option that simply disappears when the
 * on-prem agent isn't running on `localhost:8765`.
 *
 * Visual transitions when the preferred default changes (e.g. agent
 * comes online while the user is looking at the page) are intentionally
 * subtle — a fade + tiny scale on the primary button so the change
 * registers without yanking focus.
 *
 * Mobile: collapses to icon-only at <sm widths with the label moved to
 * `sr-only` so screen readers still announce it.
 */
import * as React from 'react'
import { ChevronDown, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export interface SmartImportOption {
  /** Stable id (e.g. 'csv', 'agent', 'url'). Used for keying + defaultId. */
  id: string
  /** Primary visible label. */
  label: string
  /** Lucide icon (or any ReactNode). */
  icon: React.ReactNode
  /** Long-form copy shown in the dropdown row + as the primary tooltip. */
  description?: string
  /**
   * Hidden options are excluded from the menu AND can't become the
   * default. Use this for environment-conditional options (e.g. the
   * 'agent' option when no agent is detected).
   */
  hidden?: boolean
  /** When multiple options are visible, the first preferred wins as the default. */
  preferred?: boolean
  /** Click handler for the option. */
  onSelect: () => void
  /** Optional small subtitle next to the label (e.g. "PRD-WH5 · v1.6.0"). */
  subLabel?: string
  /** Optional disabled state for the option. */
  disabled?: boolean
}

export interface SmartImportButtonProps {
  options: SmartImportOption[]
  /** Override of the auto-picked preferred default. */
  defaultId?: string
  className?: string
  /**
   * When `agent` is the preferred default we prepend a Zap icon and
   * show a small green dot. Set this to opt-out (e.g. when the consumer
   * wants a flat visual style). Defaults to true.
   */
  enableAgentBoost?: boolean
}

function pickDefault(
  options: SmartImportOption[],
  defaultId?: string
): SmartImportOption | undefined {
  const visible = options.filter((o) => !o.hidden)
  if (visible.length === 0) return undefined
  const preferred = visible.find((o) => o.preferred)
  if (preferred) return preferred
  if (defaultId) {
    const match = visible.find((o) => o.id === defaultId)
    if (match) return match
  }
  return visible[0]
}

export function SmartImportButton({
  options,
  defaultId,
  className,
  enableAgentBoost = true,
}: SmartImportButtonProps) {
  const visible = React.useMemo(
    () => options.filter((o) => !o.hidden),
    [options]
  )
  const primary = React.useMemo(
    () => pickDefault(options, defaultId),
    [options, defaultId]
  )

  // Subtle fade+scale when the preferred default changes (e.g. agent comes online).
  const primaryKey = primary?.id ?? 'none'
  const [transitionKey, setTransitionKey] = React.useState(primaryKey)
  React.useEffect(() => {
    if (transitionKey !== primaryKey) {
      // Trigger an animation tick by switching the keyed wrapper.
      setTransitionKey(primaryKey)
    }
  }, [primaryKey, transitionKey])

  if (!primary) {
    // No options — render a disabled stub so the layout doesn't collapse.
    return (
      <Button
        variant='outline'
        size='sm'
        disabled
        className={cn('border-border', className)}
      >
        Import
      </Button>
    )
  }

  const isAgentDefault = enableAgentBoost && primary.id === 'agent'
  const showCaret = visible.length > 1
  const tooltipText = primary.description ?? primary.label

  const primaryButton = (
    <Button
      variant='outline'
      size='sm'
      onClick={primary.onSelect}
      disabled={primary.disabled}
      className={cn(
        'border-border hover:bg-accent transition-all duration-200',
        showCaret && 'rounded-r-none border-r-0',
        isAgentDefault &&
          'border-emerald-500/40 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-950/60'
      )}
    >
      <span
        key={transitionKey}
        className={cn(
          'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 flex items-center gap-2'
        )}
      >
        {isAgentDefault ? (
          <span className='relative flex items-center'>
            <Zap className='h-4 w-4' />
            <span className='ring-background absolute -top-0.5 -right-1 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2' />
          </span>
        ) : (
          <span aria-hidden>{primary.icon}</span>
        )}
        <span className='hidden sm:inline'>{primary.label}</span>
        <span className='sr-only sm:hidden'>{primary.label}</span>
        {primary.subLabel && (
          <span className='text-muted-foreground/80 hidden text-[11px] font-normal sm:inline'>
            · {primary.subLabel}
          </span>
        )}
      </span>
    </Button>
  )

  return (
    <div
      className={cn('inline-flex', className)}
      data-slot='smart-import-button'
    >
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>{primaryButton}</TooltipTrigger>
          <TooltipContent side='bottom'>{tooltipText}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {showCaret && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='outline'
              size='sm'
              aria-label='More import options'
              className={cn(
                'border-border hover:bg-accent rounded-l-none px-2',
                isAgentDefault &&
                  'border-emerald-500/40 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-950/60'
              )}
            >
              <ChevronDown className='h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align='end'
            className='bg-background border-border w-72'
          >
            {visible.map((opt) => (
              <DropdownMenuItem
                key={opt.id}
                onSelect={(e) => {
                  // Radix calls onSelect on space/enter — keep the menu
                  // closing behaviour but defer the click so the dropdown
                  // animation doesn't compete with a dialog opening.
                  e.preventDefault()
                  if (!opt.disabled) opt.onSelect()
                }}
                disabled={opt.disabled}
                className={cn(
                  'flex items-start gap-3 py-2.5',
                  opt.id === primary.id && 'bg-accent/40'
                )}
              >
                <span className='text-muted-foreground mt-0.5' aria-hidden>
                  {opt.icon}
                </span>
                <span className='flex flex-col gap-0.5'>
                  <span className='flex items-center gap-2 text-sm font-medium'>
                    {opt.label}
                    {opt.subLabel && (
                      <span className='text-muted-foreground text-[11px] font-normal'>
                        · {opt.subLabel}
                      </span>
                    )}
                    {opt.id === primary.id && (
                      <span className='text-[10px] font-semibold tracking-wide text-emerald-600 uppercase dark:text-emerald-400'>
                        Default
                      </span>
                    )}
                  </span>
                  {opt.description && (
                    <span className='text-muted-foreground text-xs'>
                      {opt.description}
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
