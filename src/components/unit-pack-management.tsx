// Created and developed by Jai Singh
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

const unitPackTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'packaging', label: 'Packaging' },
  { id: 'labels', label: 'Labels' },
  { id: 'settings', label: 'Settings' },
  { id: 'reports', label: 'Reports' },
]

export default function UnitPackManagement() {
  const [activeTab, setActiveTab] = useTabSearchParam('overview')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Unit Pack Overview</h3>
            <p className='text-muted-foreground'>
              Dashboard view with key unit packing metrics and insights.
            </p>
          </div>
        )
      case 'packaging':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Packaging Operations</h3>
            <p className='text-muted-foreground'>
              Manage unit packaging processes and operations.
            </p>
          </div>
        )
      case 'labels':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Label Management</h3>
            <p className='text-muted-foreground'>
              Create and manage unit pack labels and printing.
            </p>
          </div>
        )
      case 'settings':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Unit Pack Settings</h3>
            <p className='text-muted-foreground'>
              Configure unit pack settings and preferences.
            </p>
          </div>
        )
      case 'reports':
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Unit Pack Reports</h3>
            <p className='text-muted-foreground'>
              Generate reports and analytics for unit packing operations.
            </p>
          </div>
        )
      default:
        return (
          <div className='space-y-4'>
            <h3 className='text-lg font-semibold'>Unit Pack Overview</h3>
            <p className='text-muted-foreground'>
              Dashboard view with key unit packing metrics and insights.
            </p>
          </div>
        )
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
              Unit Pack Apps
            </h2>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={unitPackTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='unit_pack_apps'
            fallbackTab='overview'
          />

          <div className='bg-background rounded-lg border p-6'>
            {renderTabContent()}
          </div>
        </div>
      </Main>
    </>
  )
}

// Created and developed by Jai Singh
