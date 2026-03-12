/**
 * OnlineUsersPanel - Sidebar panel showing who's online
 * Groups users by status: Online, Away, Busy/DND
 */
import { useState, useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Users, ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { PRESENCE_STATUS_CONFIG, type PresenceUser } from '@/lib/presence/types'
import { cn } from '@/lib/utils'
import { usePresence } from '@/context/presence-context'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { PresenceAvatar } from './presence-avatar'
import { StatusIndicator } from './status-indicator'

interface OnlineUsersPanelProps {
  collapsed?: boolean
  className?: string
}

const PANEL_COLLAPSED_KEY = 'omniframe-presence-panel-collapsed'

export function OnlineUsersPanel({
  collapsed = false,
  className,
}: OnlineUsersPanelProps) {
  const { onlineUsersState } = usePresence()
  const { onlineUsers, awayUsers, busyUsers, totalPresent, isLoading } =
    onlineUsersState

  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    try {
      return localStorage.getItem(PANEL_COLLAPSED_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    online: true,
    away: true,
    busy: false,
  })

  const togglePanelCollapsed = () => {
    setPanelCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(PANEL_COLLAPSED_KEY, String(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // Filter users by search
  const filterUsers = useMemo(() => {
    if (!searchQuery.trim()) return { onlineUsers, awayUsers, busyUsers }
    const q = searchQuery.toLowerCase()
    return {
      onlineUsers: onlineUsers.filter(
        (u) =>
          u.display_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      ),
      awayUsers: awayUsers.filter(
        (u) =>
          u.display_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      ),
      busyUsers: busyUsers.filter(
        (u) =>
          u.display_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      ),
    }
  }, [searchQuery, onlineUsers, awayUsers, busyUsers])

  // Collapsed view: just show count badge
  if (collapsed) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='flex cursor-default items-center justify-center py-2'>
              <div className='relative'>
                <Users className='text-muted-foreground h-4 w-4' />
                {totalPresent > 0 && (
                  <span className='absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-500 text-[9px] font-bold text-white'>
                    {totalPresent > 9 ? '9+' : totalPresent}
                  </span>
                )}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side='right'>
            <p>
              {totalPresent} user{totalPresent !== 1 ? 's' : ''} online
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header - clickable to collapse/expand */}
      <button
        onClick={togglePanelCollapsed}
        className='hover:bg-accent/50 flex w-full items-center gap-2 rounded-sm px-3 py-2 transition-colors'
      >
        {panelCollapsed ? (
          <ChevronRight className='text-muted-foreground h-3 w-3 shrink-0' />
        ) : (
          <ChevronDown className='text-muted-foreground h-3 w-3 shrink-0' />
        )}
        <Users className='text-muted-foreground h-4 w-4 shrink-0' />
        <span className='text-muted-foreground text-xs font-semibold tracking-wider uppercase'>
          Online
        </span>
        <span className='text-muted-foreground ml-auto text-xs tabular-nums'>
          {totalPresent}
        </span>
      </button>

      {/* Collapsible body */}
      {!panelCollapsed && (
        <>
          {/* Search */}
          <div className='px-3 pb-2'>
            <div className='relative'>
              <Search className='text-muted-foreground absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2' />
              <input
                type='text'
                placeholder='Search users...'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className='border-input placeholder:text-muted-foreground focus:ring-ring w-full rounded-md border bg-transparent py-1 pr-7 pl-7 text-xs focus:ring-1 focus:outline-none'
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className='text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2'
                >
                  <X className='h-3 w-3' />
                </button>
              )}
            </div>
          </div>

          <Separator />

          {/* User groups */}
          <ScrollArea className='max-h-64 flex-1'>
            <div className='py-1'>
              {isLoading ? (
                <div className='flex items-center justify-center py-6'>
                  <span className='text-muted-foreground text-xs'>
                    Connecting...
                  </span>
                </div>
              ) : totalPresent === 0 ? (
                <div className='flex flex-col items-center justify-center gap-1 py-6'>
                  <Users className='text-muted-foreground/50 h-5 w-5' />
                  <span className='text-muted-foreground text-xs'>
                    No one else online
                  </span>
                </div>
              ) : (
                <>
                  <UserGroup
                    title='Online'
                    users={filterUsers.onlineUsers}
                    status='online'
                    expanded={expandedSections.online}
                    onToggle={() => toggleSection('online')}
                  />
                  <UserGroup
                    title='Away'
                    users={filterUsers.awayUsers}
                    status='away'
                    expanded={expandedSections.away}
                    onToggle={() => toggleSection('away')}
                  />
                  <UserGroup
                    title='Busy'
                    users={filterUsers.busyUsers}
                    status='busy'
                    expanded={expandedSections.busy}
                    onToggle={() => toggleSection('busy')}
                  />
                </>
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  )
}

// ---- Sub-components ----

function UserGroup({
  title,
  users,
  status,
  expanded,
  onToggle,
}: {
  title: string
  users: PresenceUser[]
  status: string
  expanded: boolean
  onToggle: () => void
}) {
  if (users.length === 0) return null

  const config =
    PRESENCE_STATUS_CONFIG[status as keyof typeof PRESENCE_STATUS_CONFIG]

  return (
    <div>
      <button
        onClick={onToggle}
        className='text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 px-3 py-1 text-xs font-medium transition-colors'
      >
        {expanded ? (
          <ChevronDown className='h-3 w-3' />
        ) : (
          <ChevronRight className='h-3 w-3' />
        )}
        <span className={cn('h-1.5 w-1.5 rounded-full', config?.dotClass)} />
        <span>{title}</span>
        <span className='ml-auto tabular-nums'>{users.length}</span>
      </button>
      {expanded && (
        <div className='space-y-0.5 pb-1'>
          {users.map((user) => (
            <UserRow key={user.user_id} user={user} />
          ))}
        </div>
      )}
    </div>
  )
}

function UserRow({ user }: { user: PresenceUser }) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className='hover:bg-accent/50 flex cursor-default items-center gap-2 rounded-sm px-3 py-1 transition-colors'>
            <PresenceAvatar
              src={user.avatar_url}
              fallback={user.initials}
              alt={user.display_name}
              status={user.status}
              size='sm'
            />
            <div className='min-w-0 flex-1'>
              <p className='truncate text-xs font-medium'>
                {user.display_name}
              </p>
              {user.custom_status_text && (
                <p className='text-muted-foreground truncate text-[10px]'>
                  {user.custom_status_text}
                </p>
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent
          side='right'
          className='bg-popover text-popover-foreground max-w-52 border px-3 py-2 shadow-md'
        >
          <div className='space-y-1'>
            <p className='text-popover-foreground text-xs font-semibold'>
              {user.display_name}
            </p>
            <p className='text-popover-foreground/60 text-[10px]'>
              {user.email}
            </p>
            {user.role_name && (
              <p className='text-popover-foreground/60 text-[10px]'>
                {user.role_name}
              </p>
            )}
            {user.custom_status_text && (
              <p className='text-popover-foreground/80 text-[10px] italic'>
                &ldquo;{user.custom_status_text}&rdquo;
              </p>
            )}
            <div className='flex items-center gap-1 pt-0.5'>
              <StatusIndicator
                status={user.status}
                size='xs'
                showTooltip={false}
              />
              <p className='text-popover-foreground/60 text-[10px]'>
                Online{' '}
                {formatDistanceToNow(new Date(user.online_at), {
                  addSuffix: true,
                })}
              </p>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
