import React, { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { DeviceInventoryTab } from './components/tabs/device-inventory-tab'
import { FleetOverviewTab } from './components/tabs/fleet-overview-tab'

const CommandCenterTab = React.lazy(() =>
  import('./components/tabs/command-center-tab').then((m) => ({
    default: m.CommandCenterTab,
  }))
)
const LocationIntelligenceTab = React.lazy(() =>
  import('./components/tabs/location-intelligence-tab').then((m) => ({
    default: m.LocationIntelligenceTab,
  }))
)
const ProfilesPoliciesTab = React.lazy(() =>
  import('./components/tabs/profiles-policies-tab').then((m) => ({
    default: m.ProfilesPoliciesTab,
  }))
)
const AppManagementTab = React.lazy(() =>
  import('./components/tabs/app-management-tab').then((m) => ({
    default: m.AppManagementTab,
  }))
)
const ComplianceSecurityTab = React.lazy(() =>
  import('./components/tabs/compliance-security-tab').then((m) => ({
    default: m.ComplianceSecurityTab,
  }))
)
const AutomationTab = React.lazy(() =>
  import('./components/tabs/automation-tab').then((m) => ({
    default: m.AutomationTab,
  }))
)
const AnalyticsReportingTab = React.lazy(() =>
  import('./components/tabs/analytics-reporting-tab').then((m) => ({
    default: m.AnalyticsReportingTab,
  }))
)

const TabFallback = () => (
  <div className='flex items-center justify-center py-12'>
    <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
  </div>
)

const DEVICE_MANAGER_TABS = [
  { id: 'fleet-overview', label: 'Fleet Overview' },
  { id: 'device-inventory', label: 'Device Inventory' },
  { id: 'command-center', label: 'Command Center' },
  { id: 'location-intelligence', label: 'Location Intelligence' },
  { id: 'profiles-policies', label: 'Profiles & Policies' },
  { id: 'app-management', label: 'App Management' },
  { id: 'compliance-security', label: 'Compliance & Security' },
  { id: 'automation', label: 'Automation' },
  { id: 'analytics', label: 'Analytics & Reporting' },
]

export function DeviceManagerPage() {
  const [activeTab, setActiveTab] = useTabSearchParam('fleet-overview')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'fleet-overview':
        return <FleetOverviewTab />
      case 'device-inventory':
        return <DeviceInventoryTab />
      case 'command-center':
        return (
          <Suspense fallback={<TabFallback />}>
            <CommandCenterTab />
          </Suspense>
        )
      case 'location-intelligence':
        return (
          <Suspense fallback={<TabFallback />}>
            <LocationIntelligenceTab />
          </Suspense>
        )
      case 'profiles-policies':
        return (
          <Suspense fallback={<TabFallback />}>
            <ProfilesPoliciesTab />
          </Suspense>
        )
      case 'app-management':
        return (
          <Suspense fallback={<TabFallback />}>
            <AppManagementTab />
          </Suspense>
        )
      case 'compliance-security':
        return (
          <Suspense fallback={<TabFallback />}>
            <ComplianceSecurityTab />
          </Suspense>
        )
      case 'automation':
        return (
          <Suspense fallback={<TabFallback />}>
            <AutomationTab />
          </Suspense>
        )
      case 'analytics':
        return (
          <Suspense fallback={<TabFallback />}>
            <AnalyticsReportingTab />
          </Suspense>
        )
      default:
        return <FleetOverviewTab />
    }
  }

  return (
    <>
      <Header fixed>
        <Search />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main>
        <div className='mb-2 flex flex-wrap items-center justify-between space-y-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>
              Device Manager
            </h2>
            <p className='text-muted-foreground'>
              Manage supervised iOS devices, execute commands, track locations,
              and enforce compliance policies
            </p>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={DEVICE_MANAGER_TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='device_manager'
            fallbackTab='fleet-overview'
          />

          <div>{renderTabContent()}</div>
        </div>
      </Main>
    </>
  )
}
