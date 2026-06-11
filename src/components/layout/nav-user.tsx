// Created and developed by Jai Singh
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Bell, ChevronsUpDown, LogOut, MessageSquare, X } from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import {
  PRESENCE_STATUS_CONFIG,
  type PresenceStatus,
} from '@/lib/presence/types'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { usePresenceOptional } from '@/context/presence-context'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { PresenceAvatar } from '@/components/presence/presence-avatar'
import { StatusIndicator } from '@/components/presence/status-indicator'

const statusOptions: PresenceStatus[] = [
  'online',
  'away',
  'busy',
  'do_not_disturb',
  'offline',
]

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    avatar: string
    initials: string
  }
}) {
  const { isMobile, state } = useSidebar()
  const { signOut } = useUnifiedAuth()
  const presence = usePresenceOptional()
  const isCollapsed = state === 'collapsed'
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [inputText, setInputText] = useState(presence?.customStatusText || '')

  const handleSaveCustom = () => {
    presence?.setCustomStatusText(inputText.trim() || null)
    setShowCustomInput(false)
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size='lg'
              className={cn(
                'data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground',
                isCollapsed ? 'justify-center px-2' : ''
              )}
            >
              {presence ? (
                <PresenceAvatar
                  src={user.avatar}
                  fallback={user.initials}
                  alt={user.name}
                  status={presence.myStatus}
                  size='md'
                />
              ) : (
                <Avatar className='h-8 w-8 rounded-lg'>
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className='rounded-lg'>
                    {user.initials}
                  </AvatarFallback>
                </Avatar>
              )}
              {!isCollapsed && (
                <>
                  <div className='grid flex-1 text-left text-sm leading-tight'>
                    <span className='truncate font-semibold'>{user.name}</span>
                    {presence ? (
                      <span className='text-muted-foreground flex items-center gap-1 text-xs'>
                        <StatusIndicator
                          status={presence.myStatus}
                          size='xs'
                          showTooltip={false}
                        />
                        <span className='truncate'>
                          {presence.customStatusText ||
                            PRESENCE_STATUS_CONFIG[presence.myStatus].label}
                        </span>
                      </span>
                    ) : (
                      <span className='truncate text-xs'>{user.email}</span>
                    )}
                  </div>
                  <ChevronsUpDown className='ml-auto size-4' />
                </>
              )}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg'
            side={isMobile ? 'bottom' : 'right'}
            align='end'
            sideOffset={4}
          >
            <DropdownMenuLabel className='p-0 font-normal'>
              <div className='flex items-center gap-2 px-1 py-1.5 text-left text-sm'>
                {presence ? (
                  <PresenceAvatar
                    src={user.avatar}
                    fallback={user.initials}
                    alt={user.name}
                    status={presence.myStatus}
                    size='md'
                  />
                ) : (
                  <Avatar className='h-8 w-8 rounded-lg'>
                    <AvatarImage src={user.avatar} alt={user.name} />
                    <AvatarFallback className='rounded-lg'>
                      {user.initials}
                    </AvatarFallback>
                  </Avatar>
                )}
                <div className='grid flex-1 text-left text-sm leading-tight'>
                  <span className='truncate font-semibold'>{user.name}</span>
                  <span className='truncate text-xs'>{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Status selection - inside the dropdown content where clicks work */}
            {presence && (
              <>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className='gap-2'>
                    <StatusIndicator
                      status={presence.myStatus}
                      size='xs'
                      showTooltip={false}
                    />
                    <span className='flex-1'>
                      {presence.customStatusText ||
                        PRESENCE_STATUS_CONFIG[presence.myStatus].label}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className='w-48'>
                    <DropdownMenuLabel className='text-xs'>
                      Set Status
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {statusOptions.map((status) => {
                      const config = PRESENCE_STATUS_CONFIG[status]
                      return (
                        <DropdownMenuItem
                          key={status}
                          onClick={() => presence.setMyStatus(status)}
                          className='gap-2'
                        >
                          <span
                            className={cn(
                              'h-2 w-2 shrink-0 rounded-full',
                              config.dotClass
                            )}
                          />
                          <span className='flex-1'>{config.label}</span>
                          {status === presence.myStatus && (
                            <span className='text-muted-foreground text-[10px]'>
                              Current
                            </span>
                          )}
                        </DropdownMenuItem>
                      )
                    })}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.preventDefault()
                        setInputText(presence.customStatusText || '')
                        setShowCustomInput(true)
                      }}
                      className='gap-2'
                    >
                      <MessageSquare className='h-3.5 w-3.5' />
                      <span>Set custom status...</span>
                    </DropdownMenuItem>
                    {presence.customStatusText && (
                      <DropdownMenuItem
                        onClick={() => presence.setCustomStatusText(null)}
                        className='text-destructive gap-2'
                      >
                        <X className='h-3.5 w-3.5' />
                        <span>Clear custom status</span>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
              </>
            )}

            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link to='/settings/notifications'>
                  <Bell />
                  Notifications
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                try {
                  await signOut()
                  toast.success('Successfully logged out')
                } catch (error) {
                  logger.error('Logout error:', error)
                  toast.error('Logout failed. Please try again.')
                }
              }}
            >
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Custom status input modal - rendered outside the dropdown */}
        {showCustomInput && (
          <div
            className='fixed inset-0 z-50 flex items-center justify-center bg-black/20'
            onClick={() => setShowCustomInput(false)}
          >
            <div
              className='bg-popover w-80 rounded-lg border p-4 shadow-lg'
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className='mb-2 text-sm font-medium'>Set a custom status</h3>
              <input
                type='text'
                placeholder="What's your status?"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveCustom()
                  if (e.key === 'Escape') setShowCustomInput(false)
                }}
                className='border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-1 focus:outline-none'
                maxLength={100}
                autoFocus
              />
              <div className='mt-3 flex justify-end gap-2'>
                <button
                  onClick={() => setShowCustomInput(false)}
                  className='hover:bg-accent rounded-md border px-3 py-1.5 text-xs transition-colors'
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveCustom}
                  className='bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-xs transition-colors'
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

// Created and developed by Jai Singh
