// Created and developed by Jai Singh
/**
 * EntityFocusPill — Tier 2 #1 (2026-05-06).
 *
 * Avatar-stack soft-locking indicator: "Sarah is editing this row"
 * + a `+N` chip for the long tail. Built on top of the existing
 * `PresenceAvatar` primitive so the visual language matches the
 * rest of the presence UI.
 *
 * Usage:
 *
 *   const { focusedUsers } = useEntityFocus({
 *     entityKind: 'ticket',
 *     entityId: selectedTicketId,
 *   })
 *   <EntityFocusPill users={focusedUsers} />
 *
 * The pill collapses to nothing when `users` is empty so it can be
 * inlined alongside other row affordances without conditional
 * rendering at the call site.
 */
import { Users } from 'lucide-react'
import type { PresenceUser } from '@/lib/presence/types'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { PresenceAvatar } from './presence-avatar'

const VISIBLE_LIMIT = 3

interface EntityFocusPillProps {
  /** Users currently focused on the entity (excluding the calling user). */
  users: PresenceUser[]
  /** Optional className passthrough so callers can tweak alignment. */
  className?: string
  /** Compact variant — single avatar + counter, no labels. */
  compact?: boolean
}

export function EntityFocusPill({
  users,
  className,
  compact,
}: EntityFocusPillProps) {
  if (users.length === 0) return null

  const visible = users.slice(0, VISIBLE_LIMIT)
  const overflow = Math.max(0, users.length - VISIBLE_LIMIT)
  const namesLabel =
    users.length === 1
      ? `${users[0].display_name} is editing`
      : users.length === 2
        ? `${users[0].display_name} and ${users[1].display_name} are editing`
        : `${users[0].display_name} and ${users.length - 1} others are editing`

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-testid='entity-focus-pill'
            className={cn(
              'border-blue-500/30 bg-blue-500/8 text-blue-700',
              'dark:border-blue-400/30 dark:bg-blue-500/12 dark:text-blue-300',
              'inline-flex items-center gap-1.5 rounded-full border px-1.5 py-0.5',
              'text-[10px] font-medium tracking-tight',
              'transition-colors duration-150',
              className
            )}
            role='status'
            aria-live='polite'
            aria-label={namesLabel}
          >
            {!compact && (
              <Users
                className='size-3 shrink-0 opacity-80'
                aria-hidden='true'
              />
            )}
            <div className='flex -space-x-1.5'>
              {visible.map((user) => (
                <PresenceAvatar
                  key={user.user_id}
                  src={user.avatar_url}
                  fallback={user.initials}
                  alt={user.display_name}
                  status={user.status}
                  size='sm'
                  showStatus={false}
                  className='ring-background ring-1'
                />
              ))}
            </div>
            {overflow > 0 && (
              <span
                className={cn(
                  'tabular-nums opacity-90',
                  compact ? 'pl-0.5' : ''
                )}
              >
                +{overflow}
              </span>
            )}
            {!compact && users.length === 1 && (
              <span className='max-w-[120px] truncate pr-0.5 leading-tight'>
                {users[0].display_name.split(' ')[0]} editing
              </span>
            )}
            {!compact && users.length > 1 && (
              <span className='pr-0.5 leading-tight'>
                {users.length} editing
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent
          side='top'
          align='start'
          className='bg-popover text-popover-foreground border px-3 py-2 shadow-md'
        >
          <div className='space-y-1.5'>
            <p className='text-xs font-semibold'>Currently editing</p>
            <ul className='space-y-1'>
              {users.map((user) => (
                <li
                  key={user.user_id}
                  className='flex items-center gap-2 text-[11px]'
                >
                  <PresenceAvatar
                    src={user.avatar_url}
                    fallback={user.initials}
                    alt={user.display_name}
                    status={user.status}
                    size='sm'
                  />
                  <div className='min-w-0 flex-1'>
                    <p className='truncate font-medium'>{user.display_name}</p>
                    {user.role_name && (
                      <p className='text-popover-foreground/60 truncate'>
                        {user.role_name}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// Created and developed by Jai Singh
