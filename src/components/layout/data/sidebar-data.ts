// Created and developed by Jai Singh
import {
  IconActivity,
  IconBox,
  IconBrowserCheck,
  IconBuilding,
  IconBuildingWarehouse,
  IconChartLine,
  IconChecklist,
  IconClock,
  IconClipboardCheck,
  IconCompass,
  IconDeviceMobile,
  IconHelp,
  IconLayoutDashboard,
  IconNotification,
  IconPackage,
  IconPackages,
  IconPalette,
  IconPlugConnected,
  IconRefresh,
  IconSettings,
  IconShield,
  IconShieldCheck,
  IconShieldLock,
  IconTable,
  IconTestPipe,
  IconTool,
  IconTopologyStar3,
  IconTrendingUp,
  IconTruckDelivery,
  IconTruckLoading,
  IconUserCog,
  IconUserPlus,
  IconUsers,
  IconUsersGroup,
} from '@tabler/icons-react'
import { AudioWaveform, GalleryVerticalEnd } from 'lucide-react'
import OmniFrameLogo from '@/components/ui/onebox-logo'
import { type SidebarData } from '../types'

// Function to get sidebar data based on user authentication
export const getSidebarData = (
  user?: { email?: string } | null,
  profile?: {
    full_name?: string | null
    first_name?: string | null
    last_name?: string | null
    email?: string
    avatar_url?: string | null
    role?: string | null
    username?: string | null
  } | null
): SidebarData => {
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
        ],
      },
      {
        title: 'Applications',
        items: [
          {
            title: 'Warehouse Cluster',
            icon: IconBuilding,
            items: [
              {
                title: 'Inventory Apps',
                url: '/apps/inventory',
                icon: IconPackage,
                requiredPermission: {
                  action: 'view',
                  resource: 'inventory_apps',
                },
              },
              {
                title: 'Inbound Apps',
                url: '/apps/inbound',
                icon: IconTruckDelivery,
                requiredPermission: {
                  action: 'view',
                  resource: 'inbound_apps',
                },
              },

              {
                title: 'Kitting Apps',
                url: '/apps/kitting',
                icon: IconBox,
                requiredPermission: {
                  action: 'view',
                  resource: 'kitting_apps',
                },
              },
              {
                title: 'Unit Pack Apps',
                url: '/apps/unit-pack',
                icon: IconPackages,
                requiredPermission: {
                  action: 'view',
                  resource: 'unit_pack_apps',
                },
              },
              {
                title: 'GRS Apps',
                url: '/apps/grs',
                icon: IconRefresh,
                requiredPermission: {
                  action: 'view',
                  resource: 'grs_apps',
                },
              },
              {
                title: 'Outbound Apps',
                url: '/apps/outbound',
                icon: IconTruckLoading,
                requiredPermission: {
                  action: 'view',
                  resource: 'outbound_apps',
                },
              },
              {
                title: 'Quality Apps',
                url: '/apps/quality',
                icon: IconShieldCheck,
                requiredPermission: {
                  action: 'view',
                  resource: 'quality_apps',
                },
              },
            ],
          },
          {
            title: 'Customer Portal',
            url: '/apps/customer-portal',
            icon: IconUsersGroup,
            requiredPermission: {
              action: 'view',
              resource: 'customer_portal',
            },
          },
          {
            title: 'Labor Management',
            icon: IconUsers,
            items: [
              {
                title: 'Shift Productivity',
                url: '/apps/shift-productivity',
                icon: IconTrendingUp,
                requiredPermission: {
                  action: 'view',
                  resource: 'shift_productivity',
                },
              },
              {
                title: 'Standard Work',
                url: '/apps/standard-work',
                icon: IconChecklist,
                requiredPermission: {
                  action: 'view',
                  resource: 'standard_work',
                },
              },
              {
                title: 'Production Boards',
                url: '/apps/production-boards',
                icon: IconLayoutDashboard,
                requiredPermission: {
                  action: 'view',
                  resource: 'shift_productivity',
                },
              },
            ],
          },
          {
            title: 'My Productivity',
            url: '/apps/my-productivity',
            icon: IconActivity,
            requiredPermission: {
              action: 'view',
              resource: 'my_productivity',
            },
          },
          {
            title: 'Facility Management',
            icon: IconBuildingWarehouse,
            items: [
              {
                title: 'Security',
                url: '/facility/security',
                icon: IconShieldLock,
                requiredPermission: {
                  action: 'view',
                  resource: 'facility_security',
                },
              },
              {
                title: 'Maintenance',
                url: '/facility/maintenance',
                icon: IconTool,
                requiredPermission: {
                  action: 'view',
                  resource: 'facility_maintenance',
                },
              },
            ],
          },
        ],
      },
      {
        title: 'Human Resources',
        items: [
          {
            title: 'Time Tracker',
            url: '/hr/time-tracker',
            icon: IconClock,
            requiredPermission: {
              action: 'view',
              resource: 'hr_time_tracker',
            },
          },
          {
            title: 'Employee Reviews',
            url: '/hr/employee-reviews',
            icon: IconClipboardCheck,
            requiredPermission: {
              action: 'view',
              resource: 'hr_employee_reviews',
            },
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
              {
                title: 'Onboarding',
                url: '/admin/onboarding',
                icon: IconUserPlus,
                requiredPermission: {
                  action: 'manage',
                  resource: 'users',
                },
              },
            ],
          },
          {
            title: 'Testing',
            icon: IconTestPipe,
            requiredPermission: {
              action: 'manage',
              resource: 'system',
            },
            items: [
              {
                title: 'Device Manager',
                url: '/admin/device-manager',
                icon: IconDeviceMobile,
                requiredPermission: {
                  action: 'manage',
                  resource: 'system',
                },
              },
              {
                title: 'Session Management',
                url: '/admin/session-management',
                icon: IconClock,
                requiredPermission: {
                  action: 'manage',
                  resource: 'sessions',
                },
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
              {
                title: 'Performance Monitor',
                url: '/admin/performance-monitor',
                icon: IconChartLine,
                requiredPermission: {
                  action: 'manage',
                  resource: 'system',
                },
              },
              {
                title: 'SAP Testing',
                url: '/admin/sap-testing',
                icon: IconPlugConnected,
                requiredPermission: {
                  action: 'manage',
                  resource: 'sap_testing',
                },
              },
              {
                title: 'Data Manager',
                url: '/apps/data-manager',
                icon: IconChartLine,
                requiredPermission: {
                  action: 'view',
                  resource: 'data_manager',
                },
              },
              {
                title: 'Smartsheet Integrations',
                url: '/apps/smartsheet-integrations',
                icon: IconTable,
                requiredPermission: {
                  action: 'view',
                  resource: 'smartsheet_integrations',
                },
              },
              {
                title: 'Tab Permissions Debug',
                url: '/admin/tab-permissions-debug',
                icon: IconTool,
                requiredPermission: {
                  action: 'manage',
                  resource: 'system',
                },
              },
              {
                title: 'Work Queue Management',
                url: '/admin/work-queue',
                icon: IconActivity,
                requiredPermission: {
                  action: 'manage',
                  resource: 'system',
                },
              },
              {
                title: 'Work Engine',
                url: '/admin/work-engine',
                icon: IconActivity,
                requiredPermission: {
                  action: 'manage',
                  resource: 'work_queue',
                },
              },
              {
                title: 'Supply Chain Mapping',
                url: '/admin/supply-chain-mapping',
                icon: IconTopologyStar3,
                requiredPermission: {
                  action: 'manage',
                  resource: 'system',
                },
              },
            ],
          },
          {
            title: 'System Settings',
            url: '/admin/system-settings',
            icon: IconSettings,
            requiredPermission: {
              action: 'manage',
              resource: 'system',
            },
          },
          {
            title: 'OmniBelt',
            url: '/admin/omnibelt',
            icon: IconCompass,
            requiredPermission: {
              action: 'manage',
              resource: 'omnibelt',
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

// For backward compatibility - dynamically generated with guest user defaults
export const sidebarData: SidebarData = getSidebarData(null, null)

// Created and developed by Jai Singh
