// Created and developed by Jai Singh
import {
  IconBarrierBlock,
  IconBrowserCheck,
  IconBug,
  IconChecklist,
  IconError404,
  IconHelp,
  IconLayoutDashboard,
  IconLock,
  IconLockAccess,
  IconNotification,
  IconPalette,
  IconServerOff,
  IconSettings,
  IconShield,
  IconTool,
  IconUserCog,
  IconUserOff,
  IconUsersGroup,
} from '@tabler/icons-react'
import { AudioWaveform, GalleryVerticalEnd } from 'lucide-react'
import { useSupabaseAuth } from '@/stores/supabaseAuthStore'
import OmniFrameLogo from '@/components/ui/onebox-logo'
import { type SidebarData } from '../types'

// Function to get sidebar data based on user authentication
export const getSidebarData = (): SidebarData => {
  const { user, profile } = useSupabaseAuth.getState()

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

  return {
    user: {
      name: getUserDisplayName(),
      email: user?.email || profile?.email || 'guest@omniframe.ai',
      avatar: profile?.avatar_url || '/avatars/default.jpg',
      initials: getAvatarInitials(),
    },
    teams: [
      {
        name: 'OmniFrame',
        logo: OmniFrameLogo,
        plan: 'Logistics Platform',
      },
      {
        name: 'Angad.AI',
        logo: GalleryVerticalEnd,
        plan: 'Enterprise',
      },
      {
        name: 'j.AI',
        logo: AudioWaveform,
        plan: 'Startup',
      },
    ],
    navGroups: [
      {
        title: 'General',
        items: [
          {
            title: 'Dashboard',
            url: '/',
            icon: IconLayoutDashboard,
            requiredPermission: {
              action: 'read',
              resource: 'dashboard',
            },
          },
          {
            title: 'Tasks',
            url: '/tasks',
            icon: IconChecklist,
            requiredPermission: {
              action: 'read',
              resource: 'tasks',
            },
          },
        ],
      },
      {
        title: 'Pages',
        items: [
          {
            title: 'Auth',
            icon: IconLockAccess,
            items: [
              {
                title: 'Sign In',
                url: '/sign-in',
              },
              {
                title: 'Sign In (2 Col)',
                url: '/sign-in-2',
              },
              {
                title: 'Sign Up',
                url: '/sign-up',
              },
              {
                title: 'Forgot Password',
                url: '/forgot-password',
              },
              {
                title: 'OTP',
                url: '/otp',
              },
            ],
          },
          {
            title: 'Errors',
            icon: IconBug,
            items: [
              {
                title: 'Unauthorized',
                url: '/401',
                icon: IconLock,
              },
              {
                title: 'Forbidden',
                url: '/403',
                icon: IconUserOff,
              },
              {
                title: 'Not Found',
                url: '/404',
                icon: IconError404,
              },
              {
                title: 'Internal Server Error',
                url: '/500',
                icon: IconServerOff,
              },
              {
                title: 'Maintenance Error',
                url: '/503',
                icon: IconBarrierBlock,
              },
            ],
          },
        ],
      },
      {
        title: 'Administration',
        items: [
          {
            title: 'Role Management',
            icon: IconUsersGroup,
            requiredPermission: {
              action: 'manage',
              resource: 'roles',
            },
            items: [
              {
                title: 'Roles',
                url: '/admin/roles',
                icon: IconUsersGroup,
                requiredPermission: {
                  action: 'manage',
                  resource: 'roles',
                },
              },
              {
                title: 'User Management',
                url: '/admin/user-management',
                icon: IconUserCog,
                requiredPermission: {
                  action: 'manage',
                  resource: 'users',
                },
              },
            ],
          },
          {
            title: 'Permissions',
            url: '/admin/permissions',
            icon: IconShield,
            requiredPermission: {
              action: 'manage',
              resource: 'roles',
            },
          },
        ],
      },
      {
        title: 'Other',
        items: [
          {
            title: 'Settings',
            icon: IconSettings,
            requiredPermission: {
              action: 'read',
              resource: 'settings',
            },
            items: [
              {
                title: 'Profile',
                url: '/settings',
                icon: IconUserCog,
                requiredPermission: {
                  action: 'read',
                  resource: 'settings',
                },
              },
              {
                title: 'Account',
                url: '/settings/account',
                icon: IconTool,
                requiredPermission: {
                  action: 'update',
                  resource: 'settings',
                },
              },
              {
                title: 'Appearance',
                url: '/settings/appearance',
                icon: IconPalette,
                requiredPermission: {
                  action: 'read',
                  resource: 'settings',
                },
              },
              {
                title: 'Notifications',
                url: '/settings/notifications',
                icon: IconNotification,
                requiredPermission: {
                  action: 'read',
                  resource: 'settings',
                },
              },
              {
                title: 'Display',
                url: '/settings/display',
                icon: IconBrowserCheck,
                requiredPermission: {
                  action: 'read',
                  resource: 'settings',
                },
              },
            ],
          },
          {
            title: 'Help Center',
            url: '/help-center',
            icon: IconHelp,
            // No permission required - help should be accessible to all users
          },
        ],
      },
    ],
  }
}

// For backward compatibility - dynamically generated
export const sidebarData: SidebarData = getSidebarData()

// Created and developed by Jai Singh
