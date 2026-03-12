import { useState } from 'react'
import {
  IconAdjustments,
  IconBell,
  IconChartBar,
  IconHierarchy,
  IconSettings,
  IconTimeline,
  IconUsers,
} from '@tabler/icons-react'
import { Separator } from '@/components/ui/separator'
import { ActivitySourcesSettings } from './activity-sources/activity-sources-settings'
import { AdvancedSettings } from './advanced/advanced-settings'
import SidebarNav from './components/sidebar-nav'
import { GeneralSettings } from './general/general-settings'
import { KPISettings } from './kpi/kpi-settings'
import { LaborManagementSettings } from './labor-management/labor-management-settings'
import { NotificationSettings } from './notifications/notification-settings'
import { TeamSettings } from './team/team-settings'

const settingsSections = [
  {
    id: 'general',
    title: 'General',
    icon: <IconAdjustments size={18} />,
  },
  {
    id: 'kpi',
    title: 'KPI Thresholds',
    icon: <IconChartBar size={18} />,
  },
  {
    id: 'labor-management',
    title: 'Labor Management',
    icon: <IconHierarchy size={18} />,
  },
  {
    id: 'activity-sources',
    title: 'Activity Sources',
    icon: <IconTimeline size={18} />,
  },
  {
    id: 'notifications',
    title: 'Notifications',
    icon: <IconBell size={18} />,
  },
  {
    id: 'team',
    title: 'Team Settings',
    icon: <IconUsers size={18} />,
  },
  {
    id: 'advanced',
    title: 'Advanced',
    icon: <IconSettings size={18} />,
  },
]

export default function ShiftProductivitySettings() {
  const [activeSection, setActiveSection] = useState('general')

  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return <GeneralSettings />
      case 'kpi':
        return <KPISettings />
      case 'labor-management':
        return <LaborManagementSettings />
      case 'activity-sources':
        return <ActivitySourcesSettings />
      case 'notifications':
        return <NotificationSettings />
      case 'team':
        return <TeamSettings />
      case 'advanced':
        return <AdvancedSettings />
      default:
        return <GeneralSettings />
    }
  }

  return (
    <div className='space-y-0.5'>
      <h3 className='text-lg font-semibold'>Productivity Settings</h3>
      <p className='text-muted-foreground text-sm'>
        Configure productivity tracking, KPI thresholds, and team performance
        settings.
      </p>
      <Separator className='my-4' />
      <div className='flex flex-1 flex-col space-y-2 overflow-hidden md:space-y-2 lg:flex-row lg:space-y-0 lg:space-x-6'>
        <aside className='top-0 flex-shrink-0 lg:sticky lg:w-1/5'>
          <SidebarNav
            items={settingsSections}
            activeSection={activeSection}
            onSectionChange={setActiveSection}
          />
        </aside>
        <div className='flex w-full flex-1 overflow-y-hidden p-1'>
          <div className='flex w-full flex-1 flex-col'>{renderContent()}</div>
        </div>
      </div>
    </div>
  )
}
