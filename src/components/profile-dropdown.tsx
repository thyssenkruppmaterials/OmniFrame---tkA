import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function ProfileDropdown() {
  const { authState, signOut } = useUnifiedAuth()
  const { user, profile } = authState

  // Generate user display name from profile or user data
  const getUserDisplayName = () => {
    if (profile?.full_name) return profile.full_name
    if (profile?.first_name && profile?.last_name) {
      return `${profile.first_name} ${profile.last_name}`.trim()
    }
    if (profile?.first_name) return profile.first_name
    if (profile?.username) return profile.username
    if (user?.email) return user.email.split('@')[0]
    return 'Guest User'
  }

  // Generate avatar initials from user name
  const getAvatarInitials = () => {
    const name = getUserDisplayName()
    if (name === 'Guest User') return 'GU'

    const nameParts = name.split(' ')
    if (nameParts.length >= 2) {
      return `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase()
    }
    return name.slice(0, 2).toUpperCase()
  }

  const displayName = getUserDisplayName()
  const displayEmail = user?.email || profile?.email || 'guest@omniframe.ai'
  const avatarUrl = profile?.avatar_url || '/avatars/default.jpg'
  const initials = getAvatarInitials()
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' className='relative h-8 w-8 rounded-full'>
          <Avatar className='h-8 w-8'>
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-56' align='end' forceMount>
        <DropdownMenuLabel className='font-normal'>
          <div className='flex flex-col space-y-1'>
            <p className='text-sm leading-none font-medium'>{displayName}</p>
            <p className='text-muted-foreground text-xs leading-none'>
              {displayEmail}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link to='/settings'>
              Profile
              <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to='/settings'>
              Billing
              <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to='/settings'>
              Settings
              <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem>New Team</DropdownMenuItem>
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
          Log out
          <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
