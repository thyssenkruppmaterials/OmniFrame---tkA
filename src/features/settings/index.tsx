import { Outlet } from '@tanstack/react-router'
import {
  IconBrowserCheck,
  IconNotification,
  IconPalette,
  IconTool,
  IconUser,
  IconBuilding,
  IconDatabase,
} from '@tabler/icons-react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { Separator } from '@/components/ui/separator'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import SidebarNav from './components/sidebar-nav'

export default function Settings() {
  const { authState } = useUnifiedAuth()
  const { profile } = authState

  // Check if user can access organization settings (use role_id-based lookup via roles join)
  const canAccessOrgSettings =
    profile?.role === 'superadmin' || profile?.role === 'admin'
  return (
    <>
      {/* ===== Top Heading ===== */}
      <Header fixed>
        <Search />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main fixed>
        <div className='space-y-0.5'>
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
            Settings
          </h1>
          <p className='text-muted-foreground'>
            Manage your account settings and set e-mail preferences.
          </p>
        </div>
        <Separator className='my-4 lg:my-6' />
        <div className='flex flex-1 flex-col space-y-2 overflow-hidden md:space-y-2 lg:flex-row lg:space-y-0 lg:space-x-12'>
          <aside className='top-0 z-0 lg:sticky lg:w-1/5'>
            <SidebarNav items={getSidebarNavItems(canAccessOrgSettings)} />
          </aside>
          <div className='relative z-10 flex w-full min-h-0 overflow-y-auto p-1 pl-4'>
            <Outlet />
          </div>
        </div>
      </Main>
    </>
  )
}

const getSidebarNavItems = (canAccessOrgSettings: boolean) => {
  const items = [
    {
      title: 'Profile',
      icon: <IconUser size={18} />,
      href: '/settings',
    },
    {
      title: 'Account',
      icon: <IconTool size={18} />,
      href: '/settings/account',
    },
    {
      title: 'Appearance',
      icon: <IconPalette size={18} />,
      href: '/settings/appearance',
    },
    {
      title: 'Notifications',
      icon: <IconNotification size={18} />,
      href: '/settings/notifications',
    },
    {
      title: 'Display',
      icon: <IconBrowserCheck size={18} />,
      href: '/settings/display',
    },
    {
      title: 'Cache Management',
      icon: <IconDatabase size={18} />,
      href: '/settings/cache',
    },
  ]

  // Add organization settings for admin users
  if (canAccessOrgSettings) {
    items.splice(1, 0, {
      title: 'Organization',
      icon: <IconBuilding size={18} />,
      href: '/settings/organization',
    })
  }

  return items
}
