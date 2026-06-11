// Created and developed by Jai Singh
/**
 * NotificationsPanel — Tier 2 #2 (2026-05-06).
 *
 * Bell-icon popover for server-pushed notifications. Sits in the
 * authenticated layout's top-right action area so it's available
 * across every authenticated route.
 *
 * Powered by `useNotifications`, which bootstraps from
 * `GET /api/v1/notifications` and subscribes to
 * `WsEvent::Notification` filtered by `event.user_id === currentUserId`.
 *
 * UX:
 *   - Bell icon + unread badge (clamped at "99+").
 *   - Popover lists the latest 50 notifications (newest first).
 *   - Each row: severity icon + title + body + relative time.
 *   - Click-to-mark-read on a row + "Mark all read" button at top.
 *   - Click-to-navigate when `link` is set; closes the popover and
 *     uses TanStack Router's imperative `navigate`.
 */
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Info,
  Loader2,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NotificationRow } from '@/lib/work-service/notifications.client'
import { useNotifications } from '@/hooks/use-notifications'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

const SEVERITY_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  info: Info,
  warning: AlertCircle,
  error: XCircle,
  success: CheckCircle2,
}

const SEVERITY_COLOURS: Record<string, string> = {
  info: 'text-blue-500 dark:text-blue-400',
  warning: 'text-amber-500 dark:text-amber-400',
  error: 'text-red-500 dark:text-red-400',
  success: 'text-emerald-500 dark:text-emerald-400',
}

function formatBadge(n: number): string {
  if (n <= 0) return ''
  if (n > 99) return '99+'
  return String(n)
}

interface NotificationRowItemProps {
  notification: NotificationRow
  onClick: () => void
}

function NotificationRowItem({
  notification,
  onClick,
}: NotificationRowItemProps) {
  const severity = notification.severity ?? 'info'
  const Icon = SEVERITY_ICONS[severity] ?? Info
  const iconColour = SEVERITY_COLOURS[severity] ?? SEVERITY_COLOURS.info
  const timeLabel = notification.created_at
    ? formatDistanceToNow(new Date(notification.created_at), {
        addSuffix: true,
      })
    : ''

  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'group flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors',
        'hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none',
        !notification.read && 'bg-blue-500/5 dark:bg-blue-500/10'
      )}
      aria-label={`${notification.title}${notification.read ? ' (read)' : ' (unread)'}`}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', iconColour)} aria-hidden />
      <div className='min-w-0 flex-1 space-y-0.5'>
        <div className='flex items-start gap-1.5'>
          <p
            className={cn(
              'flex-1 truncate text-xs leading-snug',
              notification.read ? 'font-normal' : 'font-semibold'
            )}
          >
            {notification.title}
          </p>
          {!notification.read && (
            <span
              aria-hidden
              className='mt-1 size-1.5 shrink-0 rounded-full bg-blue-500'
            />
          )}
        </div>
        {notification.body && (
          <p className='text-muted-foreground line-clamp-2 text-[11px] leading-snug'>
            {notification.body}
          </p>
        )}
        <p className='text-muted-foreground text-[10px] tabular-nums'>
          {timeLabel}
        </p>
      </div>
    </button>
  )
}

export function NotificationsPanel() {
  const { notifications, unreadCount, isLoading, markRead, markAllRead } =
    useNotifications()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  const handleClickRow = (n: NotificationRow) => {
    if (!n.read) markRead(n.id)
    if (n.link) {
      setOpen(false)
      try {
        // Imperative navigate — TanStack Router accepts a path
        // string. We don't validate it; deep-link safety is the
        // notification producer's responsibility.
        void navigate({ to: n.link })
      } catch {
        /* best-effort — don't tear down the popover on a bad link */
      }
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          data-testid='notifications-bell'
          aria-label={
            unreadCount > 0
              ? `Notifications (${unreadCount} unread)`
              : 'Notifications'
          }
          className='relative h-8 w-8 shrink-0'
        >
          <Bell className='size-4' />
          {unreadCount > 0 && (
            <span
              aria-hidden
              className={cn(
                'absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center',
                'rounded-full bg-red-500 px-1 text-[9px] font-bold text-white',
                'ring-background leading-none tabular-nums ring-2'
              )}
            >
              {formatBadge(unreadCount)}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align='end'
        className='w-[360px] p-0'
        data-testid='notifications-panel'
      >
        <div className='flex items-center justify-between gap-2 px-3 py-2'>
          <div className='flex items-center gap-2'>
            <h3 className='text-sm font-semibold tracking-tight'>
              Notifications
            </h3>
            {unreadCount > 0 && (
              <span className='bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px] tabular-nums'>
                {unreadCount} new
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => markAllRead()}
              className='h-7 px-2 text-xs'
            >
              Mark all read
            </Button>
          )}
        </div>
        <Separator />
        <ScrollArea className='max-h-[420px]'>
          {isLoading && notifications.length === 0 ? (
            <div className='text-muted-foreground flex items-center justify-center gap-2 py-8 text-xs'>
              <Loader2 className='size-3 animate-spin' />
              Loading…
            </div>
          ) : notifications.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-10 text-center'>
              <Bell className='text-muted-foreground/50 size-5' aria-hidden />
              <p className='text-foreground mt-2 text-xs font-medium'>
                You're all caught up
              </p>
              <p className='text-muted-foreground mt-0.5 text-[11px]'>
                New notifications appear here in real time.
              </p>
            </div>
          ) : (
            <div className='divide-border divide-y'>
              {notifications.map((n) => (
                <NotificationRowItem
                  key={n.id}
                  notification={n}
                  onClick={() => handleClickRow(n)}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

// Created and developed by Jai Singh
