// Created and developed by Jai Singh
/**
 * OnlineUsersPanel - Sidebar panel showing who's online
 * Groups users by status: Online, Away, Busy/DND
 *
 * Persistence model
 * -----------------
 * - The panel DEFAULTS TO COLLAPSED on every load. The chevron still expands
 *   it for the current session, but an expanded state is only remembered
 *   across reloads when the user PINS the panel (pin = "lock my choice").
 *   Unpinned panels always start collapsed so the sidebar stays tidy.
 * - Per-section expansion (Online/Away/Busy) and the pin flag are persisted
 *   per-user in localStorage so multiple accounts sharing a browser (a
 *   common pattern on RF/operator devices) each keep their own preferences.
 * - Pinning captures the current collapsed/expanded state at pin time so the
 *   locked value matches what the user is looking at (mirrors the nav-group
 *   pin in OptimizedNavGroup).
 */
import { useState, useMemo, useEffect, useCallback } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  Users,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  Pin,
  PinOff,
} from 'lucide-react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { PRESENCE_STATUS_CONFIG, type PresenceUser } from '@/lib/presence/types'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
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

// Legacy global key — retained only as the storage fallback for the
// unauthenticated render (no userId yet). Per-user keys below take over
// once the user is known.
const LEGACY_PANEL_COLLAPSED_KEY = 'onebox-presence-panel-collapsed'
const PANEL_COLLAPSED_KEY_PREFIX = 'onebox-presence-panel-collapsed-'
const PANEL_PINNED_KEY_PREFIX = 'onebox-presence-panel-pinned-'
const PANEL_SECTIONS_KEY_PREFIX = 'onebox-presence-panel-sections-'

const DEFAULT_SECTIONS: Record<string, boolean> = {
  online: true,
  away: true,
  busy: false,
}

function readLocalStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeLocalStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    logger.warn('Failed to write presence panel prefs:', e)
  }
}

// The panel defaults to collapsed on every load. A persisted expanded state
// is only restored when the user has explicitly pinned the panel (pin =
// "lock my choice"). Unpinned panels always start collapsed.
function computeInitialCollapsed(
  pinnedKey: string | null,
  collapsedKey: string
): boolean {
  if (!pinnedKey) return true
  if (!readLocalStorage<boolean>(pinnedKey, false)) return true
  return readLocalStorage<boolean>(collapsedKey, true)
}

export function OnlineUsersPanel({
  collapsed = false,
  className,
}: OnlineUsersPanelProps) {
  const { onlineUsersState } = usePresence()
  const { onlineUsers, awayUsers, busyUsers, totalPresent, isLoading } =
    onlineUsersState
  const { authState } = useUnifiedAuth()
  const userId = authState.user?.id ?? null

  // Per-user keys (derived from userId). When unauthenticated we still
  // render — fall back to the legacy global key so we don't crash (the
  // panel defaults to collapsed in that case anyway).
  const collapsedKey = userId
    ? `${PANEL_COLLAPSED_KEY_PREFIX}${userId}`
    : LEGACY_PANEL_COLLAPSED_KEY
  const pinnedKey = userId ? `${PANEL_PINNED_KEY_PREFIX}${userId}` : null
  const sectionsKey = userId ? `${PANEL_SECTIONS_KEY_PREFIX}${userId}` : null

  const [panelCollapsed, setPanelCollapsed] = useState(() =>
    computeInitialCollapsed(pinnedKey, collapsedKey)
  )
  const [panelPinned, setPanelPinned] = useState(() =>
    pinnedKey ? readLocalStorage<boolean>(pinnedKey, false) : false
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >(() =>
    sectionsKey
      ? readLocalStorage<Record<string, boolean>>(sectionsKey, DEFAULT_SECTIONS)
      : DEFAULT_SECTIONS
  )

  // When the user identity becomes available (or changes), rehydrate prefs
  // for that user. Default-collapsed behavior: only a PINNED panel restores
  // its locked collapsed/expanded state; unpinned panels always start
  // collapsed on load so the sidebar stays tidy across navigations/reloads.
  useEffect(() => {
    if (!userId) return
    const pinned = readLocalStorage<boolean>(
      `${PANEL_PINNED_KEY_PREFIX}${userId}`,
      false
    )
    setPanelPinned(pinned)
    if (pinned) {
      setPanelCollapsed(
        readLocalStorage<boolean>(
          `${PANEL_COLLAPSED_KEY_PREFIX}${userId}`,
          true
        )
      )
    } else {
      setPanelCollapsed(true)
    }
    setExpandedSections(
      readLocalStorage<Record<string, boolean>>(
        `${PANEL_SECTIONS_KEY_PREFIX}${userId}`,
        DEFAULT_SECTIONS
      )
    )
  }, [userId])

  const togglePanelCollapsed = useCallback(() => {
    setPanelCollapsed((prev) => {
      const next = !prev
      writeLocalStorage(collapsedKey, next)
      return next
    })
  }, [collapsedKey])

  const togglePanelPinned = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!pinnedKey) return
      setPanelPinned((prev) => {
        const next = !prev
        writeLocalStorage(pinnedKey, next)
        // Capture the current collapsed state at pin time so the locked
        // value matches what the user is looking at (mirrors the nav pin).
        // Without this, pinning a freshly-collapsed panel could restore a
        // stale persisted expanded state on the next load.
        if (next) writeLocalStorage(collapsedKey, panelCollapsed)
        return next
      })
    },
    [pinnedKey, collapsedKey, panelCollapsed]
  )

  const toggleSection = useCallback(
    (key: string) => {
      setExpandedSections((prev) => {
        const next = { ...prev, [key]: !prev[key] }
        if (sectionsKey) writeLocalStorage(sectionsKey, next)
        return next
      })
    },
    [sectionsKey]
  )

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

  const PinIcon = panelPinned ? Pin : PinOff
  return (
    <div className={cn('group/presence flex flex-col', className)}>
      {/* Header row. The toggle button and pin button are sibling
          elements so we avoid invalid nested-button markup. The wrapper
          provides hover-tracking for the pin's fade-in. */}
      <div className='relative flex items-center'>
        <button
          onClick={togglePanelCollapsed}
          className='hover:bg-accent/50 flex w-full items-center gap-2 rounded-sm px-3 py-2 pr-9 transition-colors'
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
        {pinnedKey && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type='button'
                  aria-pressed={panelPinned}
                  aria-label={
                    panelPinned
                      ? 'Unpin Online panel'
                      : 'Pin Online panel in place'
                  }
                  onClick={togglePanelPinned}
                  className={cn(
                    'hover:bg-accent/60 absolute top-1/2 right-2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-sm transition-opacity after:absolute after:-inset-1.5',
                    panelPinned
                      ? 'text-primary opacity-100'
                      : 'text-muted-foreground opacity-0 group-hover/presence:opacity-70 hover:opacity-100 focus-visible:opacity-100'
                  )}
                >
                  <PinIcon className='size-3.5' />
                </button>
              </TooltipTrigger>
              <TooltipContent side='right' className='text-xs'>
                {panelPinned ? 'Unpin panel' : 'Pin panel'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

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

// Created and developed by Jai Singh
