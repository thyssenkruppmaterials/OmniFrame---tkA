// Created and developed by Jai Singh
import { RefreshCw, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Minimal single-line strip rendered at the very top of the SAP Testing
 * tab content (Inventory Management + Agent Triggers) when the on-prem
 * agent isn't reachable. Replaces the previous bulky amber card so the
 * tab header area stays uncluttered. The banner unmounts entirely once
 * the agent is detected — no persistent placeholder.
 */
interface AgentNotDetectedBannerProps {
  onRetry: () => void
  /**
   * Optional override for the inline copy. Both tabs use the same
   * default — the message references "queries" generically because the
   * Agent Triggers tab still allows configuration without an agent
   * (rules can be drafted and saved); only firing requires a live
   * agent.
   */
  message?: string
  className?: string
}

export function AgentNotDetectedBanner({
  onRetry,
  message = 'Agent not detected — start it from the One Click Ship tab to run queries.',
  className,
}: AgentNotDetectedBannerProps) {
  return (
    <div
      role='status'
      aria-live='polite'
      className={cn(
        'flex h-8 items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 text-xs text-amber-700 dark:text-amber-300',
        className
      )}
    >
      <div className='flex min-w-0 items-center gap-2'>
        <ShieldAlert className='h-3.5 w-3.5 shrink-0' />
        <span className='truncate'>{message}</span>
      </div>
      <button
        type='button'
        onClick={onRetry}
        className='inline-flex shrink-0 items-center gap-1 rounded font-medium underline-offset-2 hover:underline focus-visible:ring-1 focus-visible:ring-amber-500 focus-visible:outline-none'
      >
        <RefreshCw className='h-3 w-3' />
        Retry
      </button>
    </div>
  )
}

// Created and developed by Jai Singh
